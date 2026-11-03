import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  NetlifyAuthError,
  type NetlifySite,
  NetlifySiteGoneError,
  createSite,
  deployDirectory,
  digestDirectory,
  signIn,
} from '../core/netlify';
import { getNetlifySiteDir, getSiteDir } from '../core/paths';
import { githubPagesSettingsUrl, githubPagesUrl, pushSite, syncSiteRepo } from '../core/publish';

const NETLIFY_TOKEN_KEY = 'noat.netlify.token';
const SIGN_IN_TIMEOUT_MS = 10 * 60_000;

/** A configured place to publish to, ready for one publish operation. */
export interface PublishConnection {
  /** Directory holding the built site and its manifest. */
  siteDir: string;
  /** Public base URL pages live under. */
  siteUrl: string;
  /** Bring siteDir up to date with what's live. */
  pull(): Promise<void>;
  /** Make siteDir's current contents live. */
  push(message: string): Promise<void>;
  /** Shown once, after the very first page is published. */
  firstPublishHint?: { message: string; action: string; url: string };
  /** What unpublishing does and doesn't erase, for the confirm dialog. */
  unpublishDetail: string;
}

function publishConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('noat.publish');
}

export function publishProvider(): 'netlify' | 'git' {
  return publishConfig().get<string>('provider', 'netlify') === 'git' ? 'git' : 'netlify';
}

/** git's stderr, trimmed to something that fits in a notification. */
function gitFailure(error: unknown, remote: string): Error {
  if ((error as { killed?: boolean }).killed) {
    return new Error(
      `git timed out talking to ${remote}. It may be waiting for a password or SSH passphrase; run "git push" in ~/.noat/site from a terminal once to check.`
    );
  }
  const stderr = (error as { stderr?: string }).stderr?.trim();
  const detail = (stderr || (error instanceof Error ? error.message : String(error)))
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .slice(-2)
    .join(' ');
  return new Error(
    `couldn't publish (${detail}). Check that you can push to ${remote} from a terminal.`
  );
}

/**
 * The git provider: pages are pushed to a repository the user owns and a
 * static host watching it (GitHub Pages, Cloudflare Pages…) serves them.
 * With `prompt`, asks for whatever settings are missing.
 */
export async function connectGit(
  noatHome: string,
  prompt: boolean
): Promise<PublishConnection | undefined> {
  const config = publishConfig();
  const remote = await (async () => {
    const configured = config.get<string>('repository', '').trim();
    if (configured || !prompt) return configured;
    const entered = (
      await vscode.window.showInputBox({
        title: 'NOAT: Publish to web',
        prompt:
          'Git repository to publish to. Create an empty public GitHub repo and paste its URL; NOAT pushes pages to its main branch and GitHub Pages serves them.',
        placeHolder: 'https://github.com/you/notes.git',
        ignoreFocusOut: true,
        validateInput: (value) => (value.trim() ? undefined : 'Enter a git remote URL'),
      })
    )?.trim();
    if (entered) await config.update('repository', entered, vscode.ConfigurationTarget.Global);
    return entered ?? '';
  })();
  if (!remote) return undefined;

  const siteUrl = await (async () => {
    const configured = config.get<string>('siteUrl', '').trim() || githubPagesUrl(remote);
    if (configured || !prompt) return configured ?? '';
    const entered = (
      await vscode.window.showInputBox({
        title: 'NOAT: Publish to web',
        prompt: `Public URL that ${remote} is served at`,
        placeHolder: 'https://notes.example.com/',
        ignoreFocusOut: true,
        validateInput: (value) =>
          /^https?:\/\//.test(value.trim()) ? undefined : 'Enter an http(s) URL',
      })
    )?.trim();
    if (entered) await config.update('siteUrl', entered, vscode.ConfigurationTarget.Global);
    return entered ?? '';
  })();
  if (!siteUrl) return undefined;

  const siteDir = getSiteDir(noatHome);
  const pagesSettings = githubPagesSettingsUrl(remote);
  return {
    siteDir,
    siteUrl,
    pull: () =>
      syncSiteRepo(siteDir, remote).catch((error) => Promise.reject(gitFailure(error, remote))),
    push: async (message) => {
      await pushSite(siteDir, message).catch((error) => Promise.reject(gitFailure(error, remote)));
    },
    ...(pagesSettings && {
      firstPublishHint: {
        message:
          'First time? Turn on GitHub Pages for the repo (deploy from branch "main", root) so the link goes live.',
        action: 'Enable GitHub Pages',
        url: pagesSettings,
      },
    }),
    unpublishDetail:
      "Its public link stops working once the site redeploys. Earlier versions stay in the publish repository's git history; delete or rewrite that repository to erase them.",
  };
}

interface NetlifyState {
  siteId?: string;
  url?: string;
  /** Digest map of the last successful deploy, to skip no-op deploys. */
  deployed?: Record<string, string>;
}

async function readNetlifyState(stateFile: string): Promise<NetlifyState> {
  try {
    const parsed = JSON.parse(await fs.readFile(stateFile, 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as NetlifyState) : {};
  } catch {
    return {};
  }
}

async function writeNetlifyState(stateFile: string, state: NetlifyState): Promise<void> {
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
}

/** Browser sign-in, cancellable from the progress notification. */
async function netlifySignIn(): Promise<string | undefined> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'NOAT: approve NOAT in your browser to connect your Netlify account…',
      cancellable: true,
    },
    async (_progress, cancellation) => {
      const abort = new AbortController();
      cancellation.onCancellationRequested(() => abort.abort(new Error('cancelled')));
      const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(SIGN_IN_TIMEOUT_MS)]);
      try {
        return await signIn(async (url) => {
          await vscode.env.openExternal(vscode.Uri.parse(url));
        }, signal);
      } catch (error) {
        if (cancellation.isCancellationRequested) return undefined;
        throw error;
      }
    }
  );
}

export async function signOutOfNetlify(secrets: vscode.SecretStorage): Promise<void> {
  await secrets.delete(NETLIFY_TOKEN_KEY);
}

/**
 * The Netlify provider: one-click publishing. The first publish signs in
 * through the browser and creates a site with a random *.netlify.app name;
 * after that, each publish deploys the built pages directly. Without
 * `prompt`, returns undefined until both have happened.
 */
export async function connectNetlify(
  noatHome: string,
  secrets: vscode.SecretStorage,
  prompt: boolean
): Promise<PublishConnection | undefined> {
  const rootDir = getNetlifySiteDir(noatHome);
  const siteDir = path.join(rootDir, 'public');
  const stateFile = path.join(rootDir, 'netlify.json');

  const token = await (async () => {
    const stored = await secrets.get(NETLIFY_TOKEN_KEY);
    if (stored || !prompt) return stored;
    const fresh = await netlifySignIn();
    if (fresh) await secrets.store(NETLIFY_TOKEN_KEY, fresh);
    return fresh;
  })();
  if (!token) return undefined;

  const state = await readNetlifyState(stateFile);
  const site = await (async (): Promise<NetlifySite | undefined> => {
    if (state.siteId && state.url) return { id: state.siteId, url: state.url };
    if (!prompt) return undefined;
    const created = await createSite(token).catch(async (error: unknown) => {
      if (!(error instanceof NetlifyAuthError)) throw error;
      await secrets.delete(NETLIFY_TOKEN_KEY);
      throw new Error('your Netlify sign-in expired. Publish again to sign back in.');
    });
    state.siteId = created.id;
    state.url = created.url;
    state.deployed = undefined;
    await writeNetlifyState(stateFile, state);
    return created;
  })();
  if (!site) return undefined;
  const siteId = site.id;

  return {
    siteDir,
    siteUrl: publishConfig().get<string>('siteUrl', '').trim() || site.url,
    pull: async () => {
      await fs.mkdir(siteDir, { recursive: true });
    },
    push: async () => {
      const digests = Object.fromEntries(await digestDirectory(siteDir));
      if (JSON.stringify(digests) === JSON.stringify(state.deployed)) return;
      try {
        await deployDirectory(token, siteId, siteDir);
      } catch (error) {
        if (error instanceof NetlifyAuthError) {
          await secrets.delete(NETLIFY_TOKEN_KEY);
          throw new Error('your Netlify sign-in expired. Publish again to sign back in.');
        }
        if (error instanceof NetlifySiteGoneError) {
          await writeNetlifyState(stateFile, {});
          throw new Error('your Netlify site was deleted. Publish again to create a new one.');
        }
        throw error;
      }
      state.deployed = digests;
      await writeNetlifyState(stateFile, state);
    },
    unpublishDetail:
      "Its public link stops working within seconds. Netlify keeps past deploys at unguessable per-deploy links; delete the site in Netlify's dashboard to erase those too.",
  };
}

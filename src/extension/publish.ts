import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { NOTE_EXTENSION, parseNote } from '../core/note';
import { getNotesRoot, getSiteDir } from '../core/paths';
import {
  type SiteManifest,
  addToManifest,
  buildSite,
  commitTitle,
  githubPagesSettingsUrl,
  githubPagesUrl,
  pageUrl,
  pushSite,
  readManifest,
  removeFromManifest,
  syncSiteRepo,
} from '../core/publish';
import { logError } from './log';
import { activeNotePath, targetNotePath } from './note-target';
import type { NoatNode } from './notes-tree';

// Long enough that a typing session becomes one push, not dozens.
const AUTO_UPDATE_MS = 20_000;

interface PublishTarget {
  remote: string;
  siteUrl: string;
}

/** git's stderr, trimmed to something that fits in a notification. */
function gitFailure(error: unknown, remote: string): Error {
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
 * Publish notes as web pages ("Publish to web", Notion-style). Pages are
 * rendered to static HTML and pushed to a git repository the user owns;
 * GitHub Pages serves them. Published notes re-publish themselves shortly
 * after each save, so the page tracks the note.
 */
export class SitePublisher implements vscode.Disposable {
  private queue: Promise<unknown> = Promise.resolve();
  private publishedIds = new Set<string>();
  private autoTimer: NodeJS.Timeout | undefined;
  private autoUpdateFailing = false;

  private readonly configSubscription: vscode.Disposable;

  constructor(private readonly noatHome: string) {
    void this.refreshPublished();
    this.configSubscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('noat.publish.repository')) void this.refreshPublished();
    });
  }

  dispose(): void {
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.configSubscription.dispose();
  }

  /**
   * Learn which notes are published from the remote itself, so saves
   * auto-update even when the local clone is missing or stale (fresh machine,
   * pages published elsewhere, repository setting changed).
   */
  private async refreshPublished(): Promise<void> {
    const target = await this.target(false);
    if (!target) {
      this.publishedIds = new Set();
      return;
    }
    try {
      await this.run(async () => {
        await syncSiteRepo(this.siteDir, target.remote);
        this.remember(await readManifest(this.siteDir));
      });
    } catch (error) {
      logError('could not read published notes from the publish repository', error);
    }
  }

  private get siteDir(): string {
    return getSiteDir(this.noatHome);
  }

  private remember(manifest: SiteManifest): void {
    this.publishedIds = new Set(Object.keys(manifest.pages));
  }

  /** Site operations share one working copy, so they run one at a time. */
  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /**
   * Where to publish, from settings. With `prompt`, asks for (and saves)
   * whatever is missing; otherwise returns undefined until it's configured.
   */
  private async target(prompt: boolean): Promise<PublishTarget | undefined> {
    const config = vscode.workspace.getConfiguration('noat.publish');
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
    return siteUrl ? { remote, siteUrl } : undefined;
  }

  /** Sync the site repo, let `change` edit the manifest, rebuild, and push. */
  private async update(
    target: PublishTarget,
    message: string,
    change: (manifest: SiteManifest) => Promise<void> | void
  ): Promise<SiteManifest> {
    return this.run(async () => {
      try {
        await syncSiteRepo(this.siteDir, target.remote);
        const manifest = await readManifest(this.siteDir);
        await change(manifest);
        await buildSite(this.noatHome, this.siteDir, manifest);
        await pushSite(this.siteDir, message);
        this.remember(manifest);
        return manifest;
      } catch (error) {
        throw gitFailure(error, target.remote);
      }
    });
  }

  async publish(node: NoatNode | undefined): Promise<void> {
    const notePath = await targetNotePath(
      this.noatHome,
      node,
      'Which note do you want to publish to the web?'
    );
    if (!notePath) return;
    const target = await this.target(true);
    if (!target) return;

    const note = parseNote(await fs.readFile(notePath, 'utf8'));
    const before = { firstPage: false };
    const manifest = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `NOAT: publishing "${note.title}"…`,
      },
      () =>
        this.update(target, `publish: ${commitTitle(note.title)}`, (current) => {
          before.firstPage = Object.keys(current.pages).length === 0;
          addToManifest(current, note);
        })
    );
    const page = manifest.pages[note.id];
    if (!page) return;

    const url = pageUrl(target.siteUrl, page.slug);
    await vscode.env.clipboard.writeText(url);
    const pagesSettings = before.firstPage ? githubPagesSettingsUrl(target.remote) : undefined;
    const choice = await vscode.window.showInformationMessage(
      pagesSettings
        ? `NOAT: published "${note.title}" and copied the link. First time? Turn on GitHub Pages for the repo (deploy from branch "main", root) so the link goes live.`
        : `NOAT: published "${note.title}" and copied the link: ${url}`,
      'Open Page',
      ...(pagesSettings ? ['Enable GitHub Pages'] : [])
    );
    if (choice === 'Open Page') void vscode.env.openExternal(vscode.Uri.parse(url));
    if (choice === 'Enable GitHub Pages' && pagesSettings) {
      void vscode.env.openExternal(vscode.Uri.parse(pagesSettings));
    }
  }

  async unpublish(node: NoatNode | undefined): Promise<void> {
    const target = await this.target(false);
    if (!target) {
      vscode.window.showInformationMessage('NOAT: no notes have been published yet.');
      return;
    }
    const manifest = await this.run(async () => {
      try {
        await syncSiteRepo(this.siteDir, target.remote);
      } catch (error) {
        throw gitFailure(error, target.remote);
      }
      return readManifest(this.siteDir);
    });

    // The note this was invoked on, if it's published; otherwise any page,
    // including ones whose note has since been deleted.
    const candidatePath =
      node?.type === 'entry' && node.entry.kind === 'note' ? node.entry.absPath : activeNotePath();
    const candidateId = candidatePath
      ? await fs
          .readFile(candidatePath, 'utf8')
          .then((raw) => parseNote(raw).id)
          .catch(() => undefined)
      : undefined;
    const noteId = await (async () => {
      if (candidateId && manifest.pages[candidateId]) return candidateId;
      const pages = Object.entries(manifest.pages);
      if (pages.length === 0) {
        vscode.window.showInformationMessage('NOAT: no notes are published right now.');
        return undefined;
      }
      const picked = await vscode.window.showQuickPick(
        pages.map(([id, page]) => ({
          label: page.title || 'Untitled',
          description: pageUrl(target.siteUrl, page.slug),
          id,
        })),
        { placeHolder: 'Which page do you want to unpublish?' }
      );
      return picked?.id;
    })();
    if (!noteId) return;

    const title = manifest.pages[noteId]?.title || 'Untitled';
    const confirmed = await vscode.window.showWarningMessage(
      `Unpublish "${title}"?`,
      { modal: true, detail: 'Its public link stops working once the site redeploys.' },
      'Unpublish'
    );
    if (confirmed !== 'Unpublish') return;

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `NOAT: unpublishing "${title}"…` },
      () =>
        this.update(target, `unpublish: ${commitTitle(title)}`, async (current) => {
          await removeFromManifest(this.siteDir, current, noteId);
        })
    );
    vscode.window.showInformationMessage(`NOAT: unpublished "${title}".`);
  }

  /** Re-publish shortly after a published note is saved. */
  async noteSaved(filePath: string): Promise<void> {
    if (this.publishedIds.size === 0) return;
    if (!vscode.workspace.getConfiguration('noat.publish').get<boolean>('autoUpdate', true)) return;
    const notesRoot = getNotesRoot(this.noatHome);
    if (!filePath.startsWith(notesRoot + path.sep) || !filePath.endsWith(NOTE_EXTENSION)) return;
    const noteId = await fs
      .readFile(filePath, 'utf8')
      .then((raw) => parseNote(raw).id)
      .catch(() => undefined);
    if (!noteId || !this.publishedIds.has(noteId)) return;

    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.autoTimer = setTimeout(() => void this.autoUpdate(), AUTO_UPDATE_MS);
  }

  private async autoUpdate(): Promise<void> {
    const target = await this.target(false);
    if (!target) return;
    try {
      await this.update(target, 'update published notes', () => undefined);
      this.autoUpdateFailing = false;
    } catch (error) {
      logError('auto-updating published notes failed', error);
      // Warn once per failure streak, not on every save.
      if (!this.autoUpdateFailing) {
        vscode.window.showWarningMessage(
          `NOAT: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      this.autoUpdateFailing = true;
    }
  }
}

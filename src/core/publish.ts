import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { assetFileFromUrl } from './assets';
import { type HtmlLinkResolver, noteToHtml } from './html-export';
import { type NoteFile, parseNote } from './note';
import { statAllNotes } from './note-listing';
import { getAssetsDir, getNotesRoot } from './paths';

/**
 * Publishing notes as web pages. Published notes are rendered to static HTML
 * in a local clone of a git repository the user owns (<noatHome>/site) and
 * pushed to its `main` branch, which GitHub Pages (or any static host
 * watching the repo) serves. Each note gets a stable folder:
 * `<site>/<slug>/index.html`, i.e. `https://you.github.io/notes/<slug>/`.
 *
 * The site repo is the source of truth for what is published: its
 * `noat-site.json` manifest maps note ids to slugs, so the same site can be
 * published to from several machines.
 */

const execFileAsync = promisify(execFile);
const MANIFEST_FILE = 'noat-site.json';
const SITE_BRANCH = 'main';
const SLUG_MAX_CHARS = 60;

export interface PublishedPage {
  slug: string;
  title: string;
  publishedAt: string;
  updatedAt: string;
}

export interface SiteManifest {
  version: 1;
  /** Keyed by note id, which survives renames and moves. */
  pages: Record<string, PublishedPage>;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    // Fail instead of hanging on a credential prompt nobody can see. The
    // timeout covers prompts GIT_TERMINAL_PROMPT doesn't, like ssh passphrases.
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim();
}

/**
 * The GitHub Pages URL for a github.com remote: `owner.github.io` repos serve
 * at the root, any other repo under `/<repo>/`. Undefined for other hosts.
 */
export function githubPagesUrl(remote: string): string | undefined {
  const match = remote
    .trim()
    .replace(/\.git$/, '')
    .match(/github\.com[:/]([\w.-]+)\/([\w.-]+)$/i);
  if (!match?.[1] || !match[2]) return undefined;
  const owner = match[1].toLowerCase();
  const repo = match[2];
  return repo.toLowerCase() === `${owner}.github.io`
    ? `https://${owner}.github.io/`
    : `https://${owner}.github.io/${repo}/`;
}

/** Settings page where GitHub Pages is switched on, for github.com remotes. */
export function githubPagesSettingsUrl(remote: string): string | undefined {
  const match = remote
    .trim()
    .replace(/\.git$/, '')
    .match(/github\.com[:/]([\w.-]+)\/([\w.-]+)$/i);
  return match ? `https://github.com/${match[1]}/${match[2]}/settings/pages` : undefined;
}

/** URL-safe slug: the title in kebab case plus the start of the note id. */
export function pageSlug(title: string, noteId: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_CHARS)
    .replace(/-+$/, '');
  const suffix = noteId
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 8)
    .toLowerCase();
  return [base || 'untitled', suffix].filter((part) => part.length > 0).join('-');
}

export function pageUrl(siteUrl: string, slug: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/${slug}/`;
}

/** The shape pageSlug produces. Anything else could escape the site folder. */
const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isSafeSlug(slug: unknown): slug is string {
  return typeof slug === 'string' && SAFE_SLUG.test(slug);
}

/** A page's folder. Throws on unsafe slugs rather than touch a path outside the site. */
function pageDirOf(siteDir: string, slug: string): string {
  if (!isSafeSlug(slug)) throw new Error(`Refusing unsafe page slug: ${JSON.stringify(slug)}`);
  return path.join(siteDir, slug);
}

/**
 * The manifest comes from the remote repository, so it is untrusted input:
 * pages with a malformed slug (e.g. "../..") are dropped, never acted on.
 */
export async function readManifest(siteDir: string): Promise<SiteManifest> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(siteDir, MANIFEST_FILE), 'utf8'));
    if (parsed?.version === 1 && typeof parsed.pages === 'object' && parsed.pages !== null) {
      const pages = Object.entries(parsed.pages as Record<string, unknown>).filter(
        (entry): entry is [string, PublishedPage] => {
          const page = entry[1] as Partial<PublishedPage> | null;
          return typeof page === 'object' && page !== null && isSafeSlug(page.slug);
        }
      );
      return { version: 1, pages: Object.fromEntries(pages) };
    }
  } catch {
    // Missing or unreadable: nothing published yet.
  }
  return { version: 1, pages: {} };
}

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(
    () => true,
    () => false
  );
}

/**
 * Make `siteDir` a clone of `remote` at the remote's latest `main`. Local
 * state is disposable — every page is regenerated from notes on publish — so
 * this hard-resets rather than merging.
 */
export async function syncSiteRepo(siteDir: string, remote: string): Promise<void> {
  // git would parse a leading "-" as an option, not a URL.
  if (remote.startsWith('-')) throw new Error(`Invalid publish repository: ${remote}`);
  const reinit = async (): Promise<void> => {
    await fs.rm(siteDir, { recursive: true, force: true });
    await fs.mkdir(siteDir, { recursive: true });
    await git(siteDir, ['init', '-b', SITE_BRANCH]);
    await git(siteDir, ['remote', 'add', 'origin', remote]);
  };

  // Checked by .git rather than `rev-parse`: siteDir sits inside the note
  // store, which is itself a git repo.
  const currentRemote = (await exists(path.join(siteDir, '.git')))
    ? await git(siteDir, ['remote', 'get-url', 'origin']).catch(() => undefined)
    : undefined;
  // A different remote means a different site: nothing from the old clone
  // (pages, manifest, remote-tracking refs) may carry over.
  if (currentRemote !== remote) await reinit();

  await git(siteDir, ['fetch', '--prune', 'origin']);
  const remoteRef = `refs/remotes/origin/${SITE_BRANCH}`;
  const hasRemoteBranch = await git(siteDir, ['rev-parse', '--verify', '--quiet', remoteRef]).then(
    () => true,
    () => false
  );
  if (hasRemoteBranch) {
    await git(siteDir, ['checkout', '-B', SITE_BRANCH, remoteRef]);
    await git(siteDir, ['reset', '--hard', remoteRef]);
    await git(siteDir, ['clean', '-fd']);
  } else {
    // Nothing published yet: drop leftovers, e.g. from a push that failed.
    await reinit();
  }
}

/** Commit everything in the site repo and push it. No-op when nothing changed. */
export async function pushSite(siteDir: string, message: string): Promise<boolean> {
  await git(siteDir, ['add', '-A']);
  const status = await git(siteDir, ['status', '--porcelain']);
  if (status.length === 0) return false;
  await git(siteDir, [
    '-c',
    'user.name=NOAT',
    '-c',
    'user.email=noat@localhost',
    'commit',
    '-m',
    message,
  ]);
  await git(siteDir, ['push', 'origin', `HEAD:${SITE_BRANCH}`]);
  return true;
}

/** Every note in the store by id, with its store-relative ("/"-separated) path. */
async function notesById(
  noatHome: string
): Promise<Map<string, { notePath: string; note: NoteFile }>> {
  const notesRoot = getNotesRoot(noatHome);
  const byId = new Map<string, { notePath: string; note: NoteFile }>();
  for (const stat of await statAllNotes(noatHome)) {
    try {
      const note = parseNote(await fs.readFile(path.join(notesRoot, stat.notePath), 'utf8'));
      byId.set(note.id, { notePath: stat.notePath.split(path.sep).join('/'), note });
    } catch {
      // Unreadable notes can't be published; skip them.
    }
  }
  return byId;
}

const INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>NOAT</title>
<style>body{font:16px/1.6 ui-sans-serif,-apple-system,"Segoe UI",sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;color:#787774}</style></head>
<body><p>Published with NOAT.</p></body>
</html>
`;

/**
 * Regenerate every published page whose note exists in this store, and write
 * `manifest`. Re-rendering all pages (not just the one being published) keeps
 * links between published notes and their titles current. Pages whose note
 * isn't in this store — published from another machine — are left untouched.
 */
export async function buildSite(
  noatHome: string,
  siteDir: string,
  manifest: SiteManifest
): Promise<void> {
  const notes = await notesById(noatHome);
  const slugByPath = new Map<string, string>();
  for (const [noteId, page] of Object.entries(manifest.pages)) {
    const found = notes.get(noteId);
    if (found) slugByPath.set(found.notePath, page.slug);
  }

  const assetsDir = getAssetsDir(noatHome);
  const assets = new Set<string>();
  // Pages live one folder deep, so site-root files are one level up.
  const links: HtmlLinkResolver = {
    noteHref: (notePath) => {
      const slug = slugByPath.get(notePath);
      return slug ? `../${slug}/` : undefined;
    },
    assetHref: (url) => {
      const file = assetFileFromUrl(url);
      if (!file) return undefined;
      assets.add(file);
      return `../assets/${encodeURIComponent(file)}`;
    },
  };

  for (const [noteId, page] of Object.entries(manifest.pages)) {
    const found = notes.get(noteId);
    if (!found) continue;
    page.title = found.note.title;
    page.updatedAt = found.note.updatedAt;
    const pageDir = pageDirOf(siteDir, page.slug);
    await fs.mkdir(pageDir, { recursive: true });
    await fs.writeFile(path.join(pageDir, 'index.html'), noteToHtml(found.note, links));
  }

  if (assets.size > 0) await fs.mkdir(path.join(siteDir, 'assets'), { recursive: true });
  for (const file of assets) {
    await fs
      .copyFile(path.join(assetsDir, file), path.join(siteDir, 'assets', file))
      .catch(() => undefined);
  }

  // GitHub Pages runs Jekyll by default, which hides folders starting with "_".
  await fs.writeFile(path.join(siteDir, '.nojekyll'), '');
  if (!(await exists(path.join(siteDir, 'index.html')))) {
    await fs.writeFile(path.join(siteDir, 'index.html'), INDEX_HTML);
  }
  await fs.writeFile(path.join(siteDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Add (or keep) `note` in the manifest, returning its page. */
export function addToManifest(manifest: SiteManifest, note: NoteFile): PublishedPage {
  const existing = manifest.pages[note.id];
  if (existing) return existing;
  const taken = new Set(Object.values(manifest.pages).map((page) => page.slug));
  const base = pageSlug(note.title, note.id);
  const slug = taken.has(base)
    ? (Array.from({ length: 98 }, (_, i) => `${base}-${i + 2}`).find((s) => !taken.has(s)) ??
      `${base}-${Date.now()}`)
    : base;
  const now = new Date().toISOString();
  const page: PublishedPage = {
    slug,
    title: note.title,
    publishedAt: now,
    updatedAt: note.updatedAt,
  };
  manifest.pages[note.id] = page;
  return page;
}

/** Drop a note's page from the manifest and delete its folder. */
export async function removeFromManifest(
  siteDir: string,
  manifest: SiteManifest,
  noteId: string
): Promise<PublishedPage | undefined> {
  const page = manifest.pages[noteId];
  if (!page) return undefined;
  delete manifest.pages[noteId];
  await fs.rm(pageDirOf(siteDir, page.slug), { recursive: true, force: true });
  return page;
}

/** A note title squeezed onto one git subject line. */
export function commitTitle(title: string): string {
  return (title.replace(/\s+/g, ' ').trim() || 'Untitled').slice(0, 72);
}

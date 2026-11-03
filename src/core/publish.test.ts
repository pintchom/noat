import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type NoteFile, serializeNote } from './note';
import { getAssetsDir, getGlobalNotesDir, getSiteDir } from './paths';
import {
  addToManifest,
  buildSite,
  githubPagesSettingsUrl,
  githubPagesUrl,
  pageSlug,
  pageUrl,
  pushSite,
  readManifest,
  removeFromManifest,
  syncSiteRepo,
} from './publish';
import { initStore } from './store';

describe('githubPagesUrl', () => {
  it('derives project and user site URLs from https and ssh remotes', () => {
    expect(githubPagesUrl('https://github.com/Max/notes.git')).toBe('https://max.github.io/notes/');
    expect(githubPagesUrl('git@github.com:max/notes')).toBe('https://max.github.io/notes/');
    expect(githubPagesUrl('git@github.com:max/max.github.io.git')).toBe('https://max.github.io/');
  });

  it('is undefined for other hosts', () => {
    expect(githubPagesUrl('git@gitlab.com:max/notes.git')).toBeUndefined();
  });

  it('points at the Pages settings page', () => {
    expect(githubPagesSettingsUrl('git@github.com:max/notes.git')).toBe(
      'https://github.com/max/notes/settings/pages'
    );
  });
});

describe('pageSlug / pageUrl', () => {
  it('kebab-cases the title and appends the id prefix', () => {
    expect(pageSlug('Café — Deploy Plan!', 'ab12cd34-ef56')).toBe('cafe-deploy-plan-ab12cd34');
    expect(pageSlug('🚀', 'ab12cd34')).toBe('untitled-ab12cd34');
  });

  it('joins site and slug with exactly one slash', () => {
    expect(pageUrl('https://max.github.io/notes/', 'a-1')).toBe('https://max.github.io/notes/a-1/');
    expect(pageUrl('https://notes.example.com', 'a-1')).toBe('https://notes.example.com/a-1/');
  });
});

describe('publishing to a git remote', () => {
  let tmp: string;
  let noatHome: string;
  let remote: string;

  const note = (id: string, title: string, blocks: unknown[]): NoteFile => ({
    version: 1,
    id,
    title,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
    blocks: blocks as NoteFile['blocks'],
  });

  const writeNote = async (fileName: string, value: NoteFile): Promise<void> => {
    await fs.writeFile(path.join(getGlobalNotesDir(noatHome), fileName), serializeNote(value));
  };

  const remoteFile = (file: string): string =>
    execFileSync('git', ['--git-dir', remote, 'show', `main:${file}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'noat-publish-'));
    noatHome = path.join(tmp, 'home');
    remote = path.join(tmp, 'site.git');
    await initStore(noatHome);
    execFileSync('git', ['init', '--bare', '-b', 'main', remote]);
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('publishes, cross-links, and unpublishes pages', async () => {
    const siteDir = getSiteDir(noatHome);
    await fs.mkdir(getAssetsDir(noatHome), { recursive: true });
    await fs.writeFile(path.join(getAssetsDir(noatHome), 'shot-1.png'), 'png');
    await writeNote(
      'Plan.noat.json',
      note('plan0001', 'Plan', [
        {
          id: 'p',
          type: 'paragraph',
          content: [
            { type: 'noteLink', props: { notePath: 'global/Notes.noat.json', title: 'Notes' } },
          ],
        },
        { id: 'i', type: 'image', props: { url: 'assets/shot-1.png' } },
      ])
    );
    await writeNote('Notes.noat.json', note('notes001', 'Notes', []));

    // Publish "Plan" alone: its link to the unpublished "Notes" is plain text.
    await syncSiteRepo(siteDir, remote);
    const manifest = await readManifest(siteDir);
    const plan = addToManifest(manifest, note('plan0001', 'Plan', []));
    await buildSite(noatHome, siteDir, manifest);
    expect(await pushSite(siteDir, 'publish: Plan')).toBe(true);
    expect(plan.slug).toBe('plan-plan0001');
    expect(remoteFile('plan-plan0001/index.html')).toContain('<span class="chip">Notes</span>');
    expect(remoteFile('assets/shot-1.png')).toBe('png');
    expect(remoteFile('.nojekyll')).toBe('');

    // Publishing "Notes" from a fresh clone re-renders "Plan" with a real link.
    await fs.rm(siteDir, { recursive: true, force: true });
    await syncSiteRepo(siteDir, remote);
    const again = await readManifest(siteDir);
    expect(Object.keys(again.pages)).toEqual(['plan0001']);
    addToManifest(again, note('notes001', 'Notes', []));
    await buildSite(noatHome, siteDir, again);
    await pushSite(siteDir, 'publish: Notes');
    expect(remoteFile('plan-plan0001/index.html')).toContain(
      '<a class="chip" href="../notes-notes001/">Notes</a>'
    );

    // Rebuilding with nothing changed makes no commit.
    await syncSiteRepo(siteDir, remote);
    await buildSite(noatHome, siteDir, await readManifest(siteDir));
    expect(await pushSite(siteDir, 'noop')).toBe(false);

    // Unpublishing deletes the page and turns links to it back into text.
    await syncSiteRepo(siteDir, remote);
    const last = await readManifest(siteDir);
    await removeFromManifest(siteDir, last, 'notes001');
    await buildSite(noatHome, siteDir, last);
    await pushSite(siteDir, 'unpublish: Notes');
    expect(() => remoteFile('notes-notes001/index.html')).toThrow();
    expect(remoteFile('plan-plan0001/index.html')).toContain('<span class="chip">Notes</span>');
  });

  it('keeps a page slug stable when the note is renamed', async () => {
    const siteDir = getSiteDir(noatHome);
    await writeNote('Plan.noat.json', note('plan0001', 'Plan', []));
    await syncSiteRepo(siteDir, remote);
    const manifest = await readManifest(siteDir);
    addToManifest(manifest, note('plan0001', 'Plan', []));
    expect(addToManifest(manifest, note('plan0001', 'Renamed', [])).slug).toBe('plan-plan0001');
  });
});

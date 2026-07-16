import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isGitRepo } from './git';
import { listAllNotes } from './note-listing';
import { getGlobalNotesDir } from './paths';
import {
  createFolder,
  createNote,
  deleteEntry,
  initStore,
  listEntries,
  listRepoScopes,
  moveEntry,
  moveToScope,
  readNote,
  renameNote,
  scopeDir,
  writeNote,
} from './store';

let noatHome: string;
let globalDir: string;

beforeEach(async () => {
  noatHome = await fs.mkdtemp(path.join(os.tmpdir(), 'noat-test-'));
  await initStore(noatHome);
  globalDir = getGlobalNotesDir(noatHome);
});

afterEach(async () => {
  await fs.rm(noatHome, { recursive: true, force: true });
});

describe('initStore', () => {
  it('creates the layout and a git repo', async () => {
    await expect(fs.access(globalDir)).resolves.toBeUndefined();
    expect(await isGitRepo(noatHome)).toBe(true);
  });

  it('is idempotent', async () => {
    await expect(initStore(noatHome)).resolves.toBeUndefined();
  });

  it('writes required gitignore entries', async () => {
    const content = await fs.readFile(path.join(noatHome, '.gitignore'), 'utf8');
    const lines = content.split('\n');
    for (const entry of ['.cache/', '.index/', '.DS_Store', 'mcp/']) {
      expect(lines).toContain(entry);
    }
  });

  it('appends missing gitignore entries without disturbing existing lines', async () => {
    const gitignorePath = path.join(noatHome, '.gitignore');
    await fs.writeFile(gitignorePath, 'custom/\n.cache/\n');
    await initStore(noatHome);
    const lines = (await fs.readFile(gitignorePath, 'utf8')).split('\n');
    expect(lines).toContain('custom/');
    expect(lines).toContain('mcp/');
    expect(lines.filter((line) => line === '.cache/')).toHaveLength(1);
    await initStore(noatHome);
    expect(await fs.readFile(gitignorePath, 'utf8')).toBe(lines.join('\n'));
  });
});

describe('notes CRUD', () => {
  it('creates a note with a valid envelope', async () => {
    const notePath = await createNote(globalDir, 'My First Note');
    const note = await readNote(notePath);
    expect(note.title).toBe('My First Note');
    expect(note.version).toBe(1);
    expect(note.icon).toBeUndefined();
    expect(note.blocks).toEqual([]);
  });

  it('deduplicates colliding titles', async () => {
    const first = await createNote(globalDir, 'Dup');
    const second = await createNote(globalDir, 'Dup');
    expect(path.basename(first)).toBe('Dup.noat.json');
    expect(path.basename(second)).toBe('Dup 2.noat.json');
  });

  it('sanitizes unsafe titles', async () => {
    const notePath = await createNote(globalDir, 'a/b:c*d');
    expect(path.basename(notePath)).toBe('a-b-c-d.noat.json');
  });

  it('round-trips writes and bumps updatedAt', async () => {
    const notePath = await createNote(globalDir, 'Note');
    const note = await readNote(notePath);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await writeNote(notePath, { ...note, blocks: [{ id: 'b1', type: 'paragraph' }] });
    const reread = await readNote(notePath);
    expect(reread.blocks).toHaveLength(1);
    expect(reread.updatedAt > note.updatedAt).toBe(true);
  });

  it('renames a note file and its embedded title', async () => {
    const notePath = await createNote(globalDir, 'Old');
    const note = await readNote(notePath);
    await writeNote(notePath, { ...note, icon: '🔥' });
    const newPath = await renameNote(notePath, 'New');
    expect(path.basename(newPath)).toBe('New.noat.json');
    expect(await readNote(newPath)).toMatchObject({ title: 'New', icon: '🔥' });
    await expect(fs.access(notePath)).rejects.toThrow();
  });

  it('deletes notes and folders', async () => {
    const notePath = await createNote(globalDir, 'Bye');
    await deleteEntry(notePath);
    await expect(fs.access(notePath)).rejects.toThrow();
  });
});

describe('listEntries', () => {
  it('lists folders before notes, alphabetically, skipping dotfiles', async () => {
    await createNote(globalDir, 'zeta');
    const alphaPath = await createNote(globalDir, 'alpha');
    const alpha = await readNote(alphaPath);
    await writeNote(alphaPath, { ...alpha, icon: '💡' });
    await createFolder(globalDir, 'stuff');
    await fs.writeFile(path.join(globalDir, '.hidden'), '');
    await fs.writeFile(path.join(globalDir, 'random.txt'), 'not a note');

    const entries = await listEntries(globalDir, { type: 'global' });
    expect(entries.map((e) => `${e.kind}:${e.name}`)).toEqual([
      'folder:stuff',
      'note:alpha',
      'note:zeta',
    ]);
    expect(entries.find((entry) => entry.name === 'alpha')?.icon).toBe('💡');
    expect(entries.find((entry) => entry.name === 'zeta')?.icon).toBeUndefined();
    expect((await listAllNotes(noatHome)).find((note) => note.title === 'alpha')?.icon).toBe('💡');
  });
});

describe('moveToScope', () => {
  it('moves a note between scopes', async () => {
    const notePath = await createNote(globalDir, 'Movable');
    const repoScope = { type: 'repo', repoKey: 'github.com--foo--bar' } as const;
    const newPath = await moveToScope(notePath, noatHome, repoScope);
    expect(newPath).toBe(path.join(scopeDir(noatHome, repoScope), 'Movable.noat.json'));
    expect((await readNote(newPath)).title).toBe('Movable');
  });

  it('deduplicates on collision in the target scope', async () => {
    const repoScope = { type: 'repo', repoKey: 'k' } as const;
    await createNote(scopeDir(noatHome, repoScope), 'Same');
    const notePath = await createNote(globalDir, 'Same');
    const newPath = await moveToScope(notePath, noatHome, repoScope);
    expect(path.basename(newPath)).toBe('Same 2.noat.json');
  });
});

describe('moveEntry', () => {
  it('moves a note into a folder', async () => {
    const notePath = await createNote(globalDir, 'Drag me');
    const folderPath = await createFolder(globalDir, 'Inbox');
    const newPath = await moveEntry(notePath, folderPath);
    expect(newPath).toBe(path.join(folderPath, 'Drag me.noat.json'));
    await expect(fs.access(notePath)).rejects.toThrow();
    expect((await readNote(newPath)).title).toBe('Drag me');
  });

  it('moves a folder into another folder', async () => {
    const child = await createFolder(globalDir, 'Child');
    const parent = await createFolder(globalDir, 'Parent');
    const newPath = await moveEntry(child, parent);
    expect(newPath).toBe(path.join(parent, 'Child'));
  });

  it('is a no-op when the entry is already in the target dir', async () => {
    const notePath = await createNote(globalDir, 'Stay');
    const result = await moveEntry(notePath, globalDir);
    expect(result).toBe(notePath);
  });

  it('refuses to move a folder into itself', async () => {
    const folderPath = await createFolder(globalDir, 'Loop');
    await expect(moveEntry(folderPath, folderPath)).rejects.toThrow(/itself/);
  });

  it('refuses to move a folder into a descendant', async () => {
    const parent = await createFolder(globalDir, 'Parent');
    const child = await createFolder(parent, 'Child');
    await expect(moveEntry(parent, child)).rejects.toThrow(/itself/);
  });

  it('deduplicates colliding names in the target folder', async () => {
    const folderPath = await createFolder(globalDir, 'Dest');
    await createNote(folderPath, 'Clash');
    const notePath = await createNote(globalDir, 'Clash');
    const newPath = await moveEntry(notePath, folderPath);
    expect(path.basename(newPath)).toBe('Clash 2.noat.json');
  });
});

describe('listRepoScopes', () => {
  it('lists on-disk repo scopes with labels', async () => {
    await createNote(
      scopeDir(noatHome, { type: 'repo', repoKey: 'github.com--acme--widgets' }),
      'A'
    );
    await createNote(scopeDir(noatHome, { type: 'repo', repoKey: 'github.com--zoo--app' }), 'B');

    const scopes = await listRepoScopes(noatHome);
    expect(scopes).toEqual([
      { repoKey: 'github.com--acme--widgets', label: 'acme/widgets' },
      { repoKey: 'github.com--zoo--app', label: 'zoo/app' },
    ]);
  });
});

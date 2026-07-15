import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { statAllNotes } from './note-listing';
import { getGlobalNotesDir } from './paths';
import { createNote, initStore, readNote, writeNote } from './store';

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

describe('statAllNotes', () => {
  it('lists every note with mtime and size, skipping non-notes and dotfiles', async () => {
    await createNote(globalDir, 'One');
    await createNote(globalDir, 'Two');
    await fs.writeFile(path.join(globalDir, '.hidden'), '');
    await fs.writeFile(path.join(globalDir, 'random.txt'), 'not a note');

    const stats = await statAllNotes(noatHome);
    expect(stats.map((s) => s.notePath).sort()).toEqual([
      path.join('global', 'One.noat.json'),
      path.join('global', 'Two.noat.json'),
    ]);
    for (const stat of stats) {
      expect(stat.size).toBeGreaterThan(0);
      expect(stat.mtimeMs).toBeGreaterThan(0);
    }
  });

  it('reflects writes in the mtime/size signature', async () => {
    const abs = await createNote(globalDir, 'Changing');
    const before = (await statAllNotes(noatHome))[0];
    await new Promise((resolve) => setTimeout(resolve, 5));
    const note = await readNote(abs);
    await writeNote(abs, { ...note, blocks: [{ id: 'b1', type: 'paragraph' }] });
    const after = (await statAllNotes(noatHome))[0];
    expect(`${after?.mtimeMs}:${after?.size}`).not.toBe(`${before?.mtimeMs}:${before?.size}`);
  });
});

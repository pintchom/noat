import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type PostIt,
  type PostItRange,
  postItFilePath,
  previewSnippet,
  readPostItFiles,
  reanchorRange,
  shiftRange,
  trackRange,
  writeNotePostIts,
} from './post-its';

function range(sl: number, sc: number, el: number, ec: number): PostItRange {
  return { start: { line: sl, character: sc }, end: { line: el, character: ec } };
}

function postIt(overrides: Partial<PostIt> = {}): PostIt {
  return {
    id: 'p1',
    noteId: 'note-1',
    repoKey: 'github.com--me--repo',
    file: 'src/index.ts',
    range: range(1, 0, 1, 10),
    snippet: 'const x = 1',
    text: 'why x',
    createdAt: '2026-11-18T00:00:00Z',
    updatedAt: '2026-11-18T00:00:00Z',
    ...overrides,
  };
}

describe('shiftRange', () => {
  const target = range(5, 4, 7, 2);

  it('leaves the range alone for edits after it', () => {
    expect(shiftRange(target, { range: range(9, 0, 9, 0), text: 'x\ny\n' })).toEqual(target);
  });

  it('moves the range down when lines are inserted above it', () => {
    expect(shiftRange(target, { range: range(1, 0, 1, 0), text: 'a\nb\n' })).toEqual(
      range(7, 4, 9, 2)
    );
  });

  it('moves the range up when lines above it are deleted', () => {
    expect(shiftRange(target, { range: range(1, 0, 3, 0), text: '' })).toEqual(range(3, 4, 5, 2));
  });

  it('shifts characters for an insert earlier on its start line', () => {
    expect(shiftRange(target, { range: range(5, 0, 5, 0), text: '  ' })).toEqual(range(5, 6, 7, 2));
  });

  it('pushes the range along when typing right at its start', () => {
    expect(shiftRange(target, { range: range(5, 4, 5, 4), text: 'ab' })).toEqual(range(5, 6, 7, 2));
  });

  it('does not grow when typing right at its end', () => {
    expect(shiftRange(target, { range: range(7, 2, 7, 2), text: 'ab' })).toEqual(target);
  });

  it('grows with lines added inside it', () => {
    expect(shiftRange(target, { range: range(6, 0, 6, 0), text: 'new\n' })).toEqual(
      range(5, 4, 8, 2)
    );
  });

  it('collapses to the edit when it is deleted outright', () => {
    expect(shiftRange(target, { range: range(4, 0, 8, 0), text: '' })).toEqual(range(4, 0, 4, 0));
  });
});

describe('reanchorRange', () => {
  const text = ['line zero', 'function foo() {', '  return 1;', '}', 'foo();'].join('\n');

  it('keeps a range that still holds its snippet', () => {
    expect(reanchorRange(text, range(1, 9, 1, 14), 'foo()')).toEqual(range(1, 9, 1, 14));
  });

  it('finds a snippet that moved', () => {
    const moved = `// header\n// more\n${text}`;
    expect(reanchorRange(moved, range(1, 0, 3, 1), 'function foo() {\n  return 1;\n}')).toEqual(
      range(3, 0, 5, 1)
    );
  });

  it('picks the occurrence nearest the old spot', () => {
    expect(reanchorRange(text, range(4, 1, 4, 6), 'foo()')).toEqual(range(4, 0, 4, 5));
    expect(reanchorRange(text, range(1, 8, 1, 13), 'foo()')).toEqual(range(1, 9, 1, 14));
  });

  it('keeps the old range, clamped, when the snippet is gone', () => {
    expect(reanchorRange(text, range(2, 2, 2, 99), 'missing')).toEqual(range(2, 2, 2, 11));
    expect(reanchorRange(text, range(40, 0, 41, 0), 'missing')).toEqual(range(4, 0, 4, 0));
  });

  it('handles CRLF documents', () => {
    const crlf = 'a\r\nbb\r\nccc';
    expect(reanchorRange(crlf, range(1, 0, 1, 50), 'zz')).toEqual(range(1, 0, 1, 2));
    expect(reanchorRange(crlf, range(0, 0, 0, 1), 'ccc')).toEqual(range(2, 0, 2, 3));
  });
});

describe('trackRange', () => {
  it('re-finds the snippet when a reload replaces the region around it', () => {
    const after = 'one\nnew line\ntwo\nconst x = 1\nthree';
    const changes = [{ range: range(0, 0, 3, 0), text: 'one\nnew line\ntwo\nconst x = 1\n' }];
    expect(trackRange(range(1, 0, 1, 11), changes, 'const x = 1', () => after)).toEqual(
      range(3, 0, 3, 11)
    );
  });

  it('re-finds a duplicated snippet nearest its old spot, not the first one', () => {
    // A reload replacing lines 0-5 wholesale, adding a header line on top.
    const before = ['retry();', 'a', 'b', 'c', 'd', 'retry();', 'e'];
    const after = ['// header', ...before].join('\n');
    const changes = [
      { range: range(0, 0, 6, 0), text: `${['// header', ...before.slice(0, 6)].join('\n')}\n` },
    ];
    expect(trackRange(range(5, 0, 5, 8), changes, 'retry();', () => after)).toEqual(
      range(6, 0, 6, 8)
    );
  });

  it('just shifts for ordinary typing elsewhere', () => {
    let read = false;
    const textAfter = () => {
      read = true;
      return '';
    };
    const changes = [{ range: range(0, 0, 0, 0), text: '\n' }];
    expect(trackRange(range(1, 0, 1, 11), changes, 'const x = 1', textAfter)).toEqual(
      range(2, 0, 2, 11)
    );
    expect(read).toBe(false);
  });
});

describe('previewSnippet', () => {
  it('dedents and drops blank edge lines', () => {
    expect(previewSnippet('\n    if (a) {\n      b();\n    }\n\n')).toBe('if (a) {\n  b();\n}');
  });

  it('caps long snippets', () => {
    const long = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n');
    expect(previewSnippet(long, 3)).toBe('line 0\nline 1\nline 2\n…');
  });
});

describe('post-it store', () => {
  let noatHome: string;

  beforeEach(async () => {
    noatHome = await fs.mkdtemp(path.join(os.tmpdir(), 'noat-postits-'));
  });

  afterEach(async () => {
    await fs.rm(noatHome, { recursive: true, force: true });
  });

  it('round-trips a note’s post-its and removes the file when emptied', async () => {
    const first = postIt({ id: 'b', range: range(9, 0, 9, 1) });
    const second = postIt({ id: 'a', range: range(2, 0, 2, 1) });
    const raw = await writeNotePostIts(noatHome, 'note-1', [first, second]);

    const files = await readPostItFiles(noatHome);
    expect(files).toHaveLength(1);
    expect(files[0]?.raw).toBe(raw);
    expect(files[0]?.postIts.map((p) => p.id)).toEqual(['a', 'b']);

    expect(await writeNotePostIts(noatHome, 'note-1', [])).toBe('');
    expect(await readPostItFiles(noatHome)).toEqual([]);
  });

  it('skips corrupt files', async () => {
    await writeNotePostIts(noatHome, 'note-1', [postIt()]);
    await fs.writeFile(path.join(noatHome, 'postits', 'broken.json'), '{ nope');
    expect((await readPostItFiles(noatHome)).map((file) => file.noteId)).toEqual(['note-1']);
  });

  it('rejects note ids that would escape the store', () => {
    expect(() => postItFilePath(noatHome, '../evil')).toThrow();
  });
});

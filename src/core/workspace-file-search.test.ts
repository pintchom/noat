import { describe, expect, it } from 'vitest';
import { rankWorkspaceFiles } from './workspace-file-search';

describe('rankWorkspaceFiles', () => {
  it('shows every changed file before filling with regular workspace files', () => {
    const files = ['README.md', 'src/a.ts', 'src/b.ts', 'src/c.ts', 'src/other.ts'];
    const changed = new Set(['src/a.ts', 'src/b.ts', 'src/c.ts']);

    expect(rankWorkspaceFiles(files, changed, '', 2)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('retains all matching changed files beyond the regular result cap', () => {
    const files = ['src/item-a.ts', 'src/item-b.ts', 'src/item-c.ts', 'test/item.test.ts'];
    const changed = new Set(['src/item-a.ts', 'src/item-b.ts', 'src/item-c.ts']);

    expect(rankWorkspaceFiles(files, changed, 'item', 2)).toEqual([
      'src/item-a.ts',
      'src/item-b.ts',
      'src/item-c.ts',
    ]);
  });

  it('prioritizes match quality, then changed files', () => {
    const files = ['docs/configuration.md', 'src/config.ts', 'test/config.test.ts'];
    const changed = new Set(['docs/configuration.md', 'test/config.test.ts']);

    expect(rankWorkspaceFiles(files, changed, 'config.ts', 10)[0]).toBe('src/config.ts');
    expect(rankWorkspaceFiles(files, changed, 'config', 10)).toEqual([
      'test/config.test.ts',
      'docs/configuration.md',
      'src/config.ts',
    ]);
  });

  it('supports ordered fuzzy matches across a path', () => {
    const files = ['src/components/FileSearch.ts', 'src/workspace.ts'];

    expect(rankWorkspaceFiles(files, new Set(), 'flsrch', 10)).toEqual([
      'src/components/FileSearch.ts',
    ]);
  });

  it('deduplicates candidates and omits non-matches', () => {
    const files = ['src/note.ts', 'src/note.ts', 'src/store.ts'];

    expect(rankWorkspaceFiles(files, new Set(), 'note', 10)).toEqual(['src/note.ts']);
  });
});

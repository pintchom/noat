import { describe, expect, it } from 'vitest';
import { rankNoteLinks } from './note-link-search';
import type { NoteListing } from './note-listing';

function listing(title: string, notePath: string, updatedAt: string): NoteListing {
  return { notePath, title, scope: 'global', updatedAt };
}

// Recency-ordered, as listAllNotes returns them.
const listings: NoteListing[] = [
  listing('Meeting notes', 'global/Meeting notes.noat.json', '2026-07-15T00:00:00Z'),
  listing('Ideas', 'global/Ideas.noat.json', '2026-07-14T00:00:00Z'),
  listing('Big ideas board', 'global/Big ideas board.noat.json', '2026-07-13T00:00:00Z'),
  listing('Ideas archive', 'global/old/Ideas archive.noat.json', '2026-07-12T00:00:00Z'),
  listing('Roadmap', 'global/planning/Roadmap.noat.json', '2026-07-11T00:00:00Z'),
];

describe('rankNoteLinks', () => {
  it('returns recent notes in order for an empty query', () => {
    expect(rankNoteLinks(listings, '', 3).map((entry) => entry.title)).toEqual([
      'Meeting notes',
      'Ideas',
      'Big ideas board',
    ]);
  });

  it('ranks exact title, then prefix, then substring matches', () => {
    expect(rankNoteLinks(listings, 'ideas', 10).map((entry) => entry.title)).toEqual([
      'Ideas',
      'Ideas archive',
      'Big ideas board',
    ]);
  });

  it('matches case-insensitively and trims the query', () => {
    expect(rankNoteLinks(listings, '  MEETING ', 10).map((entry) => entry.title)).toEqual([
      'Meeting notes',
    ]);
  });

  it('falls back to matching the note path (folder names)', () => {
    expect(rankNoteLinks(listings, 'planning', 10).map((entry) => entry.title)).toEqual([
      'Roadmap',
    ]);
  });

  it('keeps recency order between equally-scored matches', () => {
    const results = rankNoteLinks(listings, 'ideas a', 10).map((entry) => entry.title);
    expect(results).toEqual(['Ideas archive']);
    const substrings = rankNoteLinks(listings, 'e', 10);
    expect(substrings.map((entry) => entry.title)).toEqual([
      'Meeting notes',
      'Ideas',
      'Big ideas board',
      'Ideas archive',
    ]);
  });

  it('caps results at maxResults', () => {
    expect(rankNoteLinks(listings, '', 2)).toHaveLength(2);
    expect(rankNoteLinks(listings, 'a', 1)).toHaveLength(1);
  });

  it('returns nothing when nothing matches', () => {
    expect(rankNoteLinks(listings, 'zzz', 10)).toEqual([]);
  });
});

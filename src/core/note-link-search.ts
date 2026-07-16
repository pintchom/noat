import type { NoteListing } from './note-listing';

/**
 * Rank /page picker candidates by title match quality. Listings arrive sorted
 * by recency (listAllNotes), and Array.sort is stable, so equally-scored
 * notes keep most-recently-updated first. An empty query shows recent notes.
 */
export function rankNoteLinks(
  listings: readonly NoteListing[],
  query: string,
  maxResults: number
): NoteListing[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return listings.slice(0, maxResults);

  return listings
    .flatMap((listing) => {
      const title = listing.title.toLowerCase();
      const score = (() => {
        if (title === normalized) return 0;
        if (title.startsWith(normalized)) return 1;
        if (title.includes(normalized)) return 2;
        if (listing.notePath.toLowerCase().includes(normalized)) return 3;
        return undefined;
      })();
      return score === undefined ? [] : [{ listing, score }];
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, maxResults)
    .map((entry) => entry.listing);
}

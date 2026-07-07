import type { KeywordHit } from './keyword-index';
import type { VectorHit } from './vector-index';

export interface HybridResult {
  notePath: string;
  score: number;
  /** Best matching chunk from the semantic side, when available. */
  snippet?: { heading: string; text: string };
  sources: Array<'keyword' | 'semantic'>;
}

/** Reciprocal rank fusion: stable way to merge rankings from both engines. */
export function mergeHybrid(
  keyword: KeywordHit[],
  semantic: VectorHit[],
  limit: number
): HybridResult[] {
  const k = 60;
  const results = new Map<string, HybridResult>();

  keyword.forEach((hit, rank) => {
    const entry = results.get(hit.notePath) ?? {
      notePath: hit.notePath,
      score: 0,
      sources: [] as HybridResult['sources'],
    };
    entry.score += 1 / (k + rank + 1);
    entry.sources.push('keyword');
    results.set(hit.notePath, entry);
  });

  semantic.forEach((hit, rank) => {
    const entry = results.get(hit.notePath) ?? {
      notePath: hit.notePath,
      score: 0,
      sources: [] as HybridResult['sources'],
    };
    entry.score += 1 / (k + rank + 1);
    if (!entry.sources.includes('semantic')) entry.sources.push('semantic');
    if (!entry.snippet) entry.snippet = { heading: hit.heading, text: hit.text };
    results.set(hit.notePath, entry);
  });

  return [...results.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

interface ScoredFile {
  file: string;
  score: number;
  changed: boolean;
}

function fuzzyGapScore(value: string, query: string): number | undefined {
  const positions = [...query].reduce<number[] | undefined>((matches, character) => {
    if (!matches) return undefined;
    const previous = matches.at(-1) ?? -1;
    const position = value.indexOf(character, previous + 1);
    return position === -1 ? undefined : [...matches, position];
  }, []);
  if (!positions || positions.length === 0) return undefined;

  return positions.reduce((gaps, position, index) => {
    const previous = positions[index - 1] ?? -1;
    return gaps + position - previous - 1;
  }, 0);
}

function matchScore(file: string, query: string): number | undefined {
  if (query.length === 0) return 0;

  const lower = file.toLowerCase();
  const name = lower.split('/').pop() ?? lower;
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  if (lower.split('/').some((segment) => segment.startsWith(query))) return 3;
  if (lower.includes(query)) return 4;

  const fuzzyScore = fuzzyGapScore(lower, query);
  return fuzzyScore === undefined ? undefined : 5 + fuzzyScore;
}

function compareScoredFiles(a: ScoredFile, b: ScoredFile): number {
  return (
    a.score - b.score ||
    Number(b.changed) - Number(a.changed) ||
    a.file.length - b.file.length ||
    a.file.localeCompare(b.file)
  );
}

/**
 * Rank @-mention candidates while retaining every matching changed file.
 * Regular workspace results are capped to keep the suggestion menu responsive.
 */
export function rankWorkspaceFiles(
  files: readonly string[],
  changedFiles: ReadonlySet<string>,
  query: string,
  maxResults: number
): string[] {
  const normalizedQuery = query.trim().toLowerCase();
  const scored = [...new Set([...files, ...changedFiles])]
    .flatMap((file): ScoredFile[] => {
      const score = matchScore(file, normalizedQuery);
      return score === undefined ? [] : [{ file, score, changed: changedFiles.has(file) }];
    })
    .sort(compareScoredFiles);
  const changed = scored.filter((entry) => entry.changed);
  const regular = scored
    .filter((entry) => !entry.changed)
    .slice(0, Math.max(0, maxResults - changed.length));

  return [...changed, ...regular].sort(compareScoredFiles).map((entry) => entry.file);
}

import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { EMBEDDING_MODEL } from './embeddings';

export interface VectorChunk {
  hash: string;
  heading: string;
  text: string;
  vector: number[];
}

export interface VectorIndex {
  model: string;
  notes: Record<string, VectorChunk[]>;
}

export interface VectorHit {
  notePath: string;
  heading: string;
  text: string;
  score: number;
}

function indexFilePath(noatHome: string): string {
  return path.join(noatHome, '.index', 'vectors-v1.json');
}

export function emptyIndex(): VectorIndex {
  return { model: EMBEDDING_MODEL, notes: {} };
}

export async function loadVectorIndex(noatHome: string): Promise<VectorIndex> {
  try {
    const raw = await fs.readFile(indexFilePath(noatHome), 'utf8');
    const index = JSON.parse(raw) as VectorIndex;
    if (index.model !== EMBEDDING_MODEL) return emptyIndex();
    return index;
  } catch {
    return emptyIndex();
  }
}

export async function saveVectorIndex(noatHome: string, index: VectorIndex): Promise<void> {
  const filePath = indexFilePath(noatHome);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(index));
}

export function chunkHash(heading: string, text: string): string {
  return createHash('sha256').update(`${heading}\u0000${text}`).digest('hex').slice(0, 16);
}

/**
 * Bring a note's chunks up to date, reusing vectors for unchanged text.
 * Returns the chunk texts that still need embedding (caller embeds, then
 * assigns vectors in order).
 */
export function diffNoteChunks(
  index: VectorIndex,
  notePath: string,
  sections: Array<{ heading: string; text: string }>
): { chunks: VectorChunk[]; toEmbed: Array<{ chunkIndex: number; text: string }> } {
  const existing = new Map((index.notes[notePath] ?? []).map((chunk) => [chunk.hash, chunk]));
  const chunks: VectorChunk[] = [];
  const toEmbed: Array<{ chunkIndex: number; text: string }> = [];

  sections.forEach((section, chunkIndex) => {
    const hash = chunkHash(section.heading, section.text);
    const reused = existing.get(hash);
    if (reused) {
      chunks.push(reused);
    } else {
      chunks.push({ hash, heading: section.heading, text: section.text, vector: [] });
      toEmbed.push({
        chunkIndex,
        text: section.heading ? `${section.heading}\n${section.text}` : section.text,
      });
    }
  });

  return { chunks, toEmbed };
}

export function removeNote(index: VectorIndex, notePath: string): void {
  delete index.notes[notePath];
}

/** Notes present in the index but not in `livePaths` (deleted/renamed notes). */
export function stalePaths(index: VectorIndex, livePaths: Set<string>): string[] {
  return Object.keys(index.notes).filter((notePath) => !livePaths.has(notePath));
}

export function cosineSearch(
  index: VectorIndex,
  queryVector: number[],
  limit: number
): VectorHit[] {
  // Keep only the best-matching chunk per note so results are deduplicated.
  const bestPerNote = new Map<string, VectorHit>();
  for (const [notePath, chunks] of Object.entries(index.notes)) {
    for (const chunk of chunks) {
      if (chunk.vector.length !== queryVector.length) continue;
      let score = 0;
      for (let i = 0; i < queryVector.length; i++) {
        score += chunk.vector[i]! * queryVector[i]!;
      }
      const best = bestPerNote.get(notePath);
      if (!best || score > best.score) {
        bestPerNote.set(notePath, { notePath, heading: chunk.heading, text: chunk.text, score });
      }
    }
  }
  return [...bestPerNote.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

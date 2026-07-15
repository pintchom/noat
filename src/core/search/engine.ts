import { listAllNotes, readNoteByPath, scopeOfNotePath, statAllNotes } from '../note-listing';
import { blocksToPlainText, blocksToSections } from '../note-text';
import { embedQuery, embedTexts, isEmbedderReady } from './embeddings';
import { type HybridResult, mergeHybrid } from './hybrid';
import { KeywordIndex } from './keyword-index';
import {
  type VectorIndex,
  cosineSearch,
  diffNoteChunks,
  loadVectorIndex,
  removeNote,
  saveVectorIndex,
  stalePaths,
} from './vector-index';

export type SearchMode = 'keyword' | 'semantic' | 'hybrid';

export interface SearchResult {
  notePath: string;
  title: string;
  icon?: string;
  scope: string;
  snippet?: string;
  sources: Array<'keyword' | 'semantic'>;
}

const RESULT_LIMIT = 15;

/**
 * Hybrid search over the note store: a MiniSearch keyword index (fuzzy,
 * prefix, BM25) plus a local-embedding vector index, merged with reciprocal
 * rank fusion. All state derives from the notes on disk and is rebuildable.
 */
export class SearchEngine {
  private keyword = new KeywordIndex();
  private titles = new Map<string, { title: string; icon?: string; scope: string }>();
  private vectors: VectorIndex | undefined;
  private keywordReady: Promise<void> | undefined;
  private vectorReady: Promise<void> | undefined;
  // notePath -> "mtimeMs:size" as of the last sweep, for out-of-band change detection.
  private fileStats: Map<string, string> | undefined;
  // Serializes all index mutations so saves/updates can't interleave.
  private indexQueue: Promise<void> = Promise.resolve();

  constructor(private readonly noatHome: string) {}

  /** True once the embedding model is loaded and the vector index populated. */
  isSemanticReady(): boolean {
    return isEmbedderReady() && this.vectors !== undefined;
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.indexQueue = this.indexQueue.then(task, task);
    return this.indexQueue;
  }

  /** Build the in-memory keyword index (fast — a few ms per hundred notes). */
  ensureKeywordIndex(): Promise<void> {
    if (!this.keywordReady) {
      this.keywordReady = this.enqueue(async () => {
        const listings = await listAllNotes(this.noatHome);
        const docs = await Promise.all(
          listings.map(async (listing) => {
            const note = await readNoteByPath(this.noatHome, listing.notePath).catch(
              () => undefined
            );
            this.titles.set(listing.notePath, {
              title: listing.title,
              ...(listing.icon && { icon: listing.icon }),
              scope: listing.scope,
            });
            return {
              id: listing.notePath,
              title: listing.title,
              text: note ? blocksToPlainText(note.blocks) : '',
              scope: listing.scope,
            };
          })
        );
        this.keyword.rebuild(docs);
      });
    }
    return this.keywordReady;
  }

  /**
   * Build the vector index once; later staleness is handled incrementally via
   * updateNote. A failed build (e.g. offline model download) is not memoized,
   * so the next call retries.
   */
  ensureVectorIndex(onProgress?: (done: number, total: number) => void): Promise<void> {
    if (this.vectorReady) return this.vectorReady;
    const ready = this.enqueue(async () => {
      const index = this.vectors ?? (await loadVectorIndex(this.noatHome));
      const listings = await listAllNotes(this.noatHome);
      const livePaths = new Set(listings.map((listing) => listing.notePath));
      for (const stale of stalePaths(index, livePaths)) removeNote(index, stale);

      const pending: Array<{ notePath: string; chunks: ReturnType<typeof diffNoteChunks> }> = [];
      for (const listing of listings) {
        const note = await readNoteByPath(this.noatHome, listing.notePath).catch(() => undefined);
        if (!note) continue;
        const sections = [
          { heading: note.title, text: note.title },
          ...blocksToSections(note.blocks),
        ];
        const diff = diffNoteChunks(index, listing.notePath, sections);
        pending.push({ notePath: listing.notePath, chunks: diff });
      }

      const totalToEmbed = pending.reduce((sum, entry) => sum + entry.chunks.toEmbed.length, 0);
      let embedded = 0;
      for (const entry of pending) {
        const { chunks, toEmbed } = entry.chunks;
        if (toEmbed.length > 0) {
          const vectors = await embedTexts(
            this.noatHome,
            toEmbed.map((item) => item.text)
          );
          toEmbed.forEach((item, i) => {
            const chunk = chunks[item.chunkIndex];
            if (chunk && vectors[i]) chunk.vector = vectors[i];
          });
          embedded += toEmbed.length;
          onProgress?.(embedded, totalToEmbed);
        }
        index.notes[entry.notePath] = chunks;
      }

      this.vectors = index;
      if (totalToEmbed > 0) await saveVectorIndex(this.noatHome, index);
    });
    this.vectorReady = ready;
    ready.catch(() => {
      if (this.vectorReady === ready) this.vectorReady = undefined;
    });
    return ready;
  }

  /** Incrementally reindex a single note (on save, MCP writes, staleness sweeps). */
  updateNote(notePath: string): Promise<void> {
    return this.enqueue(async () => {
      const note = await readNoteByPath(this.noatHome, notePath).catch(() => undefined);
      if (!note) {
        this.keyword.remove(notePath);
        this.titles.delete(notePath);
        if (this.vectors) {
          removeNote(this.vectors, notePath);
          await saveVectorIndex(this.noatHome, this.vectors);
        }
        return;
      }

      const scope = scopeOfNotePath(notePath);
      this.titles.set(notePath, {
        title: note.title,
        ...(note.icon && { icon: note.icon }),
        scope,
      });
      this.keyword.upsert({
        id: notePath,
        title: note.title,
        text: blocksToPlainText(note.blocks),
        scope,
      });

      if (this.vectors) {
        const sections = [
          { heading: note.title, text: note.title },
          ...blocksToSections(note.blocks),
        ];
        const { chunks, toEmbed } = diffNoteChunks(this.vectors, notePath, sections);
        if (toEmbed.length > 0) {
          const vectors = await embedTexts(
            this.noatHome,
            toEmbed.map((item) => item.text)
          );
          toEmbed.forEach((item, i) => {
            const chunk = chunks[item.chunkIndex];
            if (chunk && vectors[i]) chunk.vector = vectors[i];
          });
        }
        this.vectors.notes[notePath] = chunks;
        if (toEmbed.length > 0) await saveVectorIndex(this.noatHome, this.vectors);
      }
    });
  }

  private toResult(
    notePath: string,
    sources: Array<'keyword' | 'semantic'>,
    snippet?: string
  ): SearchResult {
    const meta = this.titles.get(notePath);
    return {
      notePath,
      title: meta?.title ?? notePath,
      ...(meta?.icon && { icon: meta.icon }),
      scope: meta?.scope ?? scopeOfNotePath(notePath),
      snippet,
      sources,
    };
  }

  async searchKeyword(query: string): Promise<SearchResult[]> {
    await this.ensureKeywordIndex();
    return this.keyword
      .search(query, RESULT_LIMIT)
      .map((hit) => this.toResult(hit.notePath, ['keyword']));
  }

  async searchSemantic(query: string): Promise<SearchResult[]> {
    await this.ensureKeywordIndex();
    await this.ensureVectorIndex();
    const queryVector = await embedQuery(this.noatHome, query);
    const index = this.vectors;
    if (!index || queryVector.length === 0) return [];
    return cosineSearch(index, queryVector, RESULT_LIMIT).map((hit) =>
      this.toResult(
        hit.notePath,
        ['semantic'],
        hit.heading ? `${hit.heading} — ${hit.text}` : hit.text
      )
    );
  }

  async searchHybrid(query: string): Promise<HybridResult[]> {
    await this.ensureKeywordIndex();
    await this.ensureVectorIndex();
    const queryVector = await embedQuery(this.noatHome, query);
    const semantic =
      this.vectors && queryVector.length > 0
        ? cosineSearch(this.vectors, queryVector, RESULT_LIMIT)
        : [];
    return mergeHybrid(this.keyword.search(query, RESULT_LIMIT), semantic, RESULT_LIMIT);
  }

  /**
   * Reconcile the indexes with files changed outside this process (editor
   * saves, git pulls). Stat-only; content is re-read only for changed notes.
   */
  private async refreshFromDisk(): Promise<void> {
    const stats = await statAllNotes(this.noatHome);
    const current = new Map(stats.map((stat) => [stat.notePath, `${stat.mtimeMs}:${stat.size}`]));
    const previous = this.fileStats;
    this.fileStats = current;
    // First sweep only seeds the map — the index builders read the same disk state.
    if (!previous) return;
    for (const [notePath, signature] of current) {
      if (previous.get(notePath) !== signature) await this.updateNote(notePath);
    }
    for (const notePath of previous.keys()) {
      if (!current.has(notePath)) await this.updateNote(notePath);
    }
  }

  /** Hybrid search returning display-ready results. */
  async search(query: string, mode: SearchMode = 'hybrid'): Promise<SearchResult[]> {
    await this.refreshFromDisk();
    if (mode === 'keyword') return this.searchKeyword(query);
    if (mode === 'semantic') return this.searchSemantic(query);
    const merged = await this.searchHybrid(query);
    return merged.map((result) =>
      this.toResult(
        result.notePath,
        result.sources,
        result.snippet
          ? result.snippet.heading
            ? `${result.snippet.heading} — ${result.snippet.text}`
            : result.snippet.text
          : undefined
      )
    );
  }

  /** Drop everything and rebuild from disk (exposed as a command). */
  async rebuild(onProgress?: (done: number, total: number) => void): Promise<void> {
    this.keywordReady = undefined;
    this.vectorReady = undefined;
    this.vectors = { model: (await loadVectorIndex(this.noatHome)).model, notes: {} };
    await saveVectorIndex(this.noatHome, this.vectors);
    await this.ensureKeywordIndex();
    await this.ensureVectorIndex(onProgress);
  }
}

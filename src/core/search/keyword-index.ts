import MiniSearch from 'minisearch';

export interface KeywordDoc {
  id: string;
  title: string;
  text: string;
  scope: string;
}

export interface KeywordHit {
  notePath: string;
  score: number;
}

/** BM25 + fuzzy + prefix keyword index over full note text. */
export class KeywordIndex {
  private index = this.createIndex();

  private createIndex(): MiniSearch<KeywordDoc> {
    return new MiniSearch<KeywordDoc>({
      fields: ['title', 'text'],
      storeFields: [],
      searchOptions: {
        boost: { title: 3 },
        fuzzy: 0.2,
        prefix: true,
        combineWith: 'AND',
      },
    });
  }

  rebuild(docs: KeywordDoc[]): void {
    this.index = this.createIndex();
    this.index.addAll(docs);
  }

  upsert(doc: KeywordDoc): void {
    if (this.index.has(doc.id)) this.index.discard(doc.id);
    this.index.add(doc);
  }

  remove(id: string): void {
    if (this.index.has(id)) this.index.discard(id);
  }

  search(query: string, limit: number): KeywordHit[] {
    const results = this.index.search(query);
    // AND across terms can be too strict for multi-word queries; fall back to OR.
    const relaxed =
      results.length === 0 ? this.index.search(query, { combineWith: 'OR' }) : results;
    return relaxed.slice(0, limit).map((result) => ({
      notePath: String(result.id),
      score: result.score,
    }));
  }
}

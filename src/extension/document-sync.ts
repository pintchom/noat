/**
 * Keeps a TextDocument in sync with full-document edits streamed from the
 * note webview.
 *
 * Rapid typing produces bursts of edits, and applying them concurrently has
 * two failure modes:
 *
 * 1. Echo suppression that remembers only the most recent text mislabels the
 *    change event of an earlier in-flight edit as an external change. The
 *    webview reacts to "external" changes by remounting the editor, which
 *    resets the scroll position and drops the selection mid-typing.
 * 2. The full-document replace range is computed from a stale line count, so
 *    a later edit can replace only part of the document.
 *
 * This helper serializes applies — coalescing bursts down to the newest text,
 * since older snapshots are superseded — and tracks every in-flight edit so
 * change-event echoes are always recognized regardless of how they interleave.
 */
export interface DocumentSync {
  /** Queue the webview's latest full-document text to be applied. */
  queueEdit(text: string): void;
  /**
   * Check whether a document change event (after which the document reads
   * `text`) is the echo of an edit queued here. Returns true — consuming the
   * matching in-flight record — when it is; such events must not be reported
   * to the webview as external changes.
   */
  consumeEcho(text: string): boolean;
}

export interface DocumentSyncOptions {
  getText: () => string;
  /** Apply `text` as the full document content. Resolves false if rejected. */
  applyText: (text: string) => Promise<boolean>;
  /** Called after each successfully applied edit (e.g. to schedule autosave). */
  onDidApply: () => void;
}

export function createDocumentSync({
  getText,
  applyText,
  onDidApply,
}: DocumentSyncOptions): DocumentSync {
  // Texts applied on our behalf whose change events haven't been observed
  // yet. VS Code fires the change event before applyText resolves, so under
  // normal operation this holds at most one entry.
  const pendingEchoes: string[] = [];
  let queuedText: string | undefined;
  let applying = false;

  const runApplyLoop = async (): Promise<void> => {
    applying = true;
    try {
      while (queuedText !== undefined) {
        const text = queuedText;
        queuedText = undefined;
        if (text === getText()) continue;
        pendingEchoes.push(text);
        const applied = await applyText(text).catch(() => false);
        if (!applied) {
          // No change event will fire for this text; drop the record so it
          // can't swallow a future external change with identical content.
          const index = pendingEchoes.indexOf(text);
          if (index !== -1) pendingEchoes.splice(index, 1);
          continue;
        }
        onDidApply();
      }
    } finally {
      applying = false;
    }
  };

  return {
    queueEdit: (text) => {
      queuedText = text;
      if (!applying) void runApplyLoop();
    },
    consumeEcho: (text) => {
      const index = pendingEchoes.indexOf(text);
      if (index === -1) return false;
      // Earlier entries were superseded before their own event was seen.
      pendingEchoes.splice(0, index + 1);
      return true;
    },
  };
}

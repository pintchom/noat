import { sameNoteJson } from './note';

/**
 * Tells the host which document changes it caused itself on the webview's
 * behalf, so only genuine outside changes get posted back to the editor.
 *
 * Every keystroke writes the full note through an async `applyEdit`, so fast
 * typing leaves several writes in flight. The change event of an older write
 * then carries text the webview has already moved past; posting it back
 * rolled the editor to that older text and swallowed the newest letters.
 */
export class WebviewEchoes {
  /** Texts written for the webview whose `applyEdit` hasn't resolved yet, oldest first. */
  private readonly inFlight: string[] = [];
  /** The newest text the document holds (or will hold) on the webview's behalf. */
  private latest: string | undefined;

  /** The text the document will hold once every in-flight write lands. */
  expectedText(documentText: string): string {
    return this.inFlight.at(-1) ?? documentText;
  }

  /** Record a write that is about to be applied. */
  writing(text: string): void {
    this.inFlight.push(text);
    this.latest = text;
  }

  /**
   * Record that a write's `applyEdit` resolved (or failed). Writes resolve in
   * the order they were made, so older entries are settled too.
   */
  settled(text: string): void {
    const index = this.inFlight.indexOf(text);
    if (index >= 0) this.inFlight.splice(0, index + 1);
  }

  /** Whether a document change should be kept out of the webview. */
  isOwnChange(documentText: string): boolean {
    // A newer write is still on its way and replaces the whole document, so
    // this content is already stale from the editor's point of view.
    if (this.inFlight.length > 0) return true;
    if (this.latest === undefined) return false;
    if (documentText === this.latest) return true;
    // Save participants (editor.formatOnSave, files.insertFinalNewline,
    // trailing-whitespace trimming) can rewrite the bytes without changing
    // the note. Posting those remounts BlockNote and drops the caret.
    if (!sameNoteJson(documentText, this.latest)) return false;
    // Adopt the normalized text so later exact-match checks stay cheap.
    this.latest = documentText;
    return true;
  }
}

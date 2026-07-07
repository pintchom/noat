import { commitAll } from '../core/git';

const DEBOUNCE_MS = 2000;

/** Local time as "2026-07-07 16:02" for commit message context. */
function localTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/**
 * Debounced git committer for the note store. Multiple changes within the
 * debounce window coalesce into one commit whose message lists each action.
 */
export class AutoCommitter {
  private pendingMessages = new Set<string>();
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly noatHome: string) {}

  notify(message: string): void {
    this.pendingMessages.add(`${message} [${localTimestamp()}]`);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), DEBOUNCE_MS);
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.pendingMessages.size === 0) return;
    const messages = [...this.pendingMessages];
    this.pendingMessages.clear();
    const message =
      messages.length === 1 ? messages[0]! : `${messages.length} changes\n\n${messages.join('\n')}`;
    try {
      await commitAll(this.noatHome, message);
    } catch (error) {
      console.error('NOAT: auto-commit failed', error);
    }
  }

  dispose(): void {
    void this.flush();
  }
}

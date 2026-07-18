import { type KeyboardEvent, useEffect, useRef } from 'react';

/**
 * In-note find widget, VS Code style: floats in the top-right corner while
 * matches are highlighted in the document. Enter steps forward, Shift+Enter
 * steps back, Escape closes and returns focus to the editor.
 */
export function FindBar({
  query,
  matchCount,
  activeIndex,
  focusToken,
  onQueryChange,
  onNavigate,
  onClose,
}: {
  query: string;
  matchCount: number;
  activeIndex: number;
  /** Bump to refocus and select the input (e.g. Cmd+F while already open). */
  focusToken: number;
  onQueryChange: (query: string) => void;
  onNavigate: (direction: 1 | -1) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: focusToken exists solely to re-trigger this focus effect
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusToken]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onNavigate(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  const count = (() => {
    if (!query) return '';
    if (matchCount === 0) return 'No results';
    return `${activeIndex + 1} of ${matchCount}`;
  })();

  return (
    <div className="noat-find-bar">
      <input
        ref={inputRef}
        className="noat-find-input"
        type="text"
        placeholder="Find in note"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <span
        className={`noat-find-count${matchCount === 0 && query ? ' noat-find-no-results' : ''}`}
      >
        {count}
      </span>
      <button
        type="button"
        className="noat-find-button"
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
        disabled={matchCount === 0}
        onClick={() => onNavigate(-1)}
      >
        ↑
      </button>
      <button
        type="button"
        className="noat-find-button"
        title="Next match (Enter)"
        aria-label="Next match"
        disabled={matchCount === 0}
        onClick={() => onNavigate(1)}
      >
        ↓
      </button>
      <button
        type="button"
        className="noat-find-button"
        title="Close (Escape)"
        aria-label="Close find"
        onClick={onClose}
      >
        ✕
      </button>
    </div>
  );
}

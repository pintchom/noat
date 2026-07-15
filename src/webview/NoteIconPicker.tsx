import { useEffect, useRef, useState } from 'react';
import {
  NOTE_ICON,
  normalizeNoteIcon,
  noteIconForStorage,
  resolveNoteIcon,
} from '../core/display-icons';

const PRESET_ICONS = ['📝', '📌', '💡', '✅', '🔥', '🎯', '🚀', '❤️', '⚠️', '🧠', '📚', '🛠️'];

export function NoteIconPicker({
  icon,
  onChange,
}: {
  icon: string | undefined;
  onChange: (icon: string | undefined) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState(resolveNoteIcon(icon));
  const [error, setError] = useState<string>();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setDraft(resolveNoteIcon(icon));
    setError(undefined);
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [icon, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsideClick = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [isOpen]);

  const closeAndFocusTrigger = (): void => {
    setIsOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const chooseIcon = (nextIcon: string | undefined): void => {
    onChange(noteIconForStorage(nextIcon));
    closeAndFocusTrigger();
  };

  const submitCustomIcon = (): void => {
    const normalized = normalizeNoteIcon(draft);
    if (!normalized) {
      setError('Choose a single emoji.');
      return;
    }
    chooseIcon(normalized);
  };

  return (
    <div className="noat-icon-picker" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="noat-icon-trigger"
        title="Change note icon"
        aria-label="Change note icon"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        onClick={() => setIsOpen((open) => !open)}
      >
        {resolveNoteIcon(icon)}
      </button>
      {isOpen && (
        <div
          className="noat-icon-popover"
          role="dialog"
          aria-label="Choose note icon"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            closeAndFocusTrigger();
          }}
        >
          <div className="noat-icon-presets">
            {PRESET_ICONS.map((preset) => (
              <button
                key={preset}
                type="button"
                className="noat-icon-preset"
                aria-label={preset === NOTE_ICON ? 'Use default note icon' : `Use ${preset} icon`}
                onClick={() => chooseIcon(preset)}
              >
                {preset}
              </button>
            ))}
          </div>
          <form
            className="noat-icon-custom"
            onSubmit={(event) => {
              event.preventDefault();
              submitCustomIcon();
            }}
          >
            <input
              ref={inputRef}
              className="noat-icon-input"
              value={draft}
              aria-label="Custom note emoji"
              aria-invalid={error ? true : undefined}
              placeholder="Paste an emoji"
              onChange={(event) => {
                setDraft(event.target.value);
                setError(undefined);
              }}
            />
            <button type="submit" className="noat-icon-use">
              Use
            </button>
          </form>
          {error && (
            <div className="noat-icon-error" role="alert">
              {error}
            </div>
          )}
          <button type="button" className="noat-icon-reset" onClick={() => chooseIcon(undefined)}>
            Reset to {NOTE_ICON}
          </button>
        </div>
      )}
    </div>
  );
}

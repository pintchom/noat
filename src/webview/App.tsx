import { useEffect, useRef, useState } from 'react';
import type {
  HostToWebviewMessage,
  IdeThemeJson,
  WebviewToHostMessage,
} from '../core/editor-messages';
import { type NoteFile, parseNote } from '../core/note';
import { NoteEditor } from './NoteEditor';

interface VsCodeApi {
  postMessage: (message: WebviewToHostMessage) => void;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; note: NoteFile };

export function App({ vscode }: { vscode: VsCodeApi }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [ideTheme, setIdeTheme] = useState<IdeThemeJson | undefined>(undefined);
  const [themeReceived, setThemeReceived] = useState(false);
  // Remount key: bumped on external document changes and theme changes so
  // BlockNote re-initializes instead of merging states.
  const [editorVersion, setEditorVersion] = useState(0);
  // Latest text the editor emitted — the App's `note` state goes stale while
  // typing (our own edits aren't echoed back), so theme remounts restore from here.
  const latestTextRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const onMessage = (event: MessageEvent<HostToWebviewMessage>) => {
      const message = event.data;
      switch (message.type) {
        case 'init':
        case 'update':
          try {
            const note = parseNote(message.text);
            latestTextRef.current = message.text;
            setState({ status: 'ready', note });
            if (message.type === 'update') setEditorVersion((v) => v + 1);
          } catch (error) {
            setState({
              status: 'error',
              message: error instanceof Error ? error.message : String(error),
            });
          }
          break;
        case 'ideTheme': {
          const currentText = latestTextRef.current;
          if (currentText) {
            try {
              setState({ status: 'ready', note: parseNote(currentText) });
            } catch {
              // Keep previous state; the text mid-edit should always parse.
            }
          }
          setIdeTheme(message.theme);
          setThemeReceived(true);
          setEditorVersion((v) => v + 1);
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, [vscode]);

  if (state.status === 'loading' || !themeReceived) {
    return <div className="noat-status">Loading note…</div>;
  }

  if (state.status === 'error') {
    return (
      <div className="noat-status noat-error">
        <p>This file isn't a valid NOAT note.</p>
        <pre>{state.message}</pre>
        <p>Right-click the file and choose "Open With… &gt; Text Editor" to inspect it.</p>
      </div>
    );
  }

  return (
    <NoteEditor
      key={editorVersion}
      note={state.note}
      ideTheme={ideTheme}
      onEdit={(text) => {
        latestTextRef.current = text;
        vscode.postMessage({ type: 'edit', text });
      }}
    />
  );
}

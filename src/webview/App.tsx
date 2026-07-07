import { useEffect, useState } from 'react';
import type { HostToWebviewMessage, WebviewToHostMessage } from '../core/editor-messages';
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
  // Bumped when the document changes outside the editor (undo, git revert,
  // agent writes) so BlockNote re-initializes instead of merging states.
  const [externalVersion, setExternalVersion] = useState(0);

  useEffect(() => {
    const onMessage = (event: MessageEvent<HostToWebviewMessage>) => {
      const message = event.data;
      if (message.type !== 'init' && message.type !== 'update') return;
      try {
        const note = parseNote(message.text);
        setState({ status: 'ready', note });
        if (message.type === 'update') setExternalVersion((v) => v + 1);
      } catch (error) {
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };
    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, [vscode]);

  if (state.status === 'loading') {
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
      key={externalVersion}
      note={state.note}
      onEdit={(text) => vscode.postMessage({ type: 'edit', text })}
    />
  );
}

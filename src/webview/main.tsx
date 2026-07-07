import { createRoot } from 'react-dom/client';
import type { WebviewToHostMessage } from '../core/editor-messages';
import { App } from './App';
import './styles.css';

declare global {
  interface Window {
    acquireVsCodeApi: () => { postMessage: (message: WebviewToHostMessage) => void };
  }
}

const vscode = window.acquireVsCodeApi();

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App vscode={vscode} />);
}

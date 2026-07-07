import { createRoot } from 'react-dom/client';
import { App } from './App';
import { vscodeApi } from './vscode-api';
import './styles.css';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App vscode={vscodeApi} />);
}

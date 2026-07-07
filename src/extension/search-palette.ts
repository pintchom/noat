import * as path from 'node:path';
import * as vscode from 'vscode';
import { listAllNotes } from '../core/note-listing';
import { getNotesRoot } from '../core/paths';
import type { SearchEngine, SearchResult } from '../core/search/engine';

interface NoteQuickPickItem extends vscode.QuickPickItem {
  notePath?: string;
}

function scopeLabel(scope: string): string {
  if (scope === 'global') return 'Global';
  const parts = scope.split('--');
  return parts.length > 1 ? parts.slice(1).join('/') : scope;
}

function toItem(result: SearchResult): NoteQuickPickItem {
  const viaSemantic = result.sources.includes('semantic');
  return {
    label: `$(note) ${result.title}`,
    description: `${scopeLabel(result.scope)}${viaSemantic ? ' $(sparkle)' : ''}`,
    detail: result.snippet?.slice(0, 120),
    notePath: result.notePath,
    alwaysShow: true,
  };
}

/**
 * Cmd+Shift+S search palette: keyword results appear as you type, semantic
 * results merge in as soon as the embedding side has answered.
 */
export async function showSearchPalette(noatHome: string, engine: SearchEngine): Promise<void> {
  const quickPick = vscode.window.createQuickPick<NoteQuickPickItem>();
  quickPick.placeholder = 'Search notes — exact words or vague concepts both work…';
  quickPick.matchOnDescription = false;
  quickPick.matchOnDetail = false;

  let generation = 0;
  let debounceTimer: NodeJS.Timeout | undefined;

  const showRecent = async (): Promise<void> => {
    const myGeneration = ++generation;
    const recent = await listAllNotes(noatHome);
    if (myGeneration !== generation) return;
    quickPick.items = recent.slice(0, 15).map((listing) => ({
      label: `$(note) ${listing.title}`,
      description: scopeLabel(listing.scope),
      notePath: listing.notePath,
      alwaysShow: true,
    }));
  };

  const runSearch = async (query: string): Promise<void> => {
    const myGeneration = ++generation;

    // Fast path: keyword results immediately.
    const keywordResults = await engine.searchKeyword(query);
    if (myGeneration !== generation) return;
    quickPick.items = keywordResults.map(toItem);

    // Slow path: hybrid (waits on embeddings) replaces the list when ready.
    quickPick.busy = true;
    try {
      const hybridResults = await engine.search(query, 'hybrid');
      if (myGeneration !== generation) return;
      quickPick.items = hybridResults.map(toItem);
    } catch {
      // Embeddings unavailable (e.g. offline before first model download) —
      // keyword results already shown.
    } finally {
      if (myGeneration === generation) quickPick.busy = false;
    }
  };

  quickPick.onDidChangeValue((value) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const query = value.trim();
      if (query.length === 0) void showRecent();
      else void runSearch(query);
    }, 120);
  });

  quickPick.onDidAccept(() => {
    const picked = quickPick.selectedItems[0];
    if (picked?.notePath) {
      const absPath = path.join(getNotesRoot(noatHome), picked.notePath);
      void vscode.commands.executeCommand('noat.openNote', absPath);
    }
    quickPick.hide();
  });

  quickPick.onDidHide(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    quickPick.dispose();
  });

  quickPick.show();
  await showRecent();
}

import * as path from 'node:path';
import * as vscode from 'vscode';
import { resolveNoteIcon } from '../core/display-icons';
import { NOTE_EXTENSION } from '../core/note';
import { listAllNotes } from '../core/note-listing';
import { getNotesRoot } from '../core/paths';
import { repoKeyToLabel } from '../core/repo-key';
import { NoteEditorProvider } from './note-editor';
import type { NoatNode } from './notes-tree';

/** The note file backing the active editor tab, if it is a NOAT note. */
export function activeNotePath(): string | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (input instanceof vscode.TabInputCustom && input.viewType === NoteEditorProvider.viewType) {
    return input.uri.fsPath;
  }
  if (input instanceof vscode.TabInputText && input.uri.fsPath.endsWith(NOTE_EXTENSION)) {
    return input.uri.fsPath;
  }
  return undefined;
}

async function pickNote(noatHome: string, placeHolder: string): Promise<string | undefined> {
  const notes = await listAllNotes(noatHome);
  if (notes.length === 0) {
    vscode.window.showInformationMessage('NOAT: no notes yet.');
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    notes.map((listing) => ({
      label: `${resolveNoteIcon(listing.icon)} ${listing.title}`,
      description: listing.scope === 'global' ? 'Global' : repoKeyToLabel(listing.scope),
      notePath: listing.notePath,
    })),
    { placeHolder }
  );
  return picked ? path.join(getNotesRoot(noatHome), picked.notePath) : undefined;
}

/**
 * The note a command should act on: the sidebar node it was invoked on, else
 * the active note tab, else one the user picks.
 */
export async function targetNotePath(
  noatHome: string,
  node: NoatNode | undefined,
  placeHolder: string
): Promise<string | undefined> {
  if (node?.type === 'entry' && node.entry.kind === 'note') return node.entry.absPath;
  return activeNotePath() ?? (await pickNote(noatHome, placeHolder));
}

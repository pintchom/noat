import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { resolveNoteIcon } from '../core/display-icons';
import { NOTE_EXTENSION, parseNote, titleToFileName } from '../core/note';
import { listAllNotes } from '../core/note-listing';
import { getNotesRoot } from '../core/paths';
import { noteToPdf } from '../core/pdf-export';
import { repoKeyToLabel } from '../core/repo-key';
import { NoteEditorProvider } from './note-editor';
import type { NoatNode } from './notes-tree';

/** The note file backing the active editor tab, if it is a NOAT note. */
function activeNotePath(): string | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (input instanceof vscode.TabInputCustom && input.viewType === NoteEditorProvider.viewType) {
    return input.uri.fsPath;
  }
  if (input instanceof vscode.TabInputText && input.uri.fsPath.endsWith(NOTE_EXTENSION)) {
    return input.uri.fsPath;
  }
  return undefined;
}

async function pickNote(noatHome: string): Promise<string | undefined> {
  const notes = await listAllNotes(noatHome);
  if (notes.length === 0) {
    vscode.window.showInformationMessage('NOAT: no notes to export yet.');
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    notes.map((listing) => ({
      label: `${resolveNoteIcon(listing.icon)} ${listing.title}`,
      description: listing.scope === 'global' ? 'Global' : repoKeyToLabel(listing.scope),
      notePath: listing.notePath,
    })),
    { placeHolder: 'Which note do you want to export as PDF?' }
  );
  return picked ? path.join(getNotesRoot(noatHome), picked.notePath) : undefined;
}

async function defaultSaveUri(fileName: string): Promise<vscode.Uri> {
  const downloads = path.join(os.homedir(), 'Downloads');
  const dir = await fs
    .stat(downloads)
    .then((stat) => (stat.isDirectory() ? downloads : os.homedir()))
    .catch(() => os.homedir());
  return vscode.Uri.file(path.join(dir, fileName));
}

/**
 * Export a note to a PDF file the user can share. The note comes from the
 * sidebar context menu (node), the active editor tab, or a quick pick.
 */
export async function exportNoteAsPdf(noatHome: string, node?: NoatNode): Promise<void> {
  const notePath = await (async () => {
    if (node?.type === 'entry' && node.entry.kind === 'note') return node.entry.absPath;
    return activeNotePath() ?? (await pickNote(noatHome));
  })();
  if (!notePath) return;

  const note = parseNote(await fs.readFile(notePath, 'utf8'));
  const target = await vscode.window.showSaveDialog({
    defaultUri: await defaultSaveUri(`${titleToFileName(note.title)}.pdf`),
    filters: { PDF: ['pdf'] },
    saveLabel: 'Export',
    title: `Export "${note.title}" as PDF`,
  });
  if (!target) return;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `NOAT: exporting "${note.title}" to PDF…`,
    },
    async () => {
      const pdf = await noteToPdf(note);
      await fs.writeFile(target.fsPath, pdf);
    }
  );

  const choice = await vscode.window.showInformationMessage(
    `NOAT: exported "${note.title}" to ${path.basename(target.fsPath)}.`,
    'Open PDF',
    'Reveal in Folder'
  );
  if (choice === 'Open PDF') void vscode.env.openExternal(target);
  if (choice === 'Reveal in Folder') {
    void vscode.commands.executeCommand('revealFileInOS', target);
  }
}

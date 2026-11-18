import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { resolveNoteIcon } from '../core/display-icons';
import type { PostItSummary } from '../core/editor-messages';
import { parseNote } from '../core/note';
import { listAllNotes } from '../core/note-listing';
import { getNotesRoot, getPostItsDir } from '../core/paths';
import {
  type PostIt,
  type PostItRange,
  previewSnippet,
  readPostItFiles,
  reanchorRange,
  sameRange,
  sortPostIts,
  trackRange,
  writeNotePostIts,
} from '../core/post-its';
import { repoKeyToLabel } from '../core/repo-key';
import { logError } from './log';
import { pickFileViewColumn } from './workspace-files';
import { type WorkspaceRepo, detectRepoAt } from './workspace-scope';

const CONTROLLER_ID = 'noat.postIts';
const ACTIVE_NOTE_KEY = 'noat.activeNoteId';
const HAS_ACTIVE_NOTE_CONTEXT = 'noat.hasActiveNote';
const RELOAD_DEBOUNCE_MS = 300;
const HOVER_COMMANDS = ['noat.openNote', 'noat.revealPostIt', 'noat.deletePostIt'] as const;
const SUBMIT_KEY = process.platform === 'darwin' ? '⌘Enter' : 'Ctrl+Enter';

interface NoteInfo {
  id: string;
  title: string;
  icon?: string;
  absPath: string;
}

/** Where a file sits: repo-relative inside a git repo, absolute otherwise. */
interface Anchor {
  repoKey?: string;
  file: string;
}

function toRange(range: PostItRange): vscode.Range {
  return new vscode.Range(
    range.start.line,
    range.start.character,
    range.end.line,
    range.end.character
  );
}

function fromRange(range: vscode.Range): PostItRange {
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character },
  };
}

function sameAnchor(postIt: PostIt, anchor: Anchor): boolean {
  return postIt.file === anchor.file && (postIt.repoKey ?? '') === (anchor.repoKey ?? '');
}

function commandLink(command: string, args: unknown[]): string {
  return `command:${command}?${encodeURIComponent(JSON.stringify(args))}`;
}

function bodyText(body: string | vscode.MarkdownString): string {
  return typeof body === 'string' ? body : body.value;
}

class PostItComment implements vscode.Comment {
  mode = vscode.CommentMode.Preview;
  readonly contextValue = 'postIt';
  body: string | vscode.MarkdownString;

  constructor(
    readonly postItId: string,
    readonly thread: vscode.CommentThread,
    /** Last saved text; restored when an edit is cancelled. */
    public text: string,
    public author: vscode.CommentAuthorInformation
  ) {
    this.body = new vscode.MarkdownString(text);
  }
}

/**
 * Post-its: notes pinned to code and owned by a NOAT note. Each shows as a
 * yellow highlight with a sticky-note icon in the gutter, and opens inline as
 * a comment thread. The active note (status bar, sidebar) is where new
 * post-its go, and while one is set only its post-its show.
 */
export class PostItsController implements vscode.Disposable {
  private readonly postIts = new Map<string, PostIt>();
  private notes = new Map<string, NoteInfo>();
  private activeNoteId: string | undefined;

  private readonly comments: vscode.CommentController;
  private readonly threads = new Map<string, vscode.CommentThread>();
  /** Notes whose post-its moved with unsaved code edits and still need writing. */
  private readonly unsaved = new Set<string>();
  /** What this window last wrote (or read) per note, to tell external writes apart. */
  private readonly lastWritten = new Map<string, string>();
  private readonly writes = new Map<string, Promise<void>>();

  private readonly repos = new Map<string, Promise<WorkspaceRepo | undefined>>();
  private readonly repoRoots = new Map<string, string>();
  private readonly anchorRequests = new Map<string, Promise<Anchor | undefined>>();
  private readonly anchors = new Map<string, Anchor | null>();
  private readonly cursorLines = new WeakMap<vscode.TextEditor, number>();

  private readonly highlight: vscode.TextEditorDecorationType;
  private readonly marker: vscode.TextEditorDecorationType;
  private readonly iconUri: vscode.Uri;
  private readonly status: vscode.StatusBarItem;

  private readonly changeEmitter = new vscode.EventEmitter<void>();
  /** Post-its were added, edited, moved, or deleted. */
  readonly onDidChange = this.changeEmitter.event;
  private readonly activeEmitter = new vscode.EventEmitter<string | undefined>();
  readonly onDidChangeActiveNote = this.activeEmitter.event;

  private readonly disposables: vscode.Disposable[] = [];
  private reloadTimer: NodeJS.Timeout | undefined;
  private notesTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly noatHome: string
  ) {
    this.iconUri = vscode.Uri.joinPath(context.extensionUri, 'media', 'post-it.svg');
    this.comments = vscode.comments.createCommentController(CONTROLLER_ID, 'NOAT Post-its');
    // Any line of a file on disk can take a post-it, which also puts a "+" in
    // the gutter on hover, next to where breakpoints go.
    this.comments.commentingRangeProvider = {
      provideCommentingRanges: (document) =>
        document.uri.scheme === 'file'
          ? [new vscode.Range(0, 0, Math.max(document.lineCount - 1, 0), 0)]
          : [],
    };
    this.highlight = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('noat.postItHighlightBackground'),
      overviewRulerColor: new vscode.ThemeColor('noat.postItOverviewRuler'),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });
    this.marker = vscode.window.createTextEditorDecorationType({
      gutterIconPath: this.iconUri,
      gutterIconSize: 'contain',
    });
    this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    this.status.command = 'noat.setActiveNote';
    this.activeNoteId = context.workspaceState.get<string>(ACTIVE_NOTE_KEY);
  }

  get activeNote(): NoteInfo | undefined {
    return this.activeNoteId ? this.notes.get(this.activeNoteId) : undefined;
  }

  async start(): Promise<void> {
    this.registerCommands();
    this.watch();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      await this.repoAt(folder.uri.fsPath);
    }
    await this.reloadNotes();
    await this.reloadPostIts();
    this.applyActiveNote();
  }

  /** The post-its a note owns, for its editor's post-it panel. */
  summariesFor(noteId: string): PostItSummary[] {
    return sortPostIts([...this.postIts.values()].filter((p) => p.noteId === noteId)).map(
      (postIt) => ({
        id: postIt.id,
        location: `${postIt.file}:${postIt.range.start.line + 1}`,
        snippet: previewSnippet(postIt.snippet),
        text: postIt.text,
      })
    );
  }

  async setActiveNote(noteId: string | undefined): Promise<void> {
    this.activeNoteId = noteId;
    await this.context.workspaceState.update(ACTIVE_NOTE_KEY, noteId);
    this.applyActiveNote();
  }

  /** Open a post-it's code and expand it. */
  async reveal(id: string): Promise<void> {
    const postIt = this.postIts.get(id);
    if (!postIt) return;
    if (this.activeNote && postIt.noteId !== this.activeNote.id) {
      await this.setActiveNote(postIt.noteId);
    }
    const uri = this.uriOf(postIt);
    if (!uri) {
      const where = postIt.repoKey ? repoKeyToLabel(postIt.repoKey) : 'another workspace';
      vscode.window.showWarningMessage(
        `NOAT: this post-it is in ${where}. Open that repository to see it.`
      );
      return;
    }
    const document = await Promise.resolve(vscode.workspace.openTextDocument(uri)).catch(
      () => undefined
    );
    if (!document) {
      vscode.window.showWarningMessage(`NOAT: file not found: ${postIt.file}`);
      return;
    }
    await this.reanchor(document);
    const range = toRange(postIt.range);
    const editor = await vscode.window.showTextDocument(document, {
      viewColumn: pickFileViewColumn(uri),
      selection: new vscode.Selection(range.start, range.start),
    });
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    const thread = this.threads.get(id);
    if (thread) thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
  }

  async confirmDelete(id: string): Promise<void> {
    const postIt = this.postIts.get(id);
    if (!postIt) return;
    const choice = await vscode.window.showWarningMessage(
      'Delete this post-it?',
      { modal: true, detail: postIt.text },
      'Delete'
    );
    if (choice === 'Delete') await this.delete(id);
  }

  private registerCommands(): void {
    const register = (command: string, handler: (...args: never[]) => unknown): void => {
      this.disposables.push(
        vscode.commands.registerCommand(command, async (...args: never[]) => {
          try {
            await handler(...args);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`NOAT: ${message}`);
          }
        })
      );
    };

    register('noat.addPostIt', () => this.addPostIt());
    register('noat.setActiveNote', () => this.chooseActiveNote());
    register('noat.clearActiveNote', () => this.setActiveNote(undefined));
    register('noat.revealPostIt', (id: string) => this.reveal(id));
    register('noat.deletePostIt', (id: string) => this.confirmDelete(id));
    register('noat.postIt.save', (reply: vscode.CommentReply) => this.saveDraft(reply));
    register('noat.postIt.cancel', (reply: vscode.CommentReply) => reply.thread.dispose());
    register('noat.postIt.edit', (comment: PostItComment) => this.setEditing(comment, true));
    register('noat.postIt.saveEdit', (comment: PostItComment) => this.saveEdit(comment));
    register('noat.postIt.cancelEdit', (comment: PostItComment) => {
      comment.body = new vscode.MarkdownString(comment.text);
      this.setEditing(comment, false);
    });
    register('noat.postIt.delete', (thread: vscode.CommentThread) => {
      const id = this.postItIdOf(thread);
      return id ? this.delete(id) : undefined;
    });
    register('noat.postIt.openNote', (thread: vscode.CommentThread) => {
      const id = this.postItIdOf(thread);
      const note = id ? this.notes.get(this.postIts.get(id)?.noteId ?? '') : undefined;
      return note ? vscode.commands.executeCommand('noat.openNote', note.absPath) : undefined;
    });
  }

  private watch(): void {
    const postItsWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(getPostItsDir(this.noatHome)), '*.json')
    );
    const scheduleReload = (): void => {
      if (this.reloadTimer) clearTimeout(this.reloadTimer);
      this.reloadTimer = setTimeout(() => {
        void this.reloadPostIts().catch((error) => logError('failed to reload post-its', error));
      }, RELOAD_DEBOUNCE_MS);
    };

    const notesWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(getNotesRoot(this.noatHome)), '**/*.noat.json')
    );
    const scheduleNotesReload = (): void => {
      if (this.notesTimer) clearTimeout(this.notesTimer);
      this.notesTimer = setTimeout(() => {
        void this.reloadNotes().catch((error) => logError('failed to index notes', error));
      }, RELOAD_DEBOUNCE_MS);
    };

    this.disposables.push(
      postItsWatcher,
      postItsWatcher.onDidCreate(scheduleReload),
      postItsWatcher.onDidChange(scheduleReload),
      postItsWatcher.onDidDelete(scheduleReload),
      notesWatcher,
      notesWatcher.onDidCreate(scheduleNotesReload),
      notesWatcher.onDidDelete(scheduleNotesReload),
      notesWatcher.onDidChange((uri) => void this.noteFileChanged(uri)),
      vscode.workspace.onDidOpenTextDocument((document) => void this.reanchor(document)),
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.anchorRequests.delete(document.uri.toString());
        this.anchors.delete(document.uri.toString());
      }),
      vscode.workspace.onDidChangeTextDocument((event) => this.documentChanged(event)),
      vscode.workspace.onDidSaveTextDocument((document) => void this.documentSaved(document)),
      vscode.workspace.onDidChangeWorkspaceFolders(async (event) => {
        for (const folder of event.added) await this.repoAt(folder.uri.fsPath);
        this.syncThreads();
      }),
      vscode.window.onDidChangeVisibleTextEditors(() => this.renderDecorations()),
      vscode.window.onDidChangeTextEditorSelection((event) => this.selectionChanged(event))
    );
  }

  /**
   * Open a new post-it on the selection. The editor creates the draft itself
   * (the gutter "+" does the same): only then does its input get focus, and
   * a draft created through the API would leave focus in the code, where
   * typing overwrites the selection.
   */
  private async addPostIt(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage('NOAT: open a file to leave a post-it in.');
      return;
    }
    if (!(await this.anchorOf(editor.document.uri))) {
      vscode.window.showWarningMessage('NOAT: post-its can only be left in files on disk.');
      return;
    }
    if (!this.activeNote) {
      const note = await this.pickNote(
        'Which note is this post-it for? It becomes the active note.',
        false
      );
      if (!note || note === 'all') return;
      await this.setActiveNote(note.id);
      await vscode.window.showTextDocument(editor.document, editor.viewColumn);
    }
    await vscode.commands.executeCommand('workbench.action.addComment');
  }

  private async saveDraft(reply: vscode.CommentReply): Promise<void> {
    const { thread } = reply;
    const text = reply.text.trim();
    if (!text || this.postItIdOf(thread)) return;
    const anchor = await this.anchorOf(thread.uri);
    if (!anchor) return;

    let note = this.activeNote;
    if (!note) {
      const picked = await this.pickNote(
        'Which note is this post-it for? It becomes the active note.',
        false
      );
      if (!picked || picked === 'all') return;
      note = picked;
      await this.setActiveNote(note.id);
    }

    const document = await vscode.workspace.openTextDocument(thread.uri);
    const start = thread.range?.start.line ?? 0;
    const range =
      !thread.range || thread.range.isEmpty ? document.lineAt(start).range : thread.range;
    const now = new Date().toISOString();
    const postIt: PostIt = {
      id: randomUUID(),
      noteId: note.id,
      ...(anchor.repoKey && { repoKey: anchor.repoKey }),
      file: anchor.file,
      range: fromRange(range),
      snippet: document.getText(range),
      text,
      createdAt: now,
      updatedAt: now,
    };
    this.postIts.set(postIt.id, postIt);
    thread.canReply = false;
    thread.contextValue = 'postIt';
    this.threads.set(postIt.id, thread);
    this.renderThread(thread, postIt);
    this.renderDecorations();
    await this.persist(postIt.noteId);
  }

  private setEditing(comment: PostItComment, editing: boolean): void {
    comment.mode = editing ? vscode.CommentMode.Editing : vscode.CommentMode.Preview;
    comment.thread.comments = [...comment.thread.comments];
  }

  private async saveEdit(comment: PostItComment): Promise<void> {
    const postIt = this.postIts.get(comment.postItId);
    const text = bodyText(comment.body).trim();
    if (!postIt || !text) return;
    postIt.text = text;
    postIt.updatedAt = new Date().toISOString();
    comment.text = text;
    comment.body = new vscode.MarkdownString(text);
    this.setEditing(comment, false);
    this.renderDecorations();
    await this.persist(postIt.noteId);
  }

  private async delete(id: string): Promise<void> {
    const postIt = this.postIts.get(id);
    if (!postIt) return;
    this.postIts.delete(id);
    this.threads.get(id)?.dispose();
    this.threads.delete(id);
    this.renderDecorations();
    await this.persist(postIt.noteId);
  }

  private postItIdOf(thread: vscode.CommentThread): string | undefined {
    for (const [id, candidate] of this.threads) {
      if (candidate === thread) return id;
    }
    return undefined;
  }

  private async chooseActiveNote(): Promise<void> {
    const picked = await this.pickNote(
      'Active note: new post-its go here, and only its post-its show in code',
      true
    );
    if (!picked) return;
    await this.setActiveNote(picked === 'all' ? undefined : picked.id);
  }

  private async pickNote(
    placeHolder: string,
    offerAll: boolean
  ): Promise<NoteInfo | 'all' | undefined> {
    const listings = await listAllNotes(this.noatHome);
    if (listings.length === 0 && !offerAll) {
      vscode.window.showInformationMessage('NOAT: create a note first.');
      return undefined;
    }
    const counts = new Map<string, number>();
    for (const postIt of this.postIts.values()) {
      counts.set(postIt.noteId, (counts.get(postIt.noteId) ?? 0) + 1);
    }
    const notesRoot = getNotesRoot(this.noatHome);
    type Item = vscode.QuickPickItem & { choice: NoteInfo | 'all' };
    const items: Item[] = listings.map((listing) => {
      const count = counts.get(listing.id) ?? 0;
      return {
        label: `${resolveNoteIcon(listing.icon)} ${listing.title}`,
        description: [
          listing.scope === 'global' ? 'Global' : repoKeyToLabel(listing.scope),
          count > 0 ? `${count} post-it${count === 1 ? '' : 's'}` : undefined,
          listing.id === this.activeNote?.id ? 'active' : undefined,
        ]
          .filter((part) => part !== undefined)
          .join(' · '),
        choice: {
          id: listing.id,
          title: listing.title,
          ...(listing.icon && { icon: listing.icon }),
          absPath: path.join(notesRoot, listing.notePath),
        },
      };
    });
    if (offerAll) {
      items.unshift({
        label: '$(eye) No active note',
        description: "Show every note's post-its",
        choice: 'all',
      });
    }
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder,
      matchOnDescription: true,
    });
    return picked?.choice;
  }

  private noteLabel(noteId: string): string {
    const note = this.notes.get(noteId);
    return note ? `${resolveNoteIcon(note.icon)} ${note.title}` : 'NOAT note';
  }

  private visiblePostIts(): PostIt[] {
    const active = this.activeNote;
    return [...this.postIts.values()].filter(
      (postIt) => this.notes.has(postIt.noteId) && (!active || postIt.noteId === active.id)
    );
  }

  private applyActiveNote(): void {
    const note = this.activeNote;
    void vscode.commands.executeCommand('setContext', HAS_ACTIVE_NOTE_CONTEXT, note !== undefined);
    this.status.text = note
      ? `$(pinned) ${resolveNoteIcon(note.icon)} ${note.title}`
      : '$(pin) NOAT';
    this.status.tooltip = note
      ? 'Active NOAT note: new post-its go here, and only its post-its show in code. Click to change.'
      : "No active NOAT note: every note's post-its show in code. Click to pick one.";
    this.status.show();
    this.comments.options = {
      prompt: 'Leave a post-it…',
      placeHolder: note
        ? `Post-it for ${resolveNoteIcon(note.icon)} ${note.title}. ${SUBMIT_KEY} to save`
        : `What is this code doing? ${SUBMIT_KEY} to save`,
    };
    this.syncThreads();
    this.activeEmitter.fire(note?.id);
  }

  /** Make the comment threads match the visible post-its, then redraw decorations. */
  private syncThreads(): void {
    const visible = new Map(this.visiblePostIts().map((postIt) => [postIt.id, postIt] as const));
    for (const [id, thread] of this.threads) {
      if (visible.has(id)) continue;
      thread.dispose();
      this.threads.delete(id);
    }
    for (const postIt of visible.values()) {
      const uri = this.uriOf(postIt);
      let thread = this.threads.get(postIt.id);
      if (thread && thread.uri.toString() !== uri?.toString()) {
        thread.dispose();
        this.threads.delete(postIt.id);
        thread = undefined;
      }
      if (!uri) continue;
      if (!thread) {
        thread = this.comments.createCommentThread(uri, toRange(postIt.range), []);
        thread.canReply = false;
        thread.contextValue = 'postIt';
        thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
        this.threads.set(postIt.id, thread);
      }
      this.renderThread(thread, postIt);
    }
    this.renderDecorations();
  }

  private renderThread(thread: vscode.CommentThread, postIt: PostIt): void {
    const range = toRange(postIt.range);
    if (!thread.range?.isEqual(range)) thread.range = range;
    const label = this.noteLabel(postIt.noteId);
    if (thread.label !== label) thread.label = label;
    const [comment] = thread.comments;
    if (comment?.mode === vscode.CommentMode.Editing) return;
    if (comment instanceof PostItComment && comment.text === postIt.text) return;
    thread.comments = [
      new PostItComment(postIt.id, thread, postIt.text, {
        name: 'Post-it',
        iconPath: this.iconUri,
      }),
    ];
  }

  private renderDecorations(): void {
    for (const editor of vscode.window.visibleTextEditors) void this.decorate(editor);
  }

  private async decorate(editor: vscode.TextEditor): Promise<void> {
    const anchor = await this.anchorOf(editor.document.uri);
    const visible = anchor ? this.visiblePostIts().filter((p) => sameAnchor(p, anchor)) : [];
    // Gutter decorations get no hover, so the post-it reads from its code.
    editor.setDecorations(
      this.highlight,
      visible.map((postIt) => ({
        range: toRange(postIt.range),
        hoverMessage: this.hoverFor(postIt),
      }))
    );
    // On the last line, beside the comment glyph the editor draws there,
    // which is what opens the post-it when clicked.
    editor.setDecorations(
      this.marker,
      visible.map((postIt) => new vscode.Range(postIt.range.end.line, 0, postIt.range.end.line, 0))
    );
  }

  /**
   * The post-it's own text renders as untrusted markdown in a section of its
   * own, so nothing in it can reach the command links, which live in a
   * separate trusted section.
   */
  private hoverFor(postIt: PostIt): vscode.MarkdownString[] {
    const content = new vscode.MarkdownString();
    content.appendMarkdown('**');
    content.appendText(this.noteLabel(postIt.noteId));
    content.appendMarkdown('**\n\n');
    content.appendMarkdown(postIt.text);

    const note = this.notes.get(postIt.noteId);
    const actions = new vscode.MarkdownString();
    actions.isTrusted = { enabledCommands: [...HOVER_COMMANDS] };
    actions.appendMarkdown(`[Expand](${commandLink('noat.revealPostIt', [postIt.id])})`);
    if (note) {
      actions.appendMarkdown(` · [Open note](${commandLink('noat.openNote', [note.absPath])})`);
    }
    actions.appendMarkdown(` · [Delete](${commandLink('noat.deletePostIt', [postIt.id])})`);
    return [content, actions];
  }

  /** Clicking or moving the cursor off a post-it folds it back into its gutter icon. */
  private selectionChanged(event: vscode.TextEditorSelectionChangeEvent): void {
    const line = event.selections[0]?.active.line;
    if (line === undefined) return;
    const moved = this.cursorLines.get(event.textEditor) !== line;
    this.cursorLines.set(event.textEditor, line);
    if (!moved && event.kind !== vscode.TextEditorSelectionChangeKind.Mouse) return;

    const uri = event.textEditor.document.uri.toString();
    for (const thread of this.threads.values()) {
      if (thread.uri.toString() !== uri) continue;
      if (thread.range && thread.range.start.line <= line && line <= thread.range.end.line) {
        continue;
      }
      if (thread.comments.some((comment) => comment.mode === vscode.CommentMode.Editing)) continue;
      thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
    }
  }

  private documentChanged(event: vscode.TextDocumentChangeEvent): void {
    if (event.contentChanges.length === 0) return;
    const uri = event.document.uri.toString();
    const changes = event.contentChanges.map((change) => ({
      range: fromRange(change.range),
      text: change.text,
    }));
    const text = (() => {
      let cached: string | undefined;
      return () => {
        cached ??= event.document.getText();
        return cached;
      };
    })();

    const anchor = this.anchors.get(uri);
    if (!anchor) return;
    let moved = false;
    for (const postIt of this.postIts.values()) {
      if (!sameAnchor(postIt, anchor)) continue;
      const next = trackRange(postIt.range, changes, postIt.snippet, text);
      if (sameRange(next, postIt.range)) continue;
      postIt.range = next;
      this.unsaved.add(postIt.noteId);
      const thread = this.threads.get(postIt.id);
      if (thread) thread.range = toRange(next);
      moved = true;
    }
    if (!moved) return;
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document === event.document) void this.decorate(editor);
    }
  }

  /** Saving code writes moved post-its and refreshes their snippets. */
  private async documentSaved(document: vscode.TextDocument): Promise<void> {
    const anchor = this.anchors.get(document.uri.toString());
    if (!anchor) return;
    const notes = new Set<string>();
    for (const postIt of this.postIts.values()) {
      if (!sameAnchor(postIt, anchor)) continue;
      const snippet = document.getText(toRange(postIt.range));
      if (snippet === postIt.snippet && !this.unsaved.has(postIt.noteId)) continue;
      postIt.snippet = snippet;
      notes.add(postIt.noteId);
    }
    for (const noteId of notes) await this.persist(noteId);
  }

  /** Re-find a document's post-its by their snippets (code may have moved while closed). */
  private async reanchor(document: vscode.TextDocument): Promise<void> {
    const anchor = await this.anchorOf(document.uri);
    if (!anchor) return;
    const notes = new Set<string>();
    // Opening a file can reveal a repo first seen just now (a nested repo or
    // submodule), whose post-its had no file to put their threads on yet.
    let missingThread = false;
    let text: string | undefined;
    for (const postIt of this.postIts.values()) {
      if (!sameAnchor(postIt, anchor)) continue;
      if (!this.threads.has(postIt.id)) missingThread = true;
      text ??= document.getText();
      const next = reanchorRange(text, postIt.range, postIt.snippet);
      if (sameRange(next, postIt.range)) continue;
      postIt.range = next;
      notes.add(postIt.noteId);
    }
    if (notes.size === 0 && !missingThread) return;
    this.syncThreads();
    for (const noteId of notes) {
      if (document.isDirty) this.unsaved.add(noteId);
      else await this.persist(noteId);
    }
  }

  /**
   * Write a note's post-its. Writes for one note run one at a time, each
   * snapshotting the post-its when it starts, so a slow earlier write can't
   * land after a later one and bring back stale contents.
   */
  private persist(noteId: string): Promise<void> {
    const previous = this.writes.get(noteId) ?? Promise.resolve();
    const write = previous.then(() => this.write(noteId));
    this.writes.set(noteId, write);
    void write.then(() => {
      if (this.writes.get(noteId) === write) this.writes.delete(noteId);
    });
    return write;
  }

  private async write(noteId: string): Promise<void> {
    const postIts = [...this.postIts.values()].filter((postIt) => postIt.noteId === noteId);
    try {
      this.lastWritten.set(noteId, await writeNotePostIts(this.noatHome, noteId, postIts));
      this.unsaved.delete(noteId);
    } catch (error) {
      logError('failed to save post-its', error);
      vscode.window.showErrorMessage('NOAT: could not save post-its. See the NOAT output.');
    }
    this.changeEmitter.fire();
  }

  /** Pick up post-it files written elsewhere: other windows, git pulls into the store. */
  private async reloadPostIts(): Promise<void> {
    const files = new Map(
      (await readPostItFiles(this.noatHome)).map((file) => [file.noteId, file] as const)
    );
    const noteIds = new Set([...files.keys(), ...this.lastWritten.keys()]);
    let changed = false;
    for (const noteId of noteIds) {
      const file = files.get(noteId);
      const raw = file?.raw ?? '';
      if (this.lastWritten.get(noteId) === raw) continue;
      this.lastWritten.set(noteId, raw);
      this.unsaved.delete(noteId);
      for (const [id, postIt] of this.postIts) {
        if (postIt.noteId === noteId) this.postIts.delete(id);
      }
      for (const postIt of file?.postIts ?? []) this.postIts.set(postIt.id, postIt);
      changed = true;
    }
    if (!changed) return;
    this.syncThreads();
    for (const document of vscode.workspace.textDocuments) await this.reanchor(document);
    this.changeEmitter.fire();
  }

  private async reloadNotes(): Promise<void> {
    const notesRoot = getNotesRoot(this.noatHome);
    const listings = await listAllNotes(this.noatHome);
    this.notes = new Map(
      listings.map((listing) => [
        listing.id,
        {
          id: listing.id,
          title: listing.title,
          ...(listing.icon && { icon: listing.icon }),
          absPath: path.join(notesRoot, listing.notePath),
        },
      ])
    );
    this.applyActiveNote();
  }

  /** A note was saved: only a title or icon change matters here. */
  private async noteFileChanged(uri: vscode.Uri): Promise<void> {
    try {
      const note = parseNote(await fs.readFile(uri.fsPath, 'utf8'));
      const known = this.notes.get(note.id);
      if (known?.absPath !== uri.fsPath) return this.reloadNotes();
      if (known.title === note.title && known.icon === note.icon) return;
      this.notes.set(note.id, {
        id: note.id,
        title: note.title,
        ...(note.icon && { icon: note.icon }),
        absPath: known.absPath,
      });
      this.applyActiveNote();
    } catch {
      // Mid-write or hand-broken note files are picked up on their next save.
    }
  }

  private repoAt(dir: string): Promise<WorkspaceRepo | undefined> {
    let repo = this.repos.get(dir);
    if (!repo) {
      repo = detectRepoAt(dir).then(
        (found) => {
          if (found) this.repoRoots.set(found.scope.repoKey, found.rootPath);
          return found;
        },
        () => undefined
      );
      this.repos.set(dir, repo);
    }
    return repo;
  }

  private anchorOf(uri: vscode.Uri): Promise<Anchor | undefined> {
    const key = uri.toString();
    let request = this.anchorRequests.get(key);
    if (!request) {
      request = this.computeAnchor(uri).then((anchor) => {
        this.anchors.set(key, anchor ?? null);
        return anchor;
      });
      this.anchorRequests.set(key, request);
    }
    return request;
  }

  private async computeAnchor(uri: vscode.Uri): Promise<Anchor | undefined> {
    if (uri.scheme !== 'file') return undefined;
    const repo = await this.repoAt(path.dirname(uri.fsPath));
    if (repo) {
      const relative = path.relative(repo.rootPath, uri.fsPath);
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
        return { repoKey: repo.scope.repoKey, file: relative.split(path.sep).join('/') };
      }
    }
    return { file: uri.fsPath };
  }

  private uriOf(postIt: PostIt): vscode.Uri | undefined {
    if (!postIt.repoKey) {
      return path.isAbsolute(postIt.file) ? vscode.Uri.file(postIt.file) : undefined;
    }
    const root = this.repoRoots.get(postIt.repoKey);
    return root ? vscode.Uri.file(path.join(root, ...postIt.file.split('/'))) : undefined;
  }

  dispose(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    if (this.notesTimer) clearTimeout(this.notesTimer);
    for (const disposable of this.disposables) disposable.dispose();
    for (const thread of this.threads.values()) thread.dispose();
    this.comments.dispose();
    this.highlight.dispose();
    this.marker.dispose();
    this.status.dispose();
    this.changeEmitter.dispose();
    this.activeEmitter.dispose();
  }
}

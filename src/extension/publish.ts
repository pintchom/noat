import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { NOTE_EXTENSION, parseNote } from '../core/note';
import { getNotesRoot } from '../core/paths';
import {
  type SiteManifest,
  addToManifest,
  buildSite,
  commitTitle,
  readManifest,
  removeFromManifest,
} from '../core/publish';
import { logError } from './log';
import { activeNotePath, targetNotePath } from './note-target';
import type { NoatNode } from './notes-tree';
import {
  type PublishConnection,
  connectGit,
  connectNetlify,
  publishProvider,
  signOutOfNetlify,
} from './publish-providers';

// Long enough that a typing session becomes one deploy, not dozens.
const AUTO_UPDATE_MS = 20_000;

/**
 * Publish notes as web pages ("Publish to web", Notion-style). Pages are
 * rendered to static HTML and made live through the configured provider:
 * Netlify (one-click, the default) or a git repository served by a static
 * host. Published notes re-publish themselves shortly after each save, so
 * the page tracks the note.
 */
export class SitePublisher implements vscode.Disposable {
  private queue: Promise<unknown> = Promise.resolve();
  private publishedIds = new Set<string>();
  private autoTimer: NodeJS.Timeout | undefined;
  private autoUpdateFailing = false;

  private readonly configSubscription: vscode.Disposable;

  constructor(
    private readonly noatHome: string,
    private readonly secrets: vscode.SecretStorage
  ) {
    void this.refreshPublished();
    this.configSubscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration('noat.publish.provider') ||
        event.affectsConfiguration('noat.publish.repository')
      ) {
        void this.refreshPublished();
      }
    });
  }

  dispose(): void {
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.configSubscription.dispose();
  }

  /** The configured provider. With `prompt`, signs in / asks for settings as needed. */
  private connect(prompt: boolean): Promise<PublishConnection | undefined> {
    return publishProvider() === 'git'
      ? connectGit(this.noatHome, prompt)
      : connectNetlify(this.noatHome, this.secrets, prompt);
  }

  /**
   * Learn which notes are published, so saves auto-update even when the
   * local copy is missing or stale (fresh machine, provider changed).
   */
  private async refreshPublished(): Promise<void> {
    try {
      const connection = await this.connect(false);
      if (!connection) {
        this.publishedIds = new Set();
        return;
      }
      await this.run(async () => {
        await connection.pull();
        this.remember(await readManifest(connection.siteDir));
      });
    } catch (error) {
      logError('could not read which notes are published', error);
    }
  }

  private remember(manifest: SiteManifest): void {
    this.publishedIds = new Set(Object.keys(manifest.pages));
  }

  /** Site operations share one working copy, so they run one at a time. */
  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Pull the live site, let `change` edit the manifest, rebuild, and push. */
  private update(
    connection: PublishConnection,
    message: string,
    change: (manifest: SiteManifest) => Promise<void> | void
  ): Promise<SiteManifest> {
    return this.run(async () => {
      await connection.pull();
      const manifest = await readManifest(connection.siteDir);
      await change(manifest);
      const layout = await connection.prepare?.(manifest);
      await buildSite(this.noatHome, connection.siteDir, manifest, layout);
      await connection.push(message, manifest);
      this.remember(manifest);
      return manifest;
    });
  }

  async publish(node: NoatNode | undefined): Promise<void> {
    const notePath = await targetNotePath(
      this.noatHome,
      node,
      'Which note do you want to publish to the web?'
    );
    if (!notePath) return;
    const connection = await this.connect(true);
    if (!connection) return;

    const note = parseNote(await fs.readFile(notePath, 'utf8'));
    const before = { firstPage: false };
    const manifest = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `NOAT: publishing "${note.title}"…`,
      },
      () =>
        this.update(connection, `publish: ${commitTitle(note.title)}`, (current) => {
          before.firstPage = Object.keys(current.pages).length === 0;
          addToManifest(current, note);
        })
    );
    const page = manifest.pages[note.id];
    if (!page) return;

    const url = connection.pageUrl(page.slug);
    await vscode.env.clipboard.writeText(url);
    const hint = before.firstPage ? connection.firstPublishHint : undefined;
    const choice = await vscode.window.showInformationMessage(
      hint
        ? `NOAT: published "${note.title}" and copied the link. ${hint.message}`
        : `NOAT: published "${note.title}" and copied the link: ${url}`,
      'Open Page',
      ...(hint ? [hint.action] : [])
    );
    if (choice === 'Open Page') void vscode.env.openExternal(vscode.Uri.parse(url));
    if (hint && choice === hint.action) void vscode.env.openExternal(vscode.Uri.parse(hint.url));
  }

  async unpublish(node: NoatNode | undefined): Promise<void> {
    const connection = await this.connect(false);
    if (!connection) {
      vscode.window.showInformationMessage('NOAT: no notes have been published yet.');
      return;
    }
    const manifest = await this.run(async () => {
      await connection.pull();
      return readManifest(connection.siteDir);
    });

    // The note this was invoked on, if it's published; otherwise any page,
    // including ones whose note has since been deleted.
    const candidatePath =
      node?.type === 'entry' && node.entry.kind === 'note' ? node.entry.absPath : activeNotePath();
    const candidateId = candidatePath
      ? await fs
          .readFile(candidatePath, 'utf8')
          .then((raw) => parseNote(raw).id)
          .catch(() => undefined)
      : undefined;
    const noteId = await (async () => {
      if (candidateId && manifest.pages[candidateId]) return candidateId;
      const pages = Object.entries(manifest.pages);
      if (pages.length === 0) {
        vscode.window.showInformationMessage('NOAT: no notes are published right now.');
        return undefined;
      }
      const picked = await vscode.window.showQuickPick(
        pages.map(([id, page]) => ({
          label: page.title || 'Untitled',
          description: connection.pageUrl(page.slug),
          id,
        })),
        { placeHolder: 'Which page do you want to unpublish?' }
      );
      return picked?.id;
    })();
    if (!noteId) return;

    const title = manifest.pages[noteId]?.title || 'Untitled';
    const confirmed = await vscode.window.showWarningMessage(
      `Unpublish "${title}"?`,
      { modal: true, detail: connection.unpublishDetail },
      'Unpublish'
    );
    if (confirmed !== 'Unpublish') return;

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `NOAT: unpublishing "${title}"…` },
      () =>
        this.update(connection, `unpublish: ${commitTitle(title)}`, async (current) => {
          await removeFromManifest(connection.siteDir, current, noteId);
        })
    );
    vscode.window.showInformationMessage(`NOAT: unpublished "${title}".`);
  }

  async signOutOfNetlify(): Promise<void> {
    await signOutOfNetlify(this.secrets);
    vscode.window.showInformationMessage(
      'NOAT: signed out of Netlify. Your published pages stay up; publishing again signs you back in.'
    );
  }

  /** Re-publish shortly after a published note is saved. */
  async noteSaved(filePath: string): Promise<void> {
    if (this.publishedIds.size === 0) return;
    if (!vscode.workspace.getConfiguration('noat.publish').get<boolean>('autoUpdate', true)) return;
    const notesRoot = getNotesRoot(this.noatHome);
    if (!filePath.startsWith(notesRoot + path.sep) || !filePath.endsWith(NOTE_EXTENSION)) return;
    const noteId = await fs
      .readFile(filePath, 'utf8')
      .then((raw) => parseNote(raw).id)
      .catch(() => undefined);
    if (!noteId || !this.publishedIds.has(noteId)) return;

    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.autoTimer = setTimeout(() => void this.autoUpdate(), AUTO_UPDATE_MS);
  }

  private async autoUpdate(): Promise<void> {
    try {
      const connection = await this.connect(false);
      if (!connection) return;
      await this.update(connection, 'update published notes', () => undefined);
      this.autoUpdateFailing = false;
    } catch (error) {
      logError('auto-updating published notes failed', error);
      // Warn once per failure streak, not on every save.
      if (!this.autoUpdateFailing) {
        vscode.window.showWarningMessage(
          `NOAT: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      this.autoUpdateFailing = true;
    }
  }
}

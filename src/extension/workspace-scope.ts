import * as vscode from 'vscode';
import { getRemoteOriginUrl, getRepoRoot } from '../core/git';
import { pathToRepoKey, remoteUrlToRepoKey, repoKeyToLabel } from '../core/repo-key';
import type { NoteScope } from '../core/store';

export interface WorkspaceRepo {
  scope: Extract<NoteScope, { type: 'repo' }>;
  label: string;
  rootPath: string;
}

/**
 * Resolve the git repo containing `dir` to a repo scope key.
 * Prefers the origin remote URL; falls back to a path hash for local-only repos.
 * Returns undefined when `dir` isn't inside a git repo.
 */
export async function detectRepoAt(
  dir: string,
  fallbackLabel?: string
): Promise<WorkspaceRepo | undefined> {
  const repoRoot = await getRepoRoot(dir);
  if (!repoRoot) return undefined;

  const remoteUrl = await getRemoteOriginUrl(repoRoot);
  const repoKey = remoteUrl ? remoteUrlToRepoKey(remoteUrl) : pathToRepoKey(repoRoot);
  const label = remoteUrl
    ? repoKeyToLabel(repoKey)
    : (fallbackLabel ?? repoRoot.split(/[\\/]/).pop() ?? repoRoot);

  return { scope: { type: 'repo', repoKey }, label, rootPath: repoRoot };
}

/**
 * Resolve the current workspace to a repo scope key.
 * Returns undefined when no folder is open or the folder isn't a git repo.
 */
export async function detectWorkspaceRepo(): Promise<WorkspaceRepo | undefined> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return undefined;
  return detectRepoAt(folder.uri.fsPath, folder.name);
}

import * as vscode from 'vscode';
import { getRemoteOriginUrl, getRepoRoot } from '../core/git';
import { pathToRepoKey, remoteUrlToRepoKey } from '../core/repo-key';
import type { NoteScope } from '../core/store';

export interface WorkspaceRepo {
  scope: Extract<NoteScope, { type: 'repo' }>;
  label: string;
  rootPath: string;
}

/**
 * Resolve the current workspace to a repo scope key.
 * Prefers the origin remote URL; falls back to a path hash for local-only repos.
 * Returns undefined when no folder is open or the folder isn't a git repo.
 */
export async function detectWorkspaceRepo(): Promise<WorkspaceRepo | undefined> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return undefined;

  const folderPath = folder.uri.fsPath;
  const repoRoot = await getRepoRoot(folderPath);
  if (!repoRoot) return undefined;

  const remoteUrl = await getRemoteOriginUrl(repoRoot);
  const repoKey = remoteUrl ? remoteUrlToRepoKey(remoteUrl) : pathToRepoKey(repoRoot);
  const label = (() => {
    if (!remoteUrl) return folder.name;
    const parts = repoKey.split('--');
    return parts.length > 1 ? parts.slice(1).join('/') : repoKey;
  })();

  return { scope: { type: 'repo', repoKey }, label, rootPath: repoRoot };
}

import * as path from 'node:path';
import * as vscode from 'vscode';
import { commitAll, getLastCommitSubject } from '../core/git';

// Minimal surface of the built-in vscode.git extension API that we use.
interface GitRepositoryState {
  HEAD?: { commit?: string; name?: string };
  onDidChange: vscode.Event<void>;
}

interface GitRepository {
  rootUri: vscode.Uri;
  state: GitRepositoryState;
}

interface GitApi {
  repositories: GitRepository[];
  onDidOpenRepository: vscode.Event<GitRepository>;
}

interface GitExtensionExports {
  getAPI(version: 1): GitApi;
}

function localTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/**
 * Commits the note store whenever the user commits in a workspace repo, so
 * note history snapshots line up with code history. Note saves themselves
 * only write to disk — no commits between code commits.
 */
export class GitSync {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly lastSeen = new Map<string, { sha?: string; branch?: string }>();

  constructor(private readonly noatHome: string) {}

  async start(): Promise<void> {
    const gitExtension = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
    if (!gitExtension) return;
    const exports = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
    const api = exports.getAPI(1);

    for (const repository of api.repositories) this.track(repository);
    this.disposables.push(api.onDidOpenRepository((repository) => this.track(repository)));
  }

  private track(repository: GitRepository): void {
    const key = repository.rootUri.toString();
    this.lastSeen.set(key, {
      sha: repository.state.HEAD?.commit,
      branch: repository.state.HEAD?.name,
    });

    this.disposables.push(
      repository.state.onDidChange(() => {
        const previous = this.lastSeen.get(key);
        const sha = repository.state.HEAD?.commit;
        const branch = repository.state.HEAD?.name;
        this.lastSeen.set(key, { sha, branch });

        if (!sha || sha === previous?.sha) return;
        // Same branch + new sha = a commit (or amend). A branch change is a
        // checkout — just update the baseline without committing notes.
        if (previous?.branch !== branch) return;
        void this.commitNotes(repository, sha);
      })
    );
  }

  private async commitNotes(repository: GitRepository, sha: string): Promise<void> {
    const repoRoot = repository.rootUri.fsPath;
    const repoName = path.basename(repoRoot);
    const subject = (await getLastCommitSubject(repoRoot)) ?? '';
    const message = `sync(${repoName}): ${sha.slice(0, 7)} ${subject} [${localTimestamp()}]`;
    try {
      await commitAll(this.noatHome, message);
    } catch (error) {
      console.error('NOAT: note sync commit failed', error);
    }
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
  }
}

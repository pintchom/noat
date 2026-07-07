import { createHash } from 'node:crypto';
import * as path from 'node:path';

/**
 * Normalize a git remote URL into a stable, filesystem-safe scope key.
 *
 * Examples:
 *   git@github.com:foo/bar.git        -> github.com--foo--bar
 *   https://github.com/foo/bar.git    -> github.com--foo--bar
 *   ssh://git@github.com/foo/bar      -> github.com--foo--bar
 */
export function remoteUrlToRepoKey(remoteUrl: string): string {
  const trimmed = remoteUrl.trim().replace(/\.git$/, '');

  const normalized = (() => {
    // scp-like syntax: git@host:owner/repo
    const scpMatch = trimmed.match(/^[\w.-]+@([\w.-]+):(.+)$/);
    if (scpMatch) return `${scpMatch[1]}/${scpMatch[2]}`;

    // URL syntax: proto://[user@]host[:port]/path
    const urlMatch = trimmed.match(/^[a-z+]+:\/\/(?:[\w.-]+@)?([\w.-]+)(?::\d+)?\/(.+)$/i);
    if (urlMatch) return `${urlMatch[1]}/${urlMatch[2]}`;

    return trimmed;
  })();

  return normalized
    .toLowerCase()
    .replace(/\/+/g, '--')
    .replace(/[^a-z0-9._-]/g, '-');
}

/** Human label for a repo key: "github.com--foo--bar" -> "foo/bar". */
export function repoKeyToLabel(repoKey: string): string {
  const parts = repoKey.split('--');
  return parts.length > 1 ? parts.slice(1).join('/') : repoKey;
}

/** Fallback scope key for repos without a remote: name plus a short path hash. */
export function pathToRepoKey(repoPath: string): string {
  const hash = createHash('sha256').update(repoPath).digest('hex').slice(0, 8);
  const base = path
    .basename(repoPath)
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-');
  return `local--${base}--${hash}`;
}

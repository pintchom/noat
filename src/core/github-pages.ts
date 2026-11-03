/**
 * Turning on GitHub Pages for the git provider's repository through the
 * GitHub REST API, so publishing doesn't need a trip to the repo's settings.
 */

const API_URL = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 30_000;

export interface GithubOptions {
  fetch?: typeof fetch;
  apiUrl?: string;
}

export interface GithubRepo {
  owner: string;
  repo: string;
}

/** owner/repo of a github.com remote (https or ssh), else undefined. */
export function parseGithubRemote(remote: string): GithubRepo | undefined {
  const match = remote
    .trim()
    .replace(/\.git$/, '')
    .match(/github\.com[:/]([\w.-]+)\/([\w.-]+)$/i);
  return match?.[1] && match[2] ? { owner: match[1], repo: match[2] } : undefined;
}

async function call(
  token: string,
  method: string,
  route: string,
  options: GithubOptions,
  json?: unknown
): Promise<Response> {
  return (options.fetch ?? fetch)(`${options.apiUrl ?? API_URL}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'NOAT',
      ...(json !== undefined && { 'Content-Type': 'application/json' }),
    },
    body: json !== undefined ? JSON.stringify(json) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function failure(response: Response, what: string): Promise<Error> {
  const detail = await response
    .json()
    .then((body: { message?: string }) => body.message)
    .catch(() => undefined);
  return new Error(`GitHub couldn't ${what} (${response.status}${detail ? `: ${detail}` : ''})`);
}

export type PagesResult =
  /** Pages was already on. */
  | 'already-on'
  /** Pages was just turned on; the first deploy takes a minute or two. */
  | 'enabled'
  /** The repo is private and the account's plan can't serve Pages from private repos. */
  | 'needs-public';

/** Serve the repo's `main` branch root with GitHub Pages, if it isn't already. */
export async function ensurePages(
  token: string,
  { owner, repo }: GithubRepo,
  options: GithubOptions = {}
): Promise<PagesResult> {
  const route = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const existing = await call(token, 'GET', `${route}/pages`, options);
  if (existing.ok) return 'already-on';
  if (existing.status !== 404) throw await failure(existing, 'check GitHub Pages');

  const created = await call(token, 'POST', `${route}/pages`, options, {
    source: { branch: 'main', path: '/' },
  });
  if (created.ok) return 'enabled';
  if (created.status === 409) return 'already-on';

  // Free plans reject Pages on private repos; anything else is a real error.
  const info = await call(token, 'GET', route, options);
  const isPrivate = info.ok && ((await info.json()) as { private?: boolean }).private === true;
  if (isPrivate) return 'needs-public';
  throw await failure(created, 'turn on GitHub Pages');
}

export async function makeRepoPublic(
  token: string,
  { owner, repo }: GithubRepo,
  options: GithubOptions = {}
): Promise<void> {
  const route = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const response = await call(token, 'PATCH', route, options, { private: false });
  if (!response.ok) throw await failure(response, 'make the repository public');
}

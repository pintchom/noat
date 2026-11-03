import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Minimal Netlify API client for publishing: browser sign-in via OAuth
 * tickets (the flow netlify-cli uses, which needs no redirect back to the
 * app) and file-digest deploys, which upload only files Netlify doesn't
 * already have.
 */

/** NOAT's Netlify OAuth app. Client ids are public; the app secret is never needed. */
export const NETLIFY_CLIENT_ID = 'BBui-9LHsZK0iGi3aOfbSrnaxYslLW1t7YyiN3dw_7A';

const API_URL = 'https://api.netlify.com/api/v1';
const WEB_URL = 'https://app.netlify.com';
const REQUEST_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 120_000;

export interface NetlifyOptions {
  fetch?: typeof fetch;
  apiUrl?: string;
  /** Polling interval for sign-in and deploy status. */
  pollMs?: number;
}

/** The token was rejected — expired or revoked. Sign in again. */
export class NetlifyAuthError extends Error {}

/** The site no longer exists (deleted in the Netlify dashboard). */
export class NetlifySiteGoneError extends Error {}

export interface NetlifySite {
  id: string;
  /** Public https URL, e.g. https://brave-otter-1234.netlify.app */
  url: string;
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true }
    );
  });

async function request<T>(
  options: NetlifyOptions,
  method: string,
  route: string,
  init: {
    token?: string;
    json?: unknown;
    body?: Buffer;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {}
): Promise<T> {
  const doFetch = options.fetch ?? fetch;
  const signals = [AbortSignal.timeout(init.timeoutMs ?? REQUEST_TIMEOUT_MS), init.signal].filter(
    (signal): signal is AbortSignal => signal !== undefined
  );
  const headers: Record<string, string> = {};
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.json !== undefined) headers['Content-Type'] = 'application/json';
  if (init.body) headers['Content-Type'] = 'application/octet-stream';
  const response = await doFetch(`${options.apiUrl ?? API_URL}${route}`, {
    method,
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    signal: AbortSignal.any(signals),
  });
  if (response.status === 401) throw new NetlifyAuthError('Netlify rejected the sign-in token');
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    const error = new Error(
      `Netlify ${method} ${route} failed (${response.status}) ${detail}`.trim()
    );
    (error as { status?: number }).status = response.status;
    throw error;
  }
  return (await response.json()) as T;
}

/**
 * Sign in through the browser. Creates a ticket, hands `openUrl` the page
 * where the user approves NOAT, and polls until they do. Resolves to an
 * access token; rejects if `signal` aborts (e.g. the user cancels).
 */
export async function signIn(
  openUrl: (url: string) => void | Promise<void>,
  signal: AbortSignal,
  options: NetlifyOptions = {}
): Promise<string> {
  const ticket = await request<{ id: string }>(
    options,
    'POST',
    `/oauth/tickets?client_id=${encodeURIComponent(NETLIFY_CLIENT_ID)}`,
    { json: {}, signal }
  );
  const params = new URLSearchParams({ response_type: 'ticket', ticket: ticket.id });
  await openUrl(`${WEB_URL}/authorize?${params.toString()}`);

  const ticketRoute = `/oauth/tickets/${encodeURIComponent(ticket.id)}`;
  for (;;) {
    const current = await request<{ authorized?: boolean }>(options, 'GET', ticketRoute, {
      signal,
    });
    if (current.authorized) break;
    await sleep(options.pollMs ?? 1000, signal);
  }
  const token = await request<{ access_token?: string }>(
    options,
    'POST',
    `${ticketRoute}/exchange`,
    { signal }
  );
  if (!token.access_token) throw new Error('Netlify did not return an access token');
  return token.access_token;
}

export async function createSite(
  token: string,
  options: NetlifyOptions = {}
): Promise<NetlifySite> {
  // No name: Netlify picks a free random one (e.g. "brave-otter-1234").
  const site = await request<{ id: string; ssl_url?: string; url?: string }>(
    options,
    'POST',
    '/sites',
    { token, json: {} }
  );
  const url = site.ssl_url || site.url;
  if (!site.id || !url) throw new Error('Netlify did not return the new site');
  return { id: site.id, url: url.replace(/^http:/, 'https:') };
}

/** "/"-separated paths (with a leading "/") of every file under `dir`, mapped to SHA-1. */
export async function digestDirectory(dir: string): Promise<Map<string, string>> {
  const digests = new Map<string, string>();
  const walk = async (current: string): Promise<void> => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const absPath = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absPath);
      else if (entry.isFile()) {
        const relPath = `/${path.relative(dir, absPath).split(path.sep).join('/')}`;
        digests.set(
          relPath,
          createHash('sha1')
            .update(await fs.readFile(absPath))
            .digest('hex')
        );
      }
    }
  };
  await walk(dir);
  return digests;
}

/**
 * Deploy everything in `dir` as the site's new production version and wait
 * until it's live. Netlify answers the digest list with the hashes it lacks,
 * so unchanged files are never re-uploaded.
 */
export async function deployDirectory(
  token: string,
  siteId: string,
  dir: string,
  options: NetlifyOptions = {}
): Promise<void> {
  const digests = await digestDirectory(dir);
  const deploy = await request<{ id: string; required?: string[] }>(
    options,
    'POST',
    `/sites/${encodeURIComponent(siteId)}/deploys`,
    { token, json: { files: Object.fromEntries(digests) } }
  ).catch((error: unknown) => {
    if ((error as { status?: number }).status === 404) {
      throw new NetlifySiteGoneError('The Netlify site was deleted');
    }
    throw error;
  });

  const required = new Set(deploy.required ?? []);
  for (const [filePath, sha] of digests) {
    if (!required.has(sha)) continue;
    // One upload per digest: identical files share content on Netlify.
    required.delete(sha);
    const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
    await request(options, 'PUT', `/deploys/${encodeURIComponent(deploy.id)}/files${encodedPath}`, {
      token,
      body: await fs.readFile(path.join(dir, ...filePath.split('/'))),
      timeoutMs: UPLOAD_TIMEOUT_MS,
    });
  }

  const deadline = Date.now() + UPLOAD_TIMEOUT_MS;
  for (;;) {
    const status = await request<{ state?: string; error_message?: string }>(
      options,
      'GET',
      `/deploys/${encodeURIComponent(deploy.id)}`,
      { token }
    );
    if (status.state === 'ready') return;
    if (status.state === 'error') {
      throw new Error(`Netlify deploy failed: ${status.error_message ?? 'unknown error'}`);
    }
    if (Date.now() > deadline)
      throw new Error('Timed out waiting for the Netlify deploy to go live');
    await sleep(options.pollMs ?? 1000);
  }
}

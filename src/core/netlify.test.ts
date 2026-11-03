import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  NETLIFY_CLIENT_ID,
  NetlifyAuthError,
  NetlifySiteGoneError,
  createSite,
  deployDirectory,
  digestDirectory,
  signIn,
} from './netlify';

const sha1 = (text: string): string => createHash('sha1').update(text).digest('hex');

interface Call {
  method: string;
  route: string;
  auth?: string;
  body?: string;
}

/** A fake Netlify API: `handler` answers each call; every call is recorded. */
function fakeNetlify(handler: (call: Call) => { status?: number; json?: unknown }) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const route = String(url).replace('https://api.test', '');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const call: Call = {
      method: init?.method ?? 'GET',
      route,
      auth: headers.Authorization,
      body: init?.body === undefined ? undefined : Buffer.from(init.body as string).toString(),
    };
    calls.push(call);
    const { status = 200, json = {} } = handler(call);
    return new Response(JSON.stringify(json), { status });
  }) as typeof fetch;
  return { calls, options: { fetch: fetchImpl, apiUrl: 'https://api.test', pollMs: 1 } };
}

describe('signIn', () => {
  it('creates a ticket, opens the approval page, polls, and exchanges for a token', async () => {
    let polls = 0;
    const { calls, options } = fakeNetlify(({ method, route }) => {
      if (method === 'POST' && route.startsWith('/oauth/tickets?')) return { json: { id: 'tk1' } };
      if (method === 'GET' && route === '/oauth/tickets/tk1') {
        polls += 1;
        return { json: { authorized: polls >= 3 } };
      }
      if (route === '/oauth/tickets/tk1/exchange')
        return { json: { access_token: 'secret-token' } };
      return { status: 404 };
    });
    const opened: string[] = [];

    const token = await signIn(
      (url) => void opened.push(url),
      new AbortController().signal,
      options
    );

    expect(token).toBe('secret-token');
    expect(calls[0]?.route).toBe(
      `/oauth/tickets?client_id=${encodeURIComponent(NETLIFY_CLIENT_ID)}`
    );
    expect(opened).toEqual(['https://app.netlify.com/authorize?response_type=ticket&ticket=tk1']);
    expect(polls).toBe(3);
  });

  it('stops polling when cancelled', async () => {
    const { options } = fakeNetlify(({ route }) =>
      route.startsWith('/oauth/tickets?')
        ? { json: { id: 'tk1' } }
        : { json: { authorized: false } }
    );
    const abort = new AbortController();
    const pending = signIn(() => undefined, abort.signal, options);
    setTimeout(() => abort.abort(new Error('cancelled')), 20);
    await expect(pending).rejects.toThrow('cancelled');
  });
});

describe('createSite', () => {
  it('returns the id and https URL, sending the token', async () => {
    const { calls, options } = fakeNetlify(() => ({
      json: { id: 's1', ssl_url: 'https://brave-otter-1.netlify.app', url: 'http://x' },
    }));
    expect(await createSite('tok', options)).toEqual({
      id: 's1',
      url: 'https://brave-otter-1.netlify.app',
    });
    expect(calls[0]).toMatchObject({ method: 'POST', route: '/sites', auth: 'Bearer tok' });
  });

  it('raises NetlifyAuthError on 401', async () => {
    const { options } = fakeNetlify(() => ({ status: 401 }));
    await expect(createSite('bad', options)).rejects.toBeInstanceOf(NetlifyAuthError);
  });
});

describe('deployDirectory', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noat-netlify-'));
    await fs.mkdir(path.join(dir, 'my page'), { recursive: true });
    await fs.writeFile(path.join(dir, 'index.html'), 'home');
    await fs.writeFile(path.join(dir, 'my page', 'index.html'), 'page');
    await fs.writeFile(path.join(dir, 'copy.html'), 'page');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('digests every file with "/" paths', async () => {
    expect(Object.fromEntries(await digestDirectory(dir))).toEqual({
      '/copy.html': sha1('page'),
      '/index.html': sha1('home'),
      '/my page/index.html': sha1('page'),
    });
  });

  it('uploads only the files Netlify asks for, once per digest, then waits for ready', async () => {
    let statusChecks = 0;
    const { calls, options } = fakeNetlify(({ method, route }) => {
      if (method === 'POST' && route === '/sites/s1/deploys') {
        return { json: { id: 'd1', required: [sha1('page')] } };
      }
      if (method === 'PUT') return { json: {} };
      if (method === 'GET' && route === '/deploys/d1') {
        statusChecks += 1;
        return { json: { state: statusChecks < 2 ? 'processing' : 'ready' } };
      }
      return { status: 404 };
    });

    await deployDirectory('tok', 's1', dir, options);

    const created = calls.find((call) => call.method === 'POST');
    expect(JSON.parse(created?.body ?? '{}').files['/index.html']).toBe(sha1('home'));
    const uploads = calls.filter((call) => call.method === 'PUT');
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.body).toBe('page');
    expect(statusChecks).toBe(2);
    expect(calls.every((call) => call.auth === 'Bearer tok')).toBe(true);
  });

  it('URL-encodes upload paths', async () => {
    const { calls, options } = fakeNetlify(({ method }) => {
      if (method === 'POST') return { json: { id: 'd1', required: [sha1('page')] } };
      if (method === 'GET') return { json: { state: 'ready' } };
      return { json: {} };
    });
    await fs.rm(path.join(dir, 'copy.html'));
    await deployDirectory('tok', 's1', dir, options);
    expect(calls.find((call) => call.method === 'PUT')?.route).toBe(
      '/deploys/d1/files/my%20page/index.html'
    );
  });

  it('reports a deleted site and a failed deploy', async () => {
    const gone = fakeNetlify(() => ({ status: 404 }));
    await expect(deployDirectory('tok', 's1', dir, gone.options)).rejects.toBeInstanceOf(
      NetlifySiteGoneError
    );

    const failed = fakeNetlify(({ method }) =>
      method === 'POST'
        ? { json: { id: 'd1', required: [] } }
        : { json: { state: 'error', error_message: 'boom' } }
    );
    await expect(deployDirectory('tok', 's1', dir, failed.options)).rejects.toThrow('boom');
  });
});

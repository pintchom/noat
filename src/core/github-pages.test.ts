import { describe, expect, it } from 'vitest';
import { ensurePages, makeRepoPublic, parseGithubRemote } from './github-pages';

interface Call {
  method: string;
  route: string;
  body?: unknown;
}

function fakeGithub(handler: (call: Call) => { status: number; json?: unknown }) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? 'GET',
      route: String(url).replace('https://gh.test', ''),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const { status, json = {} } = handler(call);
    return new Response(JSON.stringify(json), { status });
  }) as typeof fetch;
  return { calls, options: { fetch: fetchImpl, apiUrl: 'https://gh.test' } };
}

const repo = { owner: 'max', repo: 'notes' };

describe('parseGithubRemote', () => {
  it('reads owner/repo from https and ssh remotes', () => {
    expect(parseGithubRemote('https://github.com/max/notes.git')).toEqual(repo);
    expect(parseGithubRemote('git@github.com:max/notes')).toEqual(repo);
    expect(parseGithubRemote('git@gitlab.com:max/notes.git')).toBeUndefined();
  });
});

describe('ensurePages', () => {
  it('does nothing when Pages is already on', async () => {
    const { calls, options } = fakeGithub(() => ({ status: 200 }));
    expect(await ensurePages('t', repo, options)).toBe('already-on');
    expect(calls).toHaveLength(1);
  });

  it('turns Pages on from the main branch root', async () => {
    const { calls, options } = fakeGithub(({ method }) => ({
      status: method === 'GET' ? 404 : 201,
    }));
    expect(await ensurePages('t', repo, options)).toBe('enabled');
    expect(calls[1]).toEqual({
      method: 'POST',
      route: '/repos/max/notes/pages',
      body: { source: { branch: 'main', path: '/' } },
    });
  });

  it('reports a private repo that the plan cannot serve', async () => {
    const { options } = fakeGithub(({ method, route }) => {
      if (route.endsWith('/pages')) return { status: method === 'GET' ? 404 : 422 };
      return { status: 200, json: { private: true } };
    });
    expect(await ensurePages('t', repo, options)).toBe('needs-public');
  });

  it('surfaces other failures with GitHub’s message', async () => {
    const { options } = fakeGithub(({ method, route }) => {
      if (route.endsWith('/pages')) {
        return method === 'GET' ? { status: 404 } : { status: 403, json: { message: 'Nope' } };
      }
      return { status: 200, json: { private: false } };
    });
    await expect(ensurePages('t', repo, options)).rejects.toThrow('403: Nope');
  });
});

describe('makeRepoPublic', () => {
  it('patches the repo to public', async () => {
    const { calls, options } = fakeGithub(() => ({ status: 200 }));
    await makeRepoPublic('t', repo, options);
    expect(calls[0]).toEqual({
      method: 'PATCH',
      route: '/repos/max/notes',
      body: { private: false },
    });
  });
});

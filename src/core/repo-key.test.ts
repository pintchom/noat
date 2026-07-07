import { describe, expect, it } from 'vitest';
import { pathToRepoKey, remoteUrlToRepoKey } from './repo-key';

describe('remoteUrlToRepoKey', () => {
  it('normalizes scp-style ssh remotes', () => {
    expect(remoteUrlToRepoKey('git@github.com:foo/bar.git')).toBe('github.com--foo--bar');
  });

  it('normalizes https remotes', () => {
    expect(remoteUrlToRepoKey('https://github.com/foo/bar.git')).toBe('github.com--foo--bar');
  });

  it('normalizes ssh:// remotes with user', () => {
    expect(remoteUrlToRepoKey('ssh://git@github.com/foo/bar')).toBe('github.com--foo--bar');
  });

  it('produces identical keys across remote styles', () => {
    const keys = [
      'git@github.com:Foo/Bar.git',
      'https://github.com/foo/bar',
      'ssh://git@github.com:22/foo/bar.git',
    ].map(remoteUrlToRepoKey);
    expect(new Set(keys).size).toBe(1);
  });

  it('sanitizes unsafe characters', () => {
    expect(remoteUrlToRepoKey('https://example.com/a b/c?d')).toBe('example.com--a-b--c-d');
  });
});

describe('pathToRepoKey', () => {
  it('is stable for the same path', () => {
    expect(pathToRepoKey('/Users/me/proj')).toBe(pathToRepoKey('/Users/me/proj'));
  });

  it('differs for different paths with the same basename', () => {
    expect(pathToRepoKey('/a/proj')).not.toBe(pathToRepoKey('/b/proj'));
  });

  it('starts with the local prefix and basename', () => {
    expect(pathToRepoKey('/Users/me/My Proj')).toMatch(/^local--my-proj--[0-9a-f]{8}$/);
  });
});

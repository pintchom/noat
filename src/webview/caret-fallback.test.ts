import { expect, test } from 'vitest';
import { caretTargetAfterRewrite, flattenBlockIds } from './caret-fallback';

const exists =
  (...ids: string[]) =>
  (id: string) =>
    ids.includes(id);

test('flattens nested blocks depth-first in visual order', () => {
  expect(
    flattenBlockIds([
      { id: 'a', children: [{ id: 'a1', children: [] }] },
      { id: 'b', children: [] },
    ])
  ).toEqual(['a', 'a1', 'b']);
});

test('keeps the caret block when it survived', () => {
  expect(caretTargetAfterRewrite(['a', 'b', 'c'], 'b', exists('a', 'b', 'c'))).toBe('b');
});

test('falls back to the nearest surviving block before the caret', () => {
  expect(caretTargetAfterRewrite(['a', 'b', 'c'], 'b', exists('a', 'c'))).toBe('a');
});

test('falls forward when everything before the caret is gone', () => {
  expect(caretTargetAfterRewrite(['a', 'b', 'c'], 'a', exists('c'))).toBe('c');
});

test('returns undefined when no block survived or the cursor is unknown', () => {
  expect(caretTargetAfterRewrite(['a', 'b'], 'a', exists())).toBeUndefined();
  expect(caretTargetAfterRewrite(['a', 'b'], 'zz', exists('a'))).toBeUndefined();
});

import { test, expect } from 'vitest';
import { sessionMatches } from './clockFilter';

test('same session matches, different session does not', () => {
  expect(sessionMatches(1000010198, 1000010198)).toBe(true);
  expect(sessionMatches(1000010198, 1000010199)).toBe(false);
});

test('numeric strings and numbers compare equal', () => {
  expect(sessionMatches(5, '5' as unknown as number)).toBe(true);
});

test('unknown on either side is never filtered (backward compatible)', () => {
  expect(sessionMatches(null, 7)).toBe(true);
  expect(sessionMatches(7, undefined)).toBe(true);
  expect(sessionMatches(undefined, undefined)).toBe(true);
});

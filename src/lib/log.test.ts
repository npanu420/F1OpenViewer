import { test, expect } from 'vitest';
import { isDebugEnabled } from './log';

const store = (v: string | null) => ({ getItem: () => v });

test('debug logging is off by default and on with the f1-debug flag', () => {
  expect(isDebugEnabled(store(null), false)).toBe(false);
  expect(isDebugEnabled(store('0'), false)).toBe(false);
  expect(isDebugEnabled(store('1'), false)).toBe(true);
});

test('dev builds always log', () => {
  expect(isDebugEnabled(store(null), true)).toBe(true);
});

test('unavailable or throwing storage never throws and means off', () => {
  expect(isDebugEnabled(undefined, false)).toBe(false);
  expect(isDebugEnabled({ getItem: () => { throw new Error('denied'); } }, false)).toBe(false);
});

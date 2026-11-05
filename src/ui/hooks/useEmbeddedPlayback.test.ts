import { test, expect } from 'vitest';
import { playbackErrorMessage } from './useEmbeddedPlayback';

test('strips the Electron IPC wrapper so the user sees F1 own message', () => {
  const wrapped = new Error("Error invoking remote method 'f1:contentPlay': Error: F1 TV: HTTP 404: No Data Found in DB");
  expect(playbackErrorMessage(wrapped)).toBe('F1 TV: HTTP 404: No Data Found in DB');
  expect(playbackErrorMessage(new Error("Error invoking remote method 'f1:contentPlay': boom"))).toBe('boom');
});

test('plain errors and strings pass through, unknown values give empty', () => {
  expect(playbackErrorMessage(new Error('Session expired'))).toBe('Session expired');
  expect(playbackErrorMessage('region blocked')).toBe('region blocked');
  expect(playbackErrorMessage(undefined)).toBe('');
  expect(playbackErrorMessage({})).toBe('');
});

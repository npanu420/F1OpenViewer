import { test, expect } from 'vitest';
import { DEFAULT_PREFERENCES, parsePreferences } from './preferences';

test('missing or corrupt preferences fall back to the defaults', () => {
  expect(parsePreferences(null)).toEqual(DEFAULT_PREFERENCES);
  expect(parsePreferences('not json')).toEqual(DEFAULT_PREFERENCES);
  expect(parsePreferences('[1,2]')).toEqual(DEFAULT_PREFERENCES);
});

test('valid fields are kept, invalid ones reset, numbers clamped', () => {
  const parsed = parsePreferences(JSON.stringify({
    videoQuality: 'max', liveDelaySeconds: 500, bufferSize: 'huge', autoSync: false,
    autoHideSeconds: -3, maxAutoTiles: 4.4, hideDataWithTiming: 'yes', startAudio: 'main',
  }));
  expect(parsed).toEqual({
    ...DEFAULT_PREFERENCES,
    videoQuality: 'max', liveDelaySeconds: 120, autoSync: false, autoHideSeconds: 0, maxAutoTiles: 4, startAudio: 'main',
  });
});

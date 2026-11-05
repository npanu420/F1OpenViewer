import { test, expect, afterEach } from 'vitest';
import { getVodSeasons, getVodEvents, getVodSessions, getContentVideoStreams } from './vod';

const setBridge = (f1: unknown) => { (globalThis as { window?: unknown }).window = { f1 }; };
afterEach(() => { delete (globalThis as { window?: unknown }).window; });

test('failures reach the caller (the views turn them into an error banner)', async () => {
  const boom = () => Promise.reject(new Error('F1 TV: HTTP 500'));
  setBridge({ getVodSeasons: boom, getVodEvents: boom, getVodSessions: boom, getContentVideo: boom });
  await expect(getVodSeasons()).rejects.toThrow('HTTP 500');
  await expect(getVodEvents(1)).rejects.toThrow('HTTP 500');
  await expect(getVodSessions(1)).rejects.toThrow('HTTP 500');
  await expect(getContentVideoStreams(1)).rejects.toThrow('HTTP 500');
});

test('successful responses are mapped', async () => {
  setBridge({
    getVodEvents: async () => [{ meetingKey: '5', meetingName: 'X GP', meetingNumber: 2, pageId: 9, isTest: false }],
    getVodSessions: async () => [{ contentId: 7, title: 'Race', type: 'race', series: 'F1' }],
    getContentVideo: async () => ({ onboard: [{ contentId: 1, channelId: 2, title: 'VER' }], dataChannel: [], mainChannel: { contentId: 1, channelId: 3, title: 'World' } }),
  });
  expect((await getVodEvents(1))[0]).toMatchObject({ meetingKey: '5', pageId: 9, sessions: [], onboard: [] });
  expect((await getVodSessions(1))[0]).toMatchObject({ contentId: 7, type: 'race' });
  const s = await getContentVideoStreams(1);
  expect(s.onboard).toHaveLength(1);
  expect(s.mainChannel?.channelId).toBe(3);
});

test('without the Electron bridge everything resolves to empty', async () => {
  setBridge(undefined);
  expect(await getVodSeasons()).toEqual([]);
  expect(await getVodEvents(1)).toEqual([]);
  expect(await getVodSessions(1)).toEqual([]);
  expect(await getContentVideoStreams(1)).toEqual({ onboard: [], dataChannel: [] });
});

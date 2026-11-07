import { afterEach, expect, test, vi } from 'vitest';
import { getCatalog } from './catalog';
afterEach(() => vi.unstubAllGlobals());

test('live catalog is published while VOD is still pending', async () => {
  let finish!: (value: unknown[]) => void;
  const vod = new Promise<unknown[]>((resolve) => { finish = resolve; });
  vi.stubGlobal('window', { f1: {
    getLiveNow: async () => [{ contentId: 1, title: 'Live race' }],
    searchVod: () => vod,
  } });
  const progress = vi.fn();
  const pending = getCatalog(progress);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(progress).toHaveBeenCalledTimes(1);
  expect(progress.mock.calls[0][0]).toMatchObject([{ contentId: 1, kind: 'live' }]);
  finish([{ contentId: 2, title: 'Replay' }]);
  const result = await pending;
  expect(result.map((item) => item.contentId)).toEqual([1, 2]);
  expect(progress).toHaveBeenLastCalledWith(result);
});

test('failed VOD does not remove available live streams', async () => {
  vi.stubGlobal('window', { f1: {
    getLiveNow: async () => [{ contentId: 1 }],
    searchVod: async () => { throw new Error('offline'); },
  } });
  expect(await getCatalog()).toMatchObject([{ contentId: 1, kind: 'live' }]);
});

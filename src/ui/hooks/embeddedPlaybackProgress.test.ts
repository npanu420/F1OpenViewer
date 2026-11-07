import { beforeEach, expect, test, vi } from 'vitest';
import type { CatalogItem } from '../../domain/catalog';

const h = vi.hoisted(() => ({
  states: [] as unknown[],
  resolve: vi.fn(),
}));
vi.mock('react', () => ({
  useCallback: (fn: unknown) => fn,
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => {
    const index = h.states.push(initial) - 1;
    return [initial, (value: unknown) => {
      h.states[index] = typeof value === 'function' ? value(h.states[index]) : value;
    }];
  },
}));
vi.mock('../../services/entitlement', () => ({ resolvePlayback: h.resolve }));
vi.mock('../../i18n/LocaleContext', () => ({ useLocale: () => ({ t: (key: string) => key }) }));
import { useEmbeddedPlayback } from './useEmbeddedPlayback';

const a = { id: 'a', contentId: 1 } as CatalogItem;
const b = { id: 'b', contentId: 2 } as CatalogItem;
const info = { manifestUrl: 'manifest', licenseUrl: 'license' };
function deferred() {
  let resolve!: (value: typeof info) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<typeof info>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => { h.states = []; h.resolve.mockReset(); });

test('publishes each stream before the batch finishes and deduplicates concurrent starts', async () => {
  const first = deferred();
  const second = deferred();
  h.resolve.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const hook = useEmbeddedPlayback();
  const batch = hook.onPlayAllEmbedded([a, b, a]);
  await hook.onPlayEmbedded(a);
  expect(h.resolve).toHaveBeenCalledTimes(2);
  first.resolve(info);
  await first.promise;
  await Promise.resolve();
  expect(h.states[0]).toEqual({ a: info });
  expect(h.states[1]).toEqual({ a: false, b: true });
  second.resolve(info);
  await batch;
  expect(h.states[0]).toEqual({ a: info, b: info });
  await hook.onPlayAllEmbedded([a, b]);
  expect(h.resolve).toHaveBeenCalledTimes(2);
});

test('partial failure preserves successful playback and clears loading', async () => {
  const error = vi.fn();
  h.resolve.mockResolvedValueOnce(info).mockRejectedValueOnce(new Error('failed'));
  const hook = useEmbeddedPlayback(error);
  await hook.onPlayAllEmbedded([a, b]);
  expect(h.states[0]).toEqual({ a: info });
  expect(h.states[1]).toEqual({ a: false, b: false });
  expect(error).toHaveBeenLastCalledWith('failed');
});

test('old batch cannot overwrite playback or loading after reset', async () => {
  const old = deferred();
  const fresh = deferred();
  h.resolve.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const error = vi.fn();
  const hook = useEmbeddedPlayback(error);
  const batch = hook.onPlayAllEmbedded([a]);
  hook.resetPlayback();
  const next = hook.onPlayEmbedded(a);
  old.reject(new Error('old failure'));
  await batch;
  expect(h.states[0]).toEqual({});
  expect(h.states[1]).toEqual({ a: true });
  expect(error).not.toHaveBeenCalledWith('old failure');
  fresh.resolve(info);
  await next;
  expect(h.states[0]).toEqual({ a: info });
});

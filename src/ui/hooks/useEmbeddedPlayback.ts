import { useCallback, useRef, useState } from 'react';
import type { CatalogItem } from '../../domain/catalog';
import { resolvePlayback, type PlaybackInfo } from '../../services/entitlement';
import { useLocale } from '../../i18n/LocaleContext';

/** Message of a failed playback resolution (F1 messages such as "not available in your region" pass through). */
export function playbackErrorMessage(reason: unknown): string {
  const raw = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '';
  // Electron wraps main-process errors: "Error invoking remote method 'f1:contentPlay': Error: <real message>"
  return raw.replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, '').trim();
}

/**
 * Embedded-stream playback state shared by the dashboard, live event and standalone multiview:
 * which streams are playing, which are still resolving, and (unlike the old per-view copies)
 * failures are always reported through `onError` instead of silently resetting the play button.
 */
export function useEmbeddedPlayback(
  onError?: (msg: string) => void,
  initial: Record<string, PlaybackInfo> = {}
) {
  const { t } = useLocale();
  const [embeddedPlayback, setEmbeddedPlayback] = useState<Record<string, PlaybackInfo>>(initial);
  const [loadingItemIds, setLoadingItemIds] = useState<Record<string, boolean>>({});
  /**
   * Bumped by resetPlayback (session switch). Resolutions are serialized in main with a delay per
   * stream, so "Play all" can take seconds: results that land after a reset belong to the previous
   * session and must not be written into this one (nor clear its loading flags / show its errors).
   */
  const genRef = useRef(0);
  const pendingRef = useRef(new Set<string>());
  const playbackRef = useRef(embeddedPlayback);
  playbackRef.current = embeddedPlayback;

  const setLoading = useCallback((items: CatalogItem[], value: boolean) => {
    setLoadingItemIds((prev) => {
      const next = { ...prev };
      for (const it of items) next[it.id] = value;
      return next;
    });
  }, []);

  const onPlayEmbedded = useCallback(
    async (item: CatalogItem) => {
      if (pendingRef.current.has(item.id) || playbackRef.current[item.id]) return;
      pendingRef.current.add(item.id);
      const gen = genRef.current;
      setLoading([item], true);
      onError?.('');
      try {
        const info = await resolvePlayback(item);
        if (gen !== genRef.current) return;
        playbackRef.current = { ...playbackRef.current, [item.id]: info };
        setEmbeddedPlayback((prev) => ({ ...prev, [item.id]: info }));
      } catch (e) {
        if (gen !== genRef.current) return;
        onError?.(playbackErrorMessage(e) || t('error.openPlayer'));
      } finally {
        if (gen === genRef.current) {
          pendingRef.current.delete(item.id);
          setLoading([item], false);
        }
      }
    },
    [onError, setLoading, t]
  );

  const onPlayAllEmbedded = useCallback(
    async (items: CatalogItem[]) => {
      const targets = items.filter((item) => {
        if (pendingRef.current.has(item.id) || playbackRef.current[item.id]) return false;
        pendingRef.current.add(item.id);
        return true;
      });
      if (!targets.length) return;
      const gen = genRef.current;
      setLoading(targets, true);
      onError?.('');
      const results = await Promise.allSettled(targets.map(async (item) => {
        try {
          const info = await resolvePlayback(item);
          if (gen !== genRef.current) return;
          playbackRef.current = { ...playbackRef.current, [item.id]: info };
          setEmbeddedPlayback((prev) => ({ ...prev, [item.id]: info }));
        } finally {
          if (gen === genRef.current) {
            pendingRef.current.delete(item.id);
            setLoading([item], false);
          }
        }
      }));
      if (gen !== genRef.current) return; // session switched meanwhile
      const failures = results.flatMap((result) =>
        result.status === 'rejected' ? [playbackErrorMessage(result.reason)] : []
      );
      if (failures.length > 0) {
        const first = failures.find(Boolean) || t('error.openPlayer');
        onError?.(
          failures.length === 1
            ? first
            : t('dashboard.streamsFailed').replace('{count}', String(failures.length)).replace('{message}', first)
        );
      }
    },
    [onError, setLoading, t]
  );

  /** Drop streams (e.g. ported to a popout window that now plays them). */
  const removePlayback = useCallback((ids: string[]) => {
    if (!ids.length) return;
    setEmbeddedPlayback((prev) => {
      const next = { ...prev };
      for (const id of ids) delete next[id];
      return next;
    });
  }, []);

  const resetPlayback = useCallback(() => {
    genRef.current += 1;
    pendingRef.current.clear();
    playbackRef.current = {};
    setEmbeddedPlayback({});
    setLoadingItemIds({});
  }, []);

  return {
    embeddedPlayback,
    setEmbeddedPlayback,
    loadingItemIds,
    setLoading,
    onPlayEmbedded,
    onPlayAllEmbedded,
    removePlayback,
    resetPlayback,
  };
}

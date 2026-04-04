import { useEffect, useState } from 'react';

/**
 * Elenco id finestre multiview aperte (Electron). In browser senza preload resta [].
 */
export function useMultiviewWindows(): number[] {
  const [ids, setIds] = useState<number[]>([]);

  useEffect(() => {
    const api = window.f1;
    if (!api?.getMultiviewWindows) return undefined;

    let cancelled = false;
    api.getMultiviewWindows().then((list) => {
      if (!cancelled && Array.isArray(list)) setIds(list);
    });

    const unsub = api.onMultiviewWindowsChanged?.((payload) => {
      if (payload?.ids && Array.isArray(payload.ids)) setIds(payload.ids);
    });

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  return ids;
}

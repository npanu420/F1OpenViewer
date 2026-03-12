import type { NetRequest, NetResponse } from '../types/preload';

function buildUrl(url: string, query?: NetRequest['query']) {
  if (!query) return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

export async function backendRequest<T = unknown>(req: NetRequest): Promise<NetResponse<T>> {
  // Prefer IPC (main process) to avoid CORS and keep tokens off the renderer network layer.
  if (window.f1?.request) {
    return window.f1.request<T>(req);
  }

  // Fallback (dev in pure browser) — may be blocked by CORS.
  const url = buildUrl(req.url, req.query);
  const res = await fetch(url, {
    method: req.method,
    headers: req.headers,
    body: req.body ? JSON.stringify(req.body) : undefined,
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // keep text
  }

  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => (headers[k] = v));

  return {
    ok: res.ok,
    status: res.status,
    headers,
    data: data as T,
  };
}


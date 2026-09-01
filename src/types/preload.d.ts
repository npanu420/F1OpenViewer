export type NetRequest = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  timeoutMs?: number;
};

export type NetResponse<T = unknown> = {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  data: T;
};

export type SessionInfo = {
  accessToken?: string;
};

export type PreloadApi = {
  request<T = unknown>(req: NetRequest): Promise<NetResponse<T>>;
  setSession(session: SessionInfo): Promise<void>;
  getSession(): Promise<SessionInfo>;
  clearSession(): Promise<void>;
  login?(email: string, password: string): Promise<{ accessToken: string }>;
  loginWithToken?(tokenOrJson: string): Promise<{ accessToken: string }>;
  loginWithBrowser?(): Promise<{ accessToken: string }>;
  getLiveNow?(): Promise<unknown[]>;
  searchVod?(params?: Record<string, string>): Promise<unknown[]>;
  getVodCatalog?(): Promise<{ seasons: Array<{ year: number; events: unknown[] }> }>;
  getVodSeasons?(): Promise<Array<{ year: number; pageId: number }>>;
  getVodEvents?(seasonPageId: number): Promise<Array<{ meetingKey: string; meetingName: string; meetingNumber: number; pageId: number; isTest?: boolean }>>;
  getVodSessions?(gpPageId: number): Promise<Array<{ contentId: number; title: string; type: string; series?: string }>>;
  getContentVideo?(contentId: number): Promise<{ onboard: unknown[]; dataChannel?: unknown[]; mainChannel?: unknown; container: unknown }>;
  contentPlay?(contentId: number, channelId?: number): Promise<{
    manifestUrl: string;
    licenseUrl?: string;
    drmToken?: string;
    playToken?: string;
    licenseAscendonToken?: string;
    licenseEntitlementToken?: string;
    streamType?: string;
    /** F1 pipeline version from API (e.g. 5 for 2026+ VOD). */
    pipelineVersion?: number;
    /** CloudFront key-group id from pa_ manifest URL (not Widevine KID). */
    paCfKeyGroup?: string;
    contentId?: number;
    channelId?: number;
    fallbackManifestUrl?: string;
    fallbackLicenseUrl?: string;
    fallbackDrmToken?: string;
    fallbackStreamType?: string;
  }>;
  /** Open content in the F1 TV web player (new window, same origin = DRM ok). */
  openInF1TVWeb?(contentId: number, title?: string, channelId?: number): Promise<void>;
  isF1Ready?(): Promise<boolean>;
  restoreSession?(): Promise<{ accessToken: string | null; restored: boolean }>;
  /** Full reset: session, cookies, cache and all saved data. App will reload. */
  fullReset?(): Promise<{ ok: boolean }>;
  /** Opens a GitHub release URL in the OS default browser. */
  openExternal?(url: string): Promise<void>;
  /** Main window only: fires once at startup if a newer GitHub release exists. Returns an unsubscribe function. */
  onUpdateAvailable?(callback: (payload: { version: string; url: string }) => void): () => void;
  /** Durable (userData-backed) mirror of a fixed allowlist of localStorage settings keys.
   *  Survives a manual reinstall to a different folder, unlike localStorage itself. */
  getAllSettings?(): Promise<Record<string, string>>;
  setSetting?(key: string, value: string): void;
  /** Last error message from F1 license server (e.g. 403 region/subscription). Pass the streamKey
   *  embedded in the license proxy URL to get the per-stream error. */
  getLastLicenseError?(streamKey?: string): Promise<string>;
  /** Standalone player window: lock the window aspect ratio to the incoming video's. */
  reportIntrinsicVideoSize?(w: number, h: number): void;
  /** Standalone player window: main process is about to destroy the window, tear down
   *  the DRM player first. Returns an unsubscribe function. */
  onPlayerTeardownRequest?(callback: () => void): () => void;
  /** Open a new numbered multiview window; returns `{ id }`. */
  openMultiviewWindow?(): Promise<{ id: number }>;
  /** Numeric ids of open multiview windows (sorted). */
  getMultiviewWindows?(): Promise<number[]>;
  /** Fires when a multiview window opens or closes. */
  onMultiviewWindowsChanged?(callback: (payload: { ids: number[]; count: number }) => void): () => void;
  closeMultiviewWindow?(): Promise<void>;
  /** Live Timing (separate public feed; no DRM). */
  liveTiming?: {
    /** Resolve a season+session query to its archive path. */
    resolveSession(year: number, query: { sessionKey?: string | number; meetingKey?: string | number; meetingNumber?: number; meetingName?: string; sessionName?: string; sessionType?: string }): Promise<{ path: string; meeting: { Key?: string | number; Name?: string } | null; session: { Key?: string | number; Name?: string } | null } | null>;
    /** Fetch + parse all (or given) feeds for an archived session. */
    loadSession(path: string, feeds?: string[]): Promise<Record<string, Array<{ offsetMs: number; ts: string; data: unknown }>>>;
    /** Curated video-to-timing anchor for this session (session_start, seconds) plus per-channel camera diffs. */
    getSyncData(meetingKey: string | number, sessionKey: string | number): Promise<{ sessionStartSec: number; channelDiffs: Record<string, { diff: number; diffV2: number }>; contentId: string | null } | null>;
    /** Fetch a team radio clip's audio bytes (base64). The renderer's network stack can't reach the CDN directly. */
    getAudio(sessionPath: string, clipPath: string): Promise<string>;
    /** Open a standalone live-timing window; it resolves the path + sync itself so the click is instant.
     *  `live: true` opens it in live (SignalR) mode instead of replay for a session still in progress. */
    openWindow(opts: { path?: string; title?: string; year?: number; sessionKey?: string | number; meetingKey?: string | number; meetingNumber?: number; meetingName?: string; sessionName?: string; sessionType?: string; live?: boolean }): Promise<{ ok: boolean }>;
    /** In-window dock: live-timing IPC (liveUpdate/liveStatus/clock), no popout. */
    dockRegister(): Promise<{ ok: boolean }>;
    dockUnregister(): Promise<{ ok: boolean }>;
    /** Source window: publish the main-feed video clock for live-timing sync. wallClockMs is the
     *  frame's real broadcast UTC (DASH only) enabling exact auto-sync; null falls back to manual. */
    reportClock(payload: { timeSec: number; paused: boolean; wallClockMs: number | null }): void;
    /** Timing window: subscribe to the relayed video clock. Returns an unsubscribe fn. */
    onClock(callback: (payload: { timeSec: number; paused: boolean; wallClockMs: number | null }) => void): () => void;
    requestSeek(payload: { timeSec: number }): void;
    onSeekRequest(callback: (payload: { timeSec: number }) => void): () => void;
    /** Starts (or attaches to) the shared live SignalR connection. Returns the archive path once
     *  resolvable (for team-radio audio URLs) and whether an account token was available. */
    liveStart(opts: { year?: number; sessionKey?: string | number; meetingName?: string; sessionName?: string }): Promise<{ path: string | null }>;
    liveStop(): Promise<{ ok: boolean }>;
    /** Live feed records: same (feed,data) shape replay records feed into the reducer. */
    onLiveUpdate(callback: (payload: { feed: string; data: unknown }) => void): () => void;
    onLiveStatus(callback: (payload: { status: string; detail?: string }) => void): () => void;
  };
};

declare global {
  interface Window {
    f1: PreloadApi;
  }
}


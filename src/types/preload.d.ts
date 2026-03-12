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
  getVodEvents?(seasonPageId: number): Promise<Array<{ meetingKey: string; meetingName: string; meetingNumber: number; pageId: number }>>;
  getVodSessions?(gpPageId: number): Promise<Array<{ contentId: number; title: string; type: string }>>;
  getContentVideo?(contentId: number): Promise<{ onboard: unknown[]; dataChannel?: unknown[]; container: unknown }>;
  contentPlay?(contentId: number, channelId?: number): Promise<{
    manifestUrl: string;
    licenseUrl?: string;
    drmToken?: string;
    licenseAscendonToken?: string;
    licenseEntitlementToken?: string;
    streamType?: string;
    fallbackManifestUrl?: string;
    fallbackLicenseUrl?: string;
    fallbackDrmToken?: string;
    fallbackStreamType?: string;
  }>;
  /** Apre il contenuto nel player web F1 TV (nuova finestra, stesso dominio = DRM ok). */
  openInF1TVWeb?(contentId: number, title?: string, channelId?: number): Promise<void>;
  isF1Ready?(): Promise<boolean>;
  restoreSession?(): Promise<{ accessToken: string | null; restored: boolean }>;
};

declare global {
  interface Window {
    f1: PreloadApi;
  }
}


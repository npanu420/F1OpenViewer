import type { SessionInfo } from '../types/preload';

/** Session state as the renderer sees it: signed in or not. The token itself never leaves main. */
export const session = {
  async get(): Promise<SessionInfo> {
    if (window.f1?.getSession) return window.f1.getSession();
    return { signedIn: false };
  },
  async clear(): Promise<void> {
    if (window.f1?.clearSession) await window.f1.clearSession();
  },
};

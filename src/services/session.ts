import type { SessionInfo } from '../types/preload';

export const session = {
  async set(s: SessionInfo) {
    if (window.f1?.setSession) {
      await window.f1.setSession(s);
      return;
    }
    // fallback for non-electron dev
    sessionStorage.setItem('f1.session', JSON.stringify(s));
  },
  async get(): Promise<SessionInfo> {
    if (window.f1?.getSession) {
      return window.f1.getSession();
    }
    const raw = sessionStorage.getItem('f1.session');
    return raw ? (JSON.parse(raw) as SessionInfo) : {};
  },
  async clear() {
    if (window.f1?.clearSession) {
      await window.f1.clearSession();
      return;
    }
    sessionStorage.removeItem('f1.session');
  },
};


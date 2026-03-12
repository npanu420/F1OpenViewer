import { session } from './session';

/**
 * Login F1 TV con email/password (può dare 403 per protezione Imperva).
 */
export async function login(email: string, password: string): Promise<{ accessToken: string }> {
  if (!window.f1?.login) {
    throw new Error('Login F1 TV non disponibile (avvia l’app in Electron).');
  }
  const result = await window.f1.login(email, password);
  if (!result?.accessToken) throw new Error('Login fallito: token mancante.');
  await session.set({ accessToken: result.accessToken });
  return { accessToken: result.accessToken };
}

/**
 * Login con finestra browser integrata (come MultiViewer).
 * Si apre account.formula1.com, fai login lì, il token viene catturato e salvato.
 */
export async function loginWithBrowser(): Promise<{ accessToken: string }> {
  if (!window.f1?.loginWithBrowser) {
    throw new Error('Login con browser non disponibile (avvia l’app in Electron).');
  }
  const result = await window.f1.loginWithBrowser();
  if (!result?.accessToken) throw new Error('Login non completato.');
  await session.set({ accessToken: result.accessToken });
  return { accessToken: result.accessToken };
}

/**
 * Login con token copiato dal browser (DevTools → Network → by-password → Response).
 * Utile quando il login diretto restituisce 403.
 */
export async function loginWithToken(tokenOrJson: string): Promise<{ accessToken: string }> {
  if (!window.f1?.loginWithToken) {
    throw new Error('Login con token non disponibile (avvia l’app in Electron).');
  }
  const result = await window.f1.loginWithToken(tokenOrJson);
  if (!result?.accessToken) throw new Error('Token non valido.');
  await session.set({ accessToken: result.accessToken });
  return { accessToken: result.accessToken };
}

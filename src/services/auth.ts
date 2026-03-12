import { session } from './session';

/**
 * F1 TV login with email/password (may return 403 due to Imperva protection).
 */
export async function login(email: string, password: string): Promise<{ accessToken: string }> {
  if (!window.f1?.login) {
    throw new Error('F1 TV login not available (run the app in Electron).');
  }
  const result = await window.f1.login(email, password);
  if (!result?.accessToken) throw new Error('Login failed: token missing.');
  await session.set({ accessToken: result.accessToken });
  return { accessToken: result.accessToken };
}

/**
 * Login with in-app browser window.
 * Opens account.formula1.com; sign in there and the token is captured and saved.
 */
export async function loginWithBrowser(): Promise<{ accessToken: string }> {
  if (!window.f1?.loginWithBrowser) {
    throw new Error('Browser login not available (run the app in Electron).');
  }
  const result = await window.f1.loginWithBrowser();
  if (!result?.accessToken) throw new Error('Sign-in not completed.');
  await session.set({ accessToken: result.accessToken });
  return { accessToken: result.accessToken };
}

/**
 * Login with token copied from browser (DevTools → Network → by-password → Response).
 * Useful when direct login returns 403.
 */
export async function loginWithToken(tokenOrJson: string): Promise<{ accessToken: string }> {
  if (!window.f1?.loginWithToken) {
    throw new Error('Token login not available (run the app in Electron).');
  }
  const result = await window.f1.loginWithToken(tokenOrJson);
  if (!result?.accessToken) throw new Error('Invalid token.');
  await session.set({ accessToken: result.accessToken });
  return { accessToken: result.accessToken };
}

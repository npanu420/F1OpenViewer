/** F1 TV sign-in. Each call resolves once the main process holds a working session. */

function ensureSignedIn(result: { signedIn?: boolean } | undefined, message: string): void {
  if (!result?.signedIn) throw new Error(message);
}

/** Email/password (F1 often answers 403 because of its bot protection). */
export async function login(email: string, password: string): Promise<void> {
  if (!window.f1?.login) throw new Error('F1 TV login not available (run the app in Electron).');
  ensureSignedIn(await window.f1.login(email, password), 'Login failed: token missing.');
}

/** In-app browser window on account.formula1.com; the token is captured by the main process. */
export async function loginWithBrowser(): Promise<void> {
  if (!window.f1?.loginWithBrowser) throw new Error('Browser login not available (run the app in Electron).');
  ensureSignedIn(await window.f1.loginWithBrowser(), 'Sign-in not completed.');
}

/** Token copied from the by-password response in browser DevTools (fallback when direct login 403s). */
export async function loginWithToken(tokenOrJson: string): Promise<void> {
  if (!window.f1?.loginWithToken) throw new Error('Token login not available (run the app in Electron).');
  ensureSignedIn(await window.f1.loginWithToken(tokenOrJson), 'Invalid token.');
}

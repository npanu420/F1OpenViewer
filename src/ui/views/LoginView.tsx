import React, { useState } from 'react';
import { login, loginWithToken, loginWithBrowser } from '../../services/auth';
import { useLocale } from '../../i18n/LocaleContext';

type Props = {
  onLoggedIn: () => Promise<void>;
  setError: (e: string | null) => void;
  setBusy: (b: boolean) => void;
};

type Mode = 'browser' | 'credentials' | 'token';

export function LoginView({ onLoggedIn, setError, setBusy }: Props) {
  const { t } = useLocale();
  const [mode, setMode] = useState<Mode>('browser');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tokenInput, setTokenInput] = useState('');

  async function onLoginWithBrowser() {
    setBusy(true);
    setError(null);
    try {
      await loginWithBrowser();
      await onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('login.errorCancelled'));
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitCredentials(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      await onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('login.errorSignIn'));
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitToken(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await loginWithToken(tokenInput);
      await onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('login.errorInvalidToken'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 520 }}>
      <div>
        <h2 style={{ margin: '0 0 6px' }}>{t('login.title')}</h2>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>
          {t('login.recommended')}
        </p>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <button
          type="button"
          className="btn btnPrimary"
          onClick={onLoginWithBrowser}
          style={{ padding: '14px 18px', fontSize: 15 }}
        >
          {t('login.withBrowser')}
        </button>
      </div>

      <details style={{ border: '1px solid var(--stroke)', borderRadius: 12, padding: '10px 12px' }}>
        <summary style={{ cursor: 'pointer', color: 'var(--muted)', fontSize: 13 }}>
          {t('login.otherMethods')}
        </summary>
        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <button
            type="button"
            className={`btn ${mode === 'credentials' ? 'btnPrimary' : ''}`}
            onClick={() => { setMode('credentials'); setError(null); }}
          >
            {t('login.emailPassword')}
          </button>
          <button
            type="button"
            className={`btn ${mode === 'token' ? 'btnPrimary' : ''}`}
            onClick={() => { setMode('token'); setError(null); }}
          >
            {t('login.pasteToken')}
          </button>
        </div>

        {mode === 'credentials' && (
          <form onSubmit={onSubmitCredentials} style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: 'var(--muted)', fontSize: 13 }}>{t('login.email')}</span>
              <input
                className="input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('login.emailPlaceholder')}
                required
              />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: 'var(--muted)', fontSize: 13 }}>{t('login.password')}</span>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </label>
            <button className="btn btnPrimary" type="submit">
              {t('login.signIn')}
            </button>
          </form>
        )}

        {mode === 'token' && (
          <form onSubmit={onSubmitToken} style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: 'var(--muted)', fontSize: 13 }}>
                {t('login.tokenHint')}
              </span>
              <textarea
                className="input"
                rows={3}
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder={t('login.tokenPlaceholder')}
                style={{ resize: 'vertical', minHeight: 60 }}
              />
            </label>
            <button className="btn btnPrimary" type="submit" disabled={!tokenInput.trim()}>
              {t('login.signInWithToken')}
            </button>
          </form>
        )}
      </details>
    </div>
  );
}

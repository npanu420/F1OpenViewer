import React, { useState } from 'react';
import { motion } from 'framer-motion';
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
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <motion.div
        className="w-full max-w-md glass-panel rounded-xl p-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="mb-6">
          <h2 className="font-heading text-2xl font-bold tracking-wider text-foreground m-0">
            {t('login.title')}
          </h2>
          <p className="text-sm text-muted-foreground mt-2 mb-0">
            {t('login.recommended')}
          </p>
        </div>

        <div className="space-y-4">
          <motion.button
            type="button"
            onClick={onLoginWithBrowser}
            className="w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-lg font-heading font-bold tracking-wider bg-primary text-primary-foreground border border-primary glow-red hover:opacity-95 transition-opacity"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            {t('login.withBrowser')}
          </motion.button>
        </div>

        <details className="mt-6 border border-border rounded-lg overflow-hidden bg-card/50">
          <summary className="cursor-pointer text-muted-foreground text-sm py-3 px-4 font-heading tracking-wider hover:text-foreground">
            {t('login.otherMethods')}
          </summary>
          <div className="px-4 pb-4 pt-2 space-y-4">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setMode('credentials');
                  setError(null);
                }}
                className={`flex-1 py-2.5 rounded-md font-heading text-sm font-bold tracking-wider border transition-colors ${
                  mode === 'credentials'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-accent/30 text-muted-foreground border-border hover:text-foreground'
                }`}
              >
                {t('login.emailPassword')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('token');
                  setError(null);
                }}
                className={`flex-1 py-2.5 rounded-md font-heading text-sm font-bold tracking-wider border transition-colors ${
                  mode === 'token'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-accent/30 text-muted-foreground border-border hover:text-foreground'
                }`}
              >
                {t('login.pasteToken')}
              </button>
            </div>

            {mode === 'credentials' && (
              <form onSubmit={onSubmitCredentials} className="space-y-4">
                <label className="block space-y-1.5">
                  <span className="text-muted-foreground text-xs font-heading tracking-wider">
                    {t('login.email')}
                  </span>
                  <input
                    className="w-full bg-background/80 border border-border rounded-lg px-3 py-2.5 text-foreground outline-none focus:border-primary/50"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('login.emailPlaceholder')}
                    required
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-muted-foreground text-xs font-heading tracking-wider">
                    {t('login.password')}
                  </span>
                  <input
                    className="w-full bg-background/80 border border-border rounded-lg px-3 py-2.5 text-foreground outline-none focus:border-primary/50"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </label>
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-lg font-heading font-bold tracking-wider bg-primary text-primary-foreground border border-primary"
                >
                  {t('login.signIn')}
                </button>
              </form>
            )}

            {mode === 'token' && (
              <form onSubmit={onSubmitToken} className="space-y-4">
                <label className="block space-y-1.5">
                  <span className="text-muted-foreground text-xs font-heading tracking-wider">
                    {t('login.tokenHint')}
                  </span>
                  <textarea
                    className="w-full bg-background/80 border border-border rounded-lg px-3 py-2.5 text-foreground outline-none focus:border-primary/50 resize-y min-h-[80px]"
                    rows={3}
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    placeholder={t('login.tokenPlaceholder')}
                  />
                </label>
                <button
                  type="submit"
                  disabled={!tokenInput.trim()}
                  className="w-full py-2.5 rounded-lg font-heading font-bold tracking-wider bg-primary text-primary-foreground border border-primary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t('login.signInWithToken')}
                </button>
              </form>
            )}
          </div>
        </details>
      </motion.div>
    </div>
  );
}

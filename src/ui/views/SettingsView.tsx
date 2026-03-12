import React from 'react';
import { useLocale } from '../../i18n/LocaleContext';

type Props = {
  isSignedIn: boolean;
  onLogout: () => Promise<void>;
  onBack: () => void;
};

export function SettingsView({ isSignedIn, onLogout, onBack }: Props) {
  const { t, locale, setLocale } = useLocale();

  return (
    <div style={{ display: 'grid', gap: 24, maxWidth: 520 }}>
      <h2 style={{ margin: '0 0 8px' }}>{t('settings.title')}</h2>

      <section style={{ border: '1px solid var(--stroke)', borderRadius: 12, padding: 16 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 15, color: 'var(--muted)' }}>
          {t('settings.account')}
        </h3>
        {isSignedIn ? (
          <p style={{ margin: 0, fontSize: 14 }}>
            {t('settings.accountSignedIn')}
          </p>
        ) : (
          <p style={{ margin: 0, fontSize: 14, color: 'var(--muted)' }}>
            {t('settings.accountNotAvailable')}
          </p>
        )}
        {isSignedIn && (
          <button
            type="button"
            className="btn btnDanger"
            onClick={onLogout}
            style={{ marginTop: 12 }}
          >
            {t('settings.logout')}
          </button>
        )}
      </section>

      <section style={{ border: '1px solid var(--stroke)', borderRadius: 12, padding: 16 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 15, color: 'var(--muted)' }}>
          {t('settings.languageLabel')}
        </h3>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`btn ${locale === 'en' ? 'btnPrimary' : ''}`}
            onClick={() => setLocale('en')}
          >
            English
          </button>
          <button
            type="button"
            className={`btn ${locale === 'it' ? 'btnPrimary' : ''}`}
            onClick={() => setLocale('it')}
          >
            Italiano
          </button>
        </div>
      </section>

      <button type="button" className="btn" onClick={onBack}>
        {t('settings.back')}
      </button>
    </div>
  );
}

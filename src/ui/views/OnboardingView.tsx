import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { CURRENT_GRID } from '../../domain/driverGrid';
import { LANGUAGES, type Locale } from '../../i18n/translations';
import { useLocale } from '../../i18n/LocaleContext';
import { favoriteDriverKey, toggleFavoriteDriver, useFavoriteDrivers } from '../../services/favoriteDrivers';
import { detectLocale, setOnboardingState } from '../../services/onboarding';

const LoginView = lazy(() => import('./LoginView').then((m) => ({ default: m.LoginView })));

const STEPS = 3;

type Props = {
  onLoggedIn: () => Promise<void>;
  error: string | null;
  setError: (e: string | null) => void;
  setBusy: (b: boolean) => void;
};

/** First launch: language, favourite drivers, then the normal sign-in. */
export function OnboardingView({ onLoggedIn, error, setError, setBusy }: Props) {
  const { t, locale, setLocale } = useLocale();
  const [step, setStep] = useState(0);
  const favorites = useFavoriteDrivers();

  useEffect(() => {
    setOnboardingState('started');
    // Start in the system language, unless an earlier, unfinished run already picked one.
    let stored: string | null = null;
    try { stored = localStorage.getItem('f1openviewer-locale'); } catch (_) {}
    if (!stored) setLocale(detectLocale(navigator.languages?.length ? navigator.languages : [navigator.language ?? 'en']));
  }, [setLocale]);

  const stepLabel = t('onboarding.step').replace('{current}', String(step + 1)).replace('{total}', String(STEPS));

  if (step === 2) {
    return (
      <Suspense fallback={null}>
        <LoginView
          onLoggedIn={async () => {
            setOnboardingState('done');
            await onLoggedIn();
          }}
          error={error}
          setError={setError}
          setBusy={setBusy}
          stepLabel={stepLabel}
          onBack={() => { setError(null); setStep(1); }}
        />
      </Suspense>
    );
  }

  const picked = CURRENT_GRID.filter((d) => favorites.some((f) => favoriteDriverKey(f) === favoriteDriverKey(d.name))).length;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className={`onboarding-card glass-panel rounded-xl p-8 w-full ${step === 1 ? 'max-w-3xl' : 'max-w-md'}`}>
        <p className="brand-wordmark text-lg mb-6">OpenViewer</p>
        <p className="onboarding-step" aria-live="polite">{stepLabel}</p>

        {step === 0 && (
          <>
            <h1 className="font-heading text-2xl font-bold tracking-wider text-foreground m-0">{t('onboarding.welcomeTitle')}</h1>
            <p className="text-sm text-muted-foreground mt-2 mb-6">{t('onboarding.welcomeBody')}</p>
            <h2 className="onboarding-heading">{t('onboarding.languageTitle')}</h2>
            <div role="radiogroup" aria-label={t('onboarding.languageTitle')} className="onboarding-languages">
              {LANGUAGES.map((language) => (
                <button
                  key={language.code}
                  type="button"
                  role="radio"
                  aria-checked={locale === language.code}
                  className="onboarding-option"
                  onClick={() => setLocale(language.code as Locale)}
                >
                  <span className="onboarding-option-name">{language.name}</span>
                  {language.wip && <span className="onboarding-tag">{t('onboarding.beta')}</span>}
                  {locale === language.code && <Check className="w-4 h-4 ml-auto shrink-0" aria-hidden />}
                </button>
              ))}
            </div>
            <p className="onboarding-hint">{t('onboarding.languageHint')}</p>
          </>
        )}

        {step === 1 && (
          <>
            <h1 className="font-heading text-2xl font-bold tracking-wider text-foreground m-0">{t('onboarding.driversTitle')}</h1>
            <p className="text-sm text-muted-foreground mt-2 mb-5">{t('onboarding.driversHint')}</p>
            <div className="onboarding-drivers">
              {CURRENT_GRID.map((driver) => {
                const selected = favorites.some((f) => favoriteDriverKey(f) === favoriteDriverKey(driver.name));
                return (
                  <button
                    key={driver.name}
                    type="button"
                    aria-pressed={selected}
                    className="onboarding-driver"
                    onClick={() => toggleFavoriteDriver(driver.name)}
                  >
                    <span className="onboarding-driver-team" style={{ backgroundColor: driver.colour }} aria-hidden />
                    <span className="onboarding-driver-number" aria-hidden>{driver.number}</span>
                    <span className="onboarding-driver-text">
                      <span className="onboarding-driver-name">{driver.name}</span>
                      <span className="onboarding-driver-sub">{driver.team}</span>
                    </span>
                    {selected && <Check className="w-4 h-4 ml-auto shrink-0" aria-hidden />}
                  </button>
                );
              })}
            </div>
            <p className="onboarding-hint" aria-live="polite">{t('onboarding.driversSelected').replace('{count}', String(picked))}</p>
          </>
        )}

        <div className="onboarding-actions">
          {step > 0 ? (
            <button type="button" className="ui-button" onClick={() => setStep(step - 1)}>{t('onboarding.back')}</button>
          ) : <span />}
          <button
            type="button"
            className="onboarding-primary"
            onClick={() => setStep(step + 1)}
          >
            {step === 1 && picked === 0 ? t('onboarding.skip') : t('onboarding.continue')}
          </button>
        </div>
      </div>
    </div>
  );
}

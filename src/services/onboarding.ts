import { LANGUAGES, type Locale } from '../i18n/translations';
import { persistDurableSetting } from './durableStorage';

const ONBOARDING_KEY = 'f1openviewer-onboarding';

/** null: never shown. started: shown but not finished (resumes). done: finished, never again. */
export type OnboardingState = 'started' | 'done' | null;

/** Settings a person chose or built up; the theme and update notices are written by the app itself. */
const USER_DATA_KEYS = [
  'f1openviewer-locale',
  'f1openviewer-saved-grids',
  'f1openviewer-favorite-drivers',
  'f1openviewer-preferences',
  'f1openviewer-sync-offset-threshold',
  'f1openviewer-sync-done-delay-ms',
  'f1openviewer-sync-keep-locked',
  'f1openviewer-sync-reference-mode',
  'f1openviewer-livetiming-dock-width',
  'f1openviewer-header-collapsed',
  'f1openviewer-multiview-bar-collapsed',
];
const USER_DATA_PREFIXES = ['f1lt-sync:'];

type ReadableStorage = Pick<Storage, 'getItem' | 'key' | 'length'>;

/** True when the app already holds settings from earlier use (an install that predates the setup). */
export function hasSavedUserData(storage: ReadableStorage): boolean {
  for (const key of USER_DATA_KEYS) if (storage.getItem(key) != null) return true;
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key && USER_DATA_PREFIXES.some((prefix) => key.startsWith(prefix))) return true;
  }
  return false;
}

/** Shown on a fresh install, and again until finished if it was left half way. */
export function shouldShowOnboarding(state: OnboardingState, hasData: boolean): boolean {
  if (state === 'started') return true;
  return state !== 'done' && !hasData;
}

export function parseOnboardingState(raw: string | null): OnboardingState {
  return raw === 'started' || raw === 'done' ? raw : null;
}

export function getOnboardingState(): OnboardingState {
  try {
    return parseOnboardingState(localStorage.getItem(ONBOARDING_KEY));
  } catch {
    return null;
  }
}

export function setOnboardingState(state: Exclude<OnboardingState, null>): void {
  try {
    localStorage.setItem(ONBOARDING_KEY, state);
  } catch (_) {}
  persistDurableSetting(ONBOARDING_KEY, state);
}

export function onboardingNeeded(): boolean {
  try {
    return shouldShowOnboarding(getOnboardingState(), hasSavedUserData(localStorage));
  } catch {
    return false;
  }
}

/** The first of the system's preferred languages the app is available in, else English. */
export function detectLocale(preferred: readonly string[]): Locale {
  for (const language of preferred) {
    const base = language.toLowerCase().split('-')[0];
    const match = LANGUAGES.find((l) => l.code === base);
    if (match) return match.code;
  }
  return 'en';
}

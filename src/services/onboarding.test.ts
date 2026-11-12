import { test, expect } from 'vitest';
import { detectLocale, hasSavedUserData, parseOnboardingState, shouldShowOnboarding } from './onboarding';

function storageOf(values: Record<string, string>) {
  const keys = Object.keys(values);
  return { getItem: (k: string) => values[k] ?? null, key: (i: number) => keys[i] ?? null, length: keys.length };
}

test('a fresh install shows the setup, an install with settings does not', () => {
  expect(shouldShowOnboarding(null, false)).toBe(true);
  expect(shouldShowOnboarding(null, true)).toBe(false);
});

test('a setup left half way resumes even though it saved settings itself', () => {
  expect(shouldShowOnboarding('started', true)).toBe(true);
  expect(shouldShowOnboarding('started', false)).toBe(true);
});

test('a finished setup never comes back, not even with no settings left', () => {
  expect(shouldShowOnboarding('done', false)).toBe(false);
  expect(shouldShowOnboarding('done', true)).toBe(false);
});

test('only settings a person made count as saved data, not the theme or the update notice', () => {
  expect(hasSavedUserData(storageOf({}))).toBe(false);
  expect(hasSavedUserData(storageOf({ 'f1-theme': 'dark', 'f1-dismissed-update-version': '1.2.4' }))).toBe(false);
  expect(hasSavedUserData(storageOf({ 'f1openviewer-locale': 'it' }))).toBe(true);
  expect(hasSavedUserData(storageOf({ 'f1openviewer-favorite-drivers': '[]' }))).toBe(true);
  expect(hasSavedUserData(storageOf({ 'f1lt-sync:2025:race': '12' }))).toBe(true);
});

test('an unknown stored state is treated as never shown', () => {
  expect(parseOnboardingState('done')).toBe('done');
  expect(parseOnboardingState('started')).toBe('started');
  expect(parseOnboardingState('x')).toBeNull();
  expect(parseOnboardingState(null)).toBeNull();
});

test('the language follows the system, region codes ignored, English as the fallback', () => {
  expect(detectLocale(['it-IT', 'en-US'])).toBe('it');
  expect(detectLocale(['pt-BR', 'de-AT'])).toBe('de');
  expect(detectLocale(['ja-JP'])).toBe('en');
  expect(detectLocale([])).toBe('en');
});

import { test, expect } from 'vitest';
import { getCountryCodeFromEventName, getEventCountryCode, getFlag } from './flags';

// Real 2026 event names from the F1 TV archive (sponsor prefixes included).
const CASES: Array<[string, string]> = [
  ['FORMULA 1 QATAR AIRWAYS AUSTRALIAN GRAND PRIX 2026', 'AU'],
  ['FORMULA 1 HEINEKEN CHINESE GRAND PRIX 2026', 'CN'],
  ['FORMULA 1 GRAN PREMIO DE LA CIUDAD DE MÉXICO 2026', 'MX'],
  ['FORMULA 1 ARAMCO JAPANESE GRAND PRIX 2026', 'JP'],
  ['FORMULA 1 CRYPTO.COM MIAMI GRAND PRIX 2026', 'US'],
  ['FORMULA 1 LENOVO GRAND PRIX DU CANADA 2026', 'CA'],
  ['FORMULA 1 LOUIS VUITTON GRAN PREMIO DE MONACO 2026', 'MC'],
  ['FORMULA 1 MSC CRUISES GRAN PREMIO DE BARCELONA-CATALUNYA 2026', 'ES'],
  ['FORMULA 1 LENOVO AUSTRIAN GRAND PRIX 2026', 'AT'],
  ['FORMULA 1 PIRELLI BRITISH GRAND PRIX 2026', 'GB'],
  ['FORMULA 1 MOËT & CHANDON BELGIAN GRAND PRIX 2026', 'BE'],
  ['FORMULA 1 AWS HUNGARIAN GRAND PRIX 2026', 'HU'],
  ['FORMULA 1 HEINEKEN DUTCH GRAND PRIX 2026', 'NL'],
  ["FORMULA 1 PIRELLI GRAN PREMIO D'ITALIA 2026", 'IT'],
  ['FORMULA 1 QATAR AIRWAYS AZERBAIJAN GRAND PRIX 2026', 'AZ'],
  ['FORMULA 1 QATAR AIRWAYS QATAR GRAND PRIX 2025', 'QA'],
  ['FORMULA 1 ROLEX AUSTRALIAN GRAND PRIX 2019', 'AU'],
];

test.each(CASES)('%s -> %s', (name, code) => {
  expect(getCountryCodeFromEventName(name)).toBe(code);
});

test('the Qatar Airways sponsor alone never makes a race "Qatar"', () => {
  expect(getCountryCodeFromEventName('FORMULA 1 QATAR AIRWAYS SOMETHING GRAND PRIX 2026')).toBe('');
});

test('Australia and Austria are not confused', () => {
  expect(getCountryCodeFromEventName('Australian Grand Prix')).toBe('AU');
  expect(getCountryCodeFromEventName('Austrian Grand Prix')).toBe('AT');
});

test('testing / unknown events have no country and fall back to the chequered flag', () => {
  expect(getCountryCodeFromEventName('FORMULA 1 ARAMCO PRE-SEASON TESTING 1 2026')).toBe('');
  expect(getCountryCodeFromEventName(undefined)).toBe('');
  expect(getFlag('')).toBe('🏁');
});

test('getEventCountryCode uses the name when the meeting key is only a page id', () => {
  expect(getEventCountryCode({ meetingKey: '12345', meetingName: 'FORMULA 1 HEINEKEN CHINESE GRAND PRIX 2026' })).toBe('CN');
  expect(getEventCountryCode({ meetingKey: 'australia', meetingName: '' })).toBe('AU'); // slug still honoured
});

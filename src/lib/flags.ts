const countryFlags: Record<string, string> = {
  BH: '🇧🇭', SA: '🇸🇦', AU: '🇦🇺', JP: '🇯🇵', CN: '🇨🇳', US: '🇺🇸',
  IT: '🇮🇹', MC: '🇲🇨', CA: '🇨🇦', ES: '🇪🇸', AT: '🇦🇹', GB: '🇬🇧',
  HU: '🇭🇺', BE: '🇧🇪', NL: '🇳🇱', AZ: '🇦🇿', SG: '🇸🇬', MX: '🇲🇽',
  BR: '🇧🇷', QA: '🇶🇦', AE: '🇦🇪', PT: '🇵🇹', FR: '🇫🇷', DE: '🇩🇪',
  MY: '🇲🇾', KR: '🇰🇷', IN: '🇮🇳', TR: '🇹🇷', RU: '🇷🇺',
};

/** F1 meeting key (e.g. "australia", "bahrain") to ISO country code */
const meetingKeyToCountry: Record<string, string> = {
  australia: 'AU', bahrain: 'BH', saudi: 'SA', china: 'CN', japan: 'JP',
  miami: 'US', emilia: 'IT', monaco: 'MC', spain: 'ES', canada: 'CA',
  austria: 'AT', britain: 'GB', hungary: 'HU', belgium: 'BE', netherlands: 'NL',
  italy: 'IT', azerbaijan: 'AZ', singapore: 'SG', usa: 'US', mexico: 'MX',
  brazil: 'BR', vegas: 'US', qatar: 'QA', abu: 'AE', portugal: 'PT', france: 'FR',
  germany: 'DE', malaysia: 'MY', korea: 'KR', india: 'IN', turkey: 'TR', russia: 'RU',
};

/**
 * Official event names ("FORMULA 1 QATAR AIRWAYS AUSTRALIAN GRAND PRIX 2026", "... GRAN PREMIO DE
 * MONACO ...") -> ISO country. First match wins, so the Qatar GP is matched by its full name: the
 * sponsor "Qatar Airways" is in the title of nearly every 2026 race.
 */
const NAME_PATTERNS: Array<[RegExp, string]> = [
  [/qatar grand prix/i, 'QA'],
  [/australia/i, 'AU'],
  [/bahrain/i, 'BH'],
  [/saudi|jeddah/i, 'SA'],
  [/chin(a|ese)|shanghai/i, 'CN'],
  [/japan|suzuka/i, 'JP'],
  [/miami|las vegas|united states|austin|\busa\b/i, 'US'],
  [/emilia|romagna|imola|ital(y|ian|ia)\b|monza/i, 'IT'],
  [/monaco|monte.?carlo/i, 'MC'],
  [/spain|spanish|espa[nñ]a|barcelona|catalunya|madrid/i, 'ES'],
  [/canad/i, 'CA'],
  [/austria/i, 'AT'],
  [/brit|silverstone|great britain|united kingdom/i, 'GB'],
  [/hungar/i, 'HU'],
  [/belg|spa-francorchamps/i, 'BE'],
  [/dutch|netherlands|zandvoort/i, 'NL'],
  [/azerbaijan|baku/i, 'AZ'],
  [/singapore/i, 'SG'],
  [/mexic/i, 'MX'],
  [/paulo|brazil|brasil|interlagos/i, 'BR'],
  [/abu dhabi|yas marina/i, 'AE'],
  [/portug/i, 'PT'],
  [/french|france/i, 'FR'],
  [/german/i, 'DE'],
  [/malaysia/i, 'MY'],
  [/korea/i, 'KR'],
  [/india/i, 'IN'],
  [/turk/i, 'TR'],
  [/russia/i, 'RU'],
];

/** Country code for an event, from its display name. Empty string when unknown (e.g. testing). */
export function getCountryCodeFromEventName(name?: string | null): string {
  if (!name) return '';
  for (const [re, code] of NAME_PATTERNS) if (re.test(name)) return code;
  return '';
}

/** Country code for a catalog event: the meeting key when it happens to be a slug, else the name. */
export function getEventCountryCode(event: { meetingKey?: string; meetingName?: string }): string {
  return getCountryCodeFromMeetingKey(event.meetingKey ?? '') || getCountryCodeFromEventName(event.meetingName);
}

export function getFlag(countryCode: string): string {
  return countryFlags[countryCode] || '🏁';
}

export function getCountryCodeFromMeetingKey(meetingKey: string): string {
  const key = meetingKey?.toLowerCase().replace(/\s+/g, '') || '';
  return meetingKeyToCountry[key] || '';
}

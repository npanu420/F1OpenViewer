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

export function getFlag(countryCode: string): string {
  return countryFlags[countryCode] || '🏁';
}

export function getCountryCodeFromMeetingKey(meetingKey: string): string {
  const key = meetingKey?.toLowerCase().replace(/\s+/g, '') || '';
  return meetingKeyToCountry[key] || '';
}

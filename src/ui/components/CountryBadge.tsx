import { Flag, Wrench } from 'lucide-react';
// Named imports from the ES module index: the bundler keeps only these flags.
import { AE, AT, AU, AZ, BE, BH, BR, CA, CN, DE, ES, FR, GB, HU, IN, IT, JP, KR, MC, MX, MY, NL, PT, QA, RU, SA, SG, TR, US } from 'country-flag-icons/string/3x2';

// Bundled SVG flags: Windows has no flag emoji and would show two letters instead.
const SVG: Record<string, string> = { AE, AT, AU, AZ, BE, BH, BR, CA, CN, DE, ES, FR, GB, HU, IN, IT, JP, KR, MC, MX, MY, NL, PT, QA, RU, SA, SG, TR, US };

interface CountryBadgeProps {
  code: string;
  isTest?: boolean;
  size?: 'sm' | 'lg';
}

export function CountryBadge({ code, isTest = false, size = 'sm' }: CountryBadgeProps) {
  const iconSize = size === 'lg' ? 'w-5 h-5' : 'w-4 h-4';
  if (isTest) return <Wrench className={`${iconSize} text-muted-foreground shrink-0`} aria-hidden />;
  const svg = SVG[code.toUpperCase()];
  const flag = svg && `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  if (!flag) return <Flag className={`${iconSize} text-muted-foreground shrink-0`} aria-hidden />;
  return <img src={flag} alt="" aria-hidden className={`country-flag ${size === 'lg' ? 'country-flag-lg' : ''}`} />;
}

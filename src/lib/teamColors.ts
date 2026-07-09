/** Team name (normalized) -> HSL triplet, same hsl() convention as StreamPanel. */
const TEAM_COLORS: Record<string, string> = {
  redbullracing: '211 100% 42%',
  ferrari: '0 90% 45%',
  mercedes: '174 100% 41%',
  mclaren: '24 100% 50%',
  astonmartin: '160 84% 30%',
  alpine: '212 90% 58%',
  williams: '204 100% 45%',
  racingbulls: '223 55% 40%',
  kicksauber: '90 60% 45%',
  haas: '0 0% 75%',
};

/** F1TV spellings that don't match TEAM_COLORS keys. */
const TEAM_ALIASES: Record<string, string> = {
  oracleredbullracing: 'redbullracing',
  redbull: 'redbullracing',
  scuderiaferrari: 'ferrari',
  mercedesamgpetronas: 'mercedes',
  mclarenf1team: 'mclaren',
  astonmartinaramco: 'astonmartin',
  alpinef1team: 'alpine',
  williamsracing: 'williams',
  visacashapprbf1team: 'racingbulls',
  rb: 'racingbulls',
  stakef1teamkicksauber: 'kicksauber',
  sauber: 'kicksauber',
  moneygramhaasf1team: 'haas',
  haasf1team: 'haas',
};

function normalizeTeamName(teamName: string): string {
  return teamName.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Team color or undefined. */
export function getTeamColor(teamName?: string | null): string | undefined {
  if (!teamName) return undefined;
  const key = normalizeTeamName(teamName);
  return TEAM_COLORS[key] ?? TEAM_COLORS[TEAM_ALIASES[key]];
}

/** Initials from driver name, else car number. */
export function getDriverInitials(driverName?: string | null, racingNumber?: number): string {
  const name = driverName?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  }
  return racingNumber != null ? String(racingNumber) : '?';
}

import { useLocale } from '../../i18n/LocaleContext';

const ARCHIVE_YEAR = -1;

interface SeasonSelectorProps {
  selectedYear: number;
  onSelectYear: (year: number) => void;
  /** Available years from API (e.g. from vodSeasons). If empty, use default 2026..2018. */
  availableYears?: number[];
}

export function SeasonSelector({
  selectedYear,
  onSelectYear,
  availableYears,
}: SeasonSelectorProps) {
  const { t } = useLocale();
  // Fallback until the API answers: current year back to 2018 (the oldest season the app offers).
  const currentYear = new Date().getFullYear();
  const defaultYears = Array.from({ length: Math.max(1, currentYear - 2017) }, (_, i) => currentYear - i);
  const years = (availableYears && availableYears.length > 0)
    ? [...availableYears].sort((a, b) => b - a)
    : defaultYears;
  const allOptions = [...years, ARCHIVE_YEAR];

  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="hidden sm:inline">{t('experience.season')}</span>
      <select className="ui-input" value={selectedYear} onChange={(event) => onSelectYear(Number(event.target.value))} aria-label={t('experience.season')}>
        {allOptions.map((year) => <option key={year} value={year}>{year === ARCHIVE_YEAR ? t('ui.archive') : year}</option>)}
      </select>
    </label>
  );
}

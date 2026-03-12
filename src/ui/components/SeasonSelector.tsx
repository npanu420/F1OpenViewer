import { motion } from 'framer-motion';
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
  const defaultYears = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018];
  const years = (availableYears && availableYears.length > 0)
    ? [...availableYears].sort((a, b) => b - a)
    : defaultYears;
  const allOptions = [...years, ARCHIVE_YEAR];

  return (
    <div className="flex items-center gap-1">
      {allOptions.map((year) => {
        const isArchive = year === ARCHIVE_YEAR;
        const label = isArchive ? t('ui.archive') : String(year);
        const isSelected = selectedYear === year;

        return (
          <motion.button
            key={year}
            onClick={() => onSelectYear(year)}
            className={`relative px-3 py-1.5 font-heading text-xs font-bold tracking-wider transition-colors rounded whitespace-nowrap ${
              isSelected
                ? 'text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            } ${isArchive ? 'italic' : ''}`}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            {isSelected && (
              <motion.div
                layoutId="season-indicator"
                className="absolute inset-0 bg-primary rounded glow-red"
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
            <span className="relative z-10">{label}</span>
          </motion.button>
        );
      })}
    </div>
  );
}

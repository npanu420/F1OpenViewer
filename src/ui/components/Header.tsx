import { motion } from 'framer-motion';
import { Settings } from 'lucide-react';
import { useLocale } from '../../i18n/LocaleContext';
import { SeasonSelector } from './SeasonSelector';

interface HeaderProps {
  selectedYear: number;
  onSelectYear: (year: number) => void;
  onSettingsClick?: () => void;
  brandLabel?: string;
  subtitle?: string;
  availableYears?: number[];
  hasLive?: boolean;
}

export function Header({
  selectedYear,
  onSelectYear,
  onSettingsClick,
  brandLabel = 'F1 OPEN VIEWER',
  subtitle = 'RACE CONTROL',
  availableYears,
  hasLive = false,
}: HeaderProps) {
  const { t } = useLocale();

  return (
    <header className="border-b border-border/50 glass-panel sticky top-0 z-50">
      <div className="max-w-[1600px] 2xl:max-w-[94vw] mx-auto px-4 sm:px-6 h-14 flex items-center gap-4">
        <motion.div
          className="flex items-center gap-2.5"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
        >
          <img
            src={`${import.meta.env.BASE_URL}app-icon.png`}
            alt=""
            className="w-8 h-8 rounded object-contain"
          />
          <div className="hidden sm:block">
            <h1 className="text-base font-heading font-bold tracking-wider leading-none">
              {brandLabel}
            </h1>
            <p className="text-[10px] text-muted-foreground tracking-[0.2em] font-heading">
              {subtitle}
            </p>
          </div>
        </motion.div>

        <div className="w-px h-6 bg-border hidden sm:block" />

        <div className="flex-1 min-w-0 overflow-x-auto scrollbar-hide">
          <SeasonSelector
            selectedYear={selectedYear}
            onSelectYear={onSelectYear}
            availableYears={availableYears}
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden lg:flex items-center gap-2 mr-1">
            <div className="relative flex items-center justify-center">
              <span className="relative flex h-3 w-3">
                {hasLive ? (
                  <>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-70" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-primary" />
                  </>
                ) : (
                  <span className="inline-flex h-3 w-3 rounded-full bg-muted-foreground/40" />
                )}
              </span>
            </div>
            <span
              className={`text-[10px] font-heading tracking-[0.25em] ${
                hasLive ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              {hasLive ? t('header.live') : t('header.offline')}
            </span>
          </div>
          <motion.button
            onClick={onSettingsClick}
            className="w-9 h-9 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            title={t('header.settingsTitle')}
          >
            <Settings className="w-4.5 h-4.5" />
          </motion.button>
        </div>
      </div>
    </header>
  );
}

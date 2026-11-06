import { motion } from 'framer-motion';
import { ChevronRight, Flag } from 'lucide-react';
import type { CatalogItem } from '../../domain/catalog';
import type { VodEvent } from '../../domain/vod';
import { useLocale } from '../../i18n/LocaleContext';
import { getFlag, getEventCountryCode } from '../../lib/flags';

interface DashboardHeroProps {
  liveItem?: CatalogItem;
  latestEvent?: VodEvent;
  loading: boolean;
  onWatchLive: (item: CatalogItem) => void;
  onWatchLatest: (event: VodEvent) => void;
}

export function DashboardHero({ liveItem, latestEvent, loading, onWatchLive, onWatchLatest }: DashboardHeroProps) {
  const { t } = useLocale();

  if (!liveItem && !latestEvent) {
    if (!loading) return null;
    return (
      <div className="mb-5 h-24 rounded-lg bg-card border border-border animate-pulse" />
    );
  }

  const isLive = !!liveItem;
  const flag = isLive
    ? ''
    : getFlag(getEventCountryCode(latestEvent!));
  const title = isLive ? liveItem!.title : latestEvent!.meetingName;
  const roundLabel = !isLive && latestEvent!.meetingNumber
    ? `R${String(latestEvent!.meetingNumber).padStart(2, '0')}`
    : undefined;

  return (
    <motion.section
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      className={`mb-5 rounded-lg overflow-hidden ${
        isLive ? 'glass-panel border-primary/40' : 'glass-panel'
      }`}
    >
      <div
        className={`flex items-center gap-4 px-5 py-4 ${isLive ? 'bg-red-500/5' : ''}`}
      >
        <span className="text-3xl leading-none shrink-0" aria-hidden>{isLive ? <Flag className="w-7 h-7 text-red-400" /> : flag}</span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {isLive ? (
              <span className="relative flex items-center gap-1.5">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                </span>
                <span className="font-heading font-bold text-red-400 tracking-widest text-xs">
                  {t('dashboard.liveBadge')}
                </span>
              </span>
            ) : (
              <span className="font-heading font-bold text-muted-foreground tracking-widest text-xs">
                {t('dashboard.heroLatestLabel')}
              </span>
            )}
            {roundLabel && (
              <span className="font-heading font-bold text-muted-foreground tracking-widest text-xs">
                {roundLabel}
              </span>
            )}
          </div>
          <h2 className="font-heading text-lg font-bold tracking-wide break-words">{title}</h2>
        </div>

        <button
          type="button"
          onClick={() => (isLive ? onWatchLive(liveItem!) : onWatchLatest(latestEvent!))}
          className="ui-button ui-primary shrink-0"
        >
          {t('dashboard.heroWatchCta')}
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </motion.section>
  );
}

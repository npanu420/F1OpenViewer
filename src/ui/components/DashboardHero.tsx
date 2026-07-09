import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import type { CatalogItem } from '../../domain/catalog';
import type { VodEvent } from '../../domain/vod';
import { useLocale } from '../../i18n/LocaleContext';
import { getFlag, getCountryCodeFromMeetingKey } from '../../lib/flags';

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
      <div className="mb-8 h-24 rounded-lg bg-card border border-border animate-pulse" />
    );
  }

  const isLive = !!liveItem;
  const flag = isLive
    ? '🏁'
    : getFlag(getCountryCodeFromMeetingKey(latestEvent!.meetingKey));
  const title = isLive ? liveItem!.title : latestEvent!.meetingName;
  const roundLabel = !isLive && latestEvent!.meetingNumber
    ? `R${String(latestEvent!.meetingNumber).padStart(2, '0')}`
    : undefined;

  return (
    <motion.section
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`mb-8 rounded-lg overflow-hidden ${
        isLive ? 'glass-panel border-primary/40' : 'glass-panel'
      }`}
    >
      <div
        className={`flex items-center gap-4 px-5 py-5 ${isLive ? 'bg-primary/5' : ''}`}
      >
        <span className="text-3xl leading-none shrink-0">{flag}</span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {isLive ? (
              <span className="relative flex items-center gap-1.5">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
                </span>
                <span className="font-heading font-bold text-primary tracking-widest text-xs">
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
          <h2 className="font-heading text-xl font-bold tracking-wide truncate">{title}</h2>
        </div>

        <button
          type="button"
          onClick={() => (isLive ? onWatchLive(liveItem!) : onWatchLatest(latestEvent!))}
          className={`shrink-0 flex items-center gap-1.5 py-2.5 px-5 rounded-lg font-heading text-sm font-bold tracking-wider transition-opacity hover:opacity-90 ${
            isLive
              ? 'bg-primary text-primary-foreground border border-primary glow-red'
              : 'bg-accent/40 border border-border hover:bg-accent/60'
          }`}
        >
          {t('dashboard.heroWatchCta')}
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </motion.section>
  );
}

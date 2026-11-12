import { ChevronRight, Flag } from 'lucide-react';
import type { CatalogItem } from '../../domain/catalog';
import type { VodEvent } from '../../domain/vod';
import { useLocale } from '../../i18n/LocaleContext';
import { getEventCountryCode } from '../../lib/flags';
import { CountryBadge } from './CountryBadge';

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
  const title = isLive ? liveItem!.title : latestEvent!.meetingName;
  const roundLabel = !isLive && latestEvent!.meetingNumber
    ? `R${String(latestEvent!.meetingNumber).padStart(2, '0')}`
    : undefined;

  return (
    <section
      className={`mb-5 rounded-lg overflow-hidden ${
        isLive ? 'glass-panel border-primary/40' : 'glass-panel'
      }`}
    >
      <div
        className={`flex items-center gap-4 px-5 py-4 ${isLive ? 'bg-red-500/5' : ''}`}
      >
        {isLive ? (
          <Flag className="w-6 h-6 text-red-400 shrink-0" aria-hidden />
        ) : (
          <CountryBadge code={getEventCountryCode(latestEvent!)} isTest={latestEvent!.isTest} size="lg" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {isLive ? (
              <span className="relative flex items-center gap-1.5">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                </span>
                <span className="font-semibold text-red-400 text-xs">
                  {t('dashboard.liveBadge')}
                </span>
              </span>
            ) : (
              <span className="font-medium text-muted-foreground text-xs">
                {t('dashboard.heroLatestLabel')}
              </span>
            )}
            {roundLabel && (
              <span className="font-medium text-muted-foreground text-xs tabular-nums">
                {roundLabel}
              </span>
            )}
          </div>
          <h2 className="text-lg break-words">{title}</h2>
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
    </section>
  );
}

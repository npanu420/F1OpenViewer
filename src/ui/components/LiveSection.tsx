import { motion } from 'framer-motion';
import { Monitor } from 'lucide-react';
import type { CatalogItem } from '@/domain/catalog';
import { useLocale } from '../../i18n/LocaleContext';
import { StreamPanel } from './StreamPanel';

interface LiveSectionProps {
  items: CatalogItem[];
  onOpen: (item: CatalogItem) => void;
  loading?: boolean;
}

export function LiveSection({ items, onOpen, loading }: LiveSectionProps) {
  const { t } = useLocale();
  if (items.length === 0 && !loading) return null;

  const contentCountText =
    items.length === 1
      ? t('dashboard.liveContentCountOne')
      : t('dashboard.liveContentCountMany').replace('{count}', String(items.length));

  return (
    <motion.section
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-8"
    >
      <div className="glass-panel rounded-lg border-primary/30 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50 bg-primary/5">
          <div className="relative flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-primary" />
            </span>
            <span className="font-heading font-bold text-primary tracking-widest text-sm">
              {t('dashboard.liveBadge')}
            </span>
          </div>
          <div className="w-px h-5 bg-border" />
          <span className="font-heading font-bold text-sm tracking-wider">
            {contentCountText}
          </span>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <h4 className="font-heading text-xs text-muted-foreground tracking-widest mb-2 flex items-center gap-2">
              <Monitor className="w-3.5 h-3.5 text-primary" />
              {t('dashboard.liveSectionHeading').toUpperCase()}
            </h4>
            {loading ? (
              <div className="h-24 rounded-md bg-card border border-border animate-pulse" />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {items.map((item, i) => (
                  <StreamPanel
                    key={item.id}
                    label={item.title}
                    type="main"
                    index={i}
                    onClick={() => onOpen(item)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.section>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronLeft, ChevronRight, MonitorPlay } from 'lucide-react';
import { useLocale } from '../../i18n/LocaleContext';
import { getDriverInitials, getTeamColor } from '../../lib/teamColors';
import { getDriverHeadshotUrl, prefetchDriverHeadshots } from '../../services/driverHeadshots';
import { DRIVER_SHELF_DRAG_TYPE, type StreamOption } from './ResizableStreamGrid';

function ShelfCard({
  option,
  assigned,
  playing,
  picking,
  onPick,
  groupStart,
}: {
  option: StreamOption;
  assigned: boolean;
  playing: boolean;
  picking: boolean;
  onPick: () => void;
  /** First card in a new team group; bit of left margin. */
  groupStart?: boolean;
}) {
  const [headshotUrl, setHeadshotUrl] = useState<string | null>(null);
  const teamColor = getTeamColor(option.teamName);

  useEffect(() => {
    let cancelled = false;
    if (option.type === 'driver' && option.driverNumber != null) {
      getDriverHeadshotUrl(option.driverNumber, option.driverName || option.label).then((url) => {
        if (!cancelled) setHeadshotUrl(url);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [option.type, option.driverNumber, option.driverName, option.label]);

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRIVER_SHELF_DRAG_TYPE, option.item.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={onPick}
      className={`relative shrink-0 snap-start w-20 select-none cursor-grab active:cursor-grabbing rounded-lg border overflow-hidden transition-[colors,transform] hover:-translate-y-0.5 ${
        groupStart ? 'ml-2.5' : ''
      } ${
        picking
          ? 'border-primary ring-2 ring-primary/50'
          : playing
            ? 'border-primary/50'
            : 'border-border/60 hover:border-border'
      } bg-card`}
      title={option.label}
    >
      {teamColor && (
        <div className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: `hsl(${teamColor})` }} />
      )}

      <div className="flex flex-col items-center pt-2.5 pb-1.5 px-1.5">
        <div className="w-10 h-10 rounded-full overflow-hidden bg-accent/50 flex items-center justify-center text-xs font-heading font-bold text-muted-foreground">
          {headshotUrl ? (
            <img
              src={headshotUrl}
              alt=""
              className="w-full h-full object-cover"
              onError={() => setHeadshotUrl(null)}
            />
          ) : option.type === 'main' ? (
            <MonitorPlay className="w-4.5 h-4.5" />
          ) : (
            getDriverInitials(option.label, option.driverNumber)
          )}
        </div>
        <span className="mt-1 text-[10px] font-heading font-bold truncate max-w-full">
          {option.driverNumber != null ? `#${option.driverNumber}` : option.label}
        </span>
      </div>

      {playing && (
        <span className="absolute top-1 right-1 flex h-2 w-2 rounded-full bg-primary animate-pulse" />
      )}
      {assigned && !playing && (
        <span className="absolute top-1 right-1 flex items-center justify-center h-3.5 w-3.5 rounded-full bg-emerald-500/90">
          <Check className="w-2.5 h-2.5 text-white" />
        </span>
      )}
    </div>
  );
}

function ShelfScrollRow({ children }: { children: ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const updateEdges = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({
      left: el.scrollLeft > 2,
      right: max > 2 && el.scrollLeft < max - 2,
    });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateEdges();
    const ro = new ResizeObserver(updateEdges);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    el.addEventListener('scroll', updateEdges, { passive: true });
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (e.deltaY === 0) return;
      e.preventDefault();
      el.scrollBy({ left: e.deltaY, behavior: 'auto' });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', updateEdges);
      el.removeEventListener('wheel', onWheel);
    };
  }, [updateEdges, children]);

  const scrollBy = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const step = Math.max(160, Math.round(el.clientWidth * 0.72));
    el.scrollBy({ left: direction === 'left' ? -step : step, behavior: 'smooth' });
  };

  const edgeBtn =
    'pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-border/70 bg-background/90 text-muted-foreground shadow-md backdrop-blur-sm transition-all hover:border-primary/40 hover:bg-accent/80 hover:text-foreground hover:scale-105 active:scale-95';

  return (
    <div className="relative min-w-0 w-full group/shelf">
      <div
        ref={scrollRef}
        className="flex min-w-0 items-center gap-2 overflow-x-auto overflow-y-hidden pb-1 scroll-smooth snap-x snap-mandatory scrollbar-hide touch-pan-x"
      >
        {children}
      </div>

      <AnimatePresence>
        {edges.left && (
          <motion.div
            key="shelf-left"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="pointer-events-none absolute inset-y-0 left-0 z-10 flex w-12 items-center justify-start bg-gradient-to-r from-background via-background/85 to-transparent pl-0.5"
          >
            <button
              type="button"
              aria-label="Scroll drivers left"
              onClick={() => scrollBy('left')}
              className={`${edgeBtn} opacity-90 group-hover/shelf:opacity-100`}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {edges.right && (
          <motion.div
            key="shelf-right"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="pointer-events-none absolute inset-y-0 right-0 z-10 flex w-12 items-center justify-end bg-gradient-to-l from-background via-background/85 to-transparent pr-0.5"
          >
            <button
              type="button"
              aria-label="Scroll drivers right"
              onClick={() => scrollBy('right')}
              className={`${edgeBtn} opacity-90 group-hover/shelf:opacity-100`}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface DriverShelfProps {
  streamOptions: StreamOption[];
  assignedItemIds: Set<string>;
  playingItemIds: Set<string>;
  pickingItemId: string | null;
  onPickCard: (itemId: string | null) => void;
}

/** Main + data first, then onboards grouped by team. */
function orderShelfOptions(streamOptions: StreamOption[]): StreamOption[] {
  const nonDriver = streamOptions.filter((o) => o.type !== 'driver');
  const drivers = streamOptions.filter((o) => o.type === 'driver');
  const sorted = [...drivers].sort((a, b) => (a.teamName || '￿').localeCompare(b.teamName || '￿'));
  return [...nonDriver, ...sorted];
}

export function DriverShelf({ streamOptions, assignedItemIds, playingItemIds, pickingItemId, onPickCard }: DriverShelfProps) {
  const { t } = useLocale();
  const ordered = useMemo(() => orderShelfOptions(streamOptions), [streamOptions]);

  useEffect(() => {
    const hasDrivers = streamOptions.some((o) => o.type === 'driver' && o.driverNumber != null);
    if (hasDrivers) prefetchDriverHeadshots().catch(() => {});
  }, [streamOptions]);

  if (streamOptions.length === 0) return null;

  return (
    <div className="min-w-0 w-full space-y-1.5">
      <ShelfScrollRow>
        {ordered.map((option, i) => (
          <ShelfCard
            key={option.item.id}
            option={option}
            assigned={assignedItemIds.has(option.item.id)}
            playing={playingItemIds.has(option.item.id)}
            picking={pickingItemId === option.item.id}
            onPick={() => onPickCard(pickingItemId === option.item.id ? null : option.item.id)}
            groupStart={option.type === 'driver' && i > 0 && ordered[i - 1].teamName !== option.teamName}
          />
        ))}
      </ShelfScrollRow>
      {pickingItemId && (
        <p className="text-xs text-primary font-heading tracking-wide">{t('dashboard.shelfPickingHint')}</p>
      )}
    </div>
  );
}

import React, { useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { Flag, Radio, Zap, MessageSquare, Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import type { VodSession, SessionType } from '../../domain/vod';
import {
  groupSessionTabs,
  groupBySeries,
  STAGE_LABELS,
  VARIANT_LABELS,
  type StageKey,
  type SessionVariant,
} from '../../domain/sessionGrouping';

const sessionIcons: Record<string, React.ElementType> = {
  race: Flag,
  qualifying: Clock,
  practice: Clock,
  sprint: Zap,
  show: MessageSquare,
  other: MessageSquare,
  onboard: Radio,
};

const stageIcons: Record<StageKey, React.ElementType> = {
  fp1: Clock,
  fp2: Clock,
  fp3: Clock,
  'sprint-quali': Zap,
  sprint: Zap,
  qualifying: Clock,
  race: Flag,
};

const VARIANT_ORDER: SessionVariant[] = ['session', 'pre-show', 'post-show', 'kids'];

interface SessionTabItem {
  id: string;
  type: SessionType;
  label: string;
  series?: string;
}

interface SessionTabsProps {
  sessions: SessionTabItem[];
  activeSessionId: string;
  onSelectSession: (sessionId: string) => void;
}

export function sessionToTabItem(s: VodSession): SessionTabItem {
  return {
    id: `session-${s.contentId}-${s.channelId ?? 0}`,
    type: s.type,
    label: s.title || s.type,
    series: s.series,
  };
}

function TabPill({
  active,
  layoutId,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  layoutId: string;
  icon: React.ElementType;
  label: string;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      className={`relative flex items-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
        active ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
      }`}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      {active && (
        <motion.div
          layoutId={layoutId}
          className="absolute inset-0 bg-primary rounded-md"
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        />
      )}
      <Icon className="w-4 h-4 relative z-10" />
      <span className="relative z-10 font-heading tracking-wide">{label}</span>
    </motion.button>
  );
}

function CompactTab({
  active,
  layoutId,
  label,
  onClick,
}: {
  active: boolean;
  layoutId: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      className={`relative px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap transition-colors ${
        active
          ? 'text-primary-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
      }`}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
    >
      {active && <motion.div layoutId={layoutId} className="absolute inset-0 bg-primary/70 rounded" />}
      <span className="relative z-10">{label}</span>
    </motion.button>
  );
}

export function SessionTabs({ sessions, activeSessionId, onSelectSession }: SessionTabsProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const scrollBy = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const delta = direction === 'left' ? -320 : 320;
    el.scrollBy({ left: delta, behavior: 'smooth' });
  };

  const { f1, otherSeries } = useMemo(() => groupBySeries(sessions), [sessions]);
  const { stages, extras } = useMemo(() => groupSessionTabs(f1), [f1]);

  const activeSupportSeries = useMemo(() => {
    if (f1.some((s) => s.id === activeSessionId)) return null;
    return otherSeries.find((g) => g.items.some((s) => s.id === activeSessionId)) ?? null;
  }, [f1, otherSeries, activeSessionId]);

  const activeStage = useMemo(
    () => stages.find((s) => Object.values(s.variants).some((v) => v?.id === activeSessionId)),
    [stages, activeSessionId]
  );

  const activeStageVariants = activeStage
    ? VARIANT_ORDER.filter((v) => activeStage.variants[v])
    : [];

  const selectStage = (stageKey: StageKey) => {
    const stage = stages.find((s) => s.key === stageKey);
    if (!stage) return;
    const target = stage.variants.session ?? Object.values(stage.variants)[0];
    if (target) onSelectSession(target.id);
  };

  const selectF1Default = () => {
    const race = stages.find((s) => s.key === 'race');
    const target = race ? race.variants.session ?? Object.values(race.variants)[0] : f1[0];
    if (target) onSelectSession(target.id);
  };

  return (
    <div className="flex flex-col gap-2 min-w-0">
      {otherSeries.length > 0 && (
        <div className="flex items-center gap-1 pl-1">
          <CompactTab
            active={!activeSupportSeries}
            layoutId="series-tab"
            label="F1"
            onClick={selectF1Default}
          />
          {otherSeries.map((group) => (
            <CompactTab
              key={group.label}
              active={activeSupportSeries?.label === group.label}
              layoutId="series-tab"
              label={group.label}
              onClick={() => onSelectSession(group.items[0].id)}
            />
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Scroll left"
          onClick={() => scrollBy('left')}
          className="hidden sm:flex items-center justify-center w-7 h-7 rounded-full border border-border bg-background/80 hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div
          ref={scrollRef}
          className="flex items-center gap-1 min-w-0 overflow-x-auto pb-1 scrollbar-hide"
        >
          {!activeSupportSeries &&
            stages.map((stage) => (
              <TabPill
                key={stage.key}
                active={stage.key === activeStage?.key}
                layoutId="stage-tab"
                icon={stageIcons[stage.key]}
                label={STAGE_LABELS[stage.key]}
                onClick={() => selectStage(stage.key)}
              />
            ))}
          {!activeSupportSeries &&
            extras.map((session) => {
              const Icon = sessionIcons[session.type] || Radio;
              return (
                <TabPill
                  key={session.id}
                  active={session.id === activeSessionId}
                  layoutId="stage-tab"
                  icon={Icon}
                  label={session.label}
                  onClick={() => onSelectSession(session.id)}
                />
              );
            })}
          {activeSupportSeries &&
            activeSupportSeries.items.map((session) => {
              const Icon = sessionIcons[session.type] || Radio;
              return (
                <TabPill
                  key={session.id}
                  active={session.id === activeSessionId}
                  layoutId="stage-tab"
                  icon={Icon}
                  label={session.label}
                  onClick={() => onSelectSession(session.id)}
                />
              );
            })}
        </div>
        <button
          type="button"
          aria-label="Scroll right"
          onClick={() => scrollBy('right')}
          className="hidden sm:flex items-center justify-center w-7 h-7 rounded-full border border-border bg-background/80 hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {!activeSupportSeries && activeStage && activeStageVariants.length > 1 && (
        <div className="flex items-center gap-1 pl-1">
          {activeStageVariants.map((variant) => {
            const item = activeStage.variants[variant]!;
            return (
              <CompactTab
                key={item.id}
                active={item.id === activeSessionId}
                layoutId="variant-tab"
                label={VARIANT_LABELS[variant]}
                onClick={() => onSelectSession(item.id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

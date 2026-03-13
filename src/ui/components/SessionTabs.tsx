import React, { useRef } from 'react';
import { motion } from 'framer-motion';
import { Flag, Radio, Zap, MessageSquare, Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import type { VodSession, SessionType } from '../../domain/vod';

const sessionIcons: Record<string, React.ElementType> = {
  race: Flag,
  qualifying: Clock,
  practice: Clock,
  sprint: Zap,
  show: MessageSquare,
  other: MessageSquare,
  onboard: Radio,
};

interface SessionTabItem {
  id: string;
  type: SessionType;
  label: string;
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
  };
}

export function SessionTabs({ sessions, activeSessionId, onSelectSession }: SessionTabsProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const scrollBy = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const delta = direction === 'left' ? -320 : 320;
    el.scrollBy({ left: delta, behavior: 'smooth' });
  };

  return (
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
        {sessions.map((session) => {
          const Icon = sessionIcons[session.type] || Radio;
          const isActive = session.id === activeSessionId;

          return (
            <motion.button
              key={session.id}
              onClick={() => onSelectSession(session.id)}
              className={`relative flex items-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
                isActive
                  ? 'text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              }`}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {isActive && (
                <motion.div
                  layoutId="session-tab"
                  className="absolute inset-0 bg-primary rounded-md"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <Icon className="w-4 h-4 relative z-10" />
              <span className="relative z-10 font-heading tracking-wide">{session.label}</span>
            </motion.button>
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
  );
}

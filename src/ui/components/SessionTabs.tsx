import { motion } from 'framer-motion';
import { Flag, Radio, Zap, MessageSquare, Clock } from 'lucide-react';
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
  return (
    <div className="flex items-center gap-1 min-w-0 overflow-x-auto pb-1 scrollbar-hide">
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
  );
}

import { motion } from 'framer-motion';
import { Calendar, MapPin, ChevronRight } from 'lucide-react';
import type { VodEvent } from '../../domain/vod';
import { getFlag, getCountryCodeFromMeetingKey } from '@/lib/flags';

interface RaceCardProps {
  event: VodEvent;
  onClick: () => void;
  index: number;
  /** Optional circuit/location text */
  circuit?: string;
}

export function RaceCard({ event, onClick, index, circuit }: RaceCardProps) {
  const countryCode = getCountryCodeFromMeetingKey(event.meetingKey);
  const flag = countryCode ? getFlag(countryCode) : '🏁';

  return (
    <motion.button
      onClick={onClick}
      className="w-full text-left glass-panel rounded-lg p-4 group hover:border-primary/40 transition-all duration-300 relative overflow-hidden"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03, duration: 0.4 }}
      whileHover={{ y: -2 }}
    >
      <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-primary/0 to-transparent group-hover:via-primary transition-all duration-500" />

      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg leading-none">{flag}</span>
            <span className="text-xs font-heading font-bold text-primary tracking-widest">
              R{String(event.meetingNumber || index + 1).padStart(2, '0')}
            </span>
          </div>
          <h3 className="font-heading text-sm font-bold text-foreground truncate group-hover:text-primary transition-colors">
            {event.meetingName}
          </h3>
          {circuit && (
            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {circuit}
              </span>
            </div>
          )}
          {event.country && (
            <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
              <Calendar className="w-3 h-3" />
              {event.country}
            </div>
          )}
        </div>
        <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors shrink-0 mt-1" />
      </div>
    </motion.button>
  );
}

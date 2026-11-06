import { motion } from 'framer-motion';
import { Calendar, MapPin, ChevronRight, Wrench, Flag } from 'lucide-react';
import type { VodEvent } from '../../domain/vod';
import { getFlag, getEventCountryCode } from '@/lib/flags';

interface RaceCardProps {
  event: VodEvent;
  onClick: () => void;
  index: number;
  /** Optional circuit/location text */
  circuit?: string;
}

export function RaceCard({ event, onClick, index, circuit }: RaceCardProps) {
  const countryCode = getEventCountryCode(event);
  const flag = countryCode ? getFlag(countryCode) : '';

  return (
    <motion.button
      onClick={onClick}
      className="race-card w-full text-left bg-card rounded-lg p-5 group hover:bg-accent transition-colors relative overflow-hidden"

    >


      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {event.isTest ? (
              <Wrench className="w-4 h-4 text-muted-foreground" />
            ) : (
              <span className="text-lg leading-none" aria-hidden>{flag || <Flag className="w-4 h-4" />}</span>
            )}
            <span className="text-xs font-heading font-bold text-muted-foreground tracking-widest">
              {event.isTest ? 'TEST' : `R${String(event.meetingNumber || index + 1).padStart(2, '0')}`}
            </span>
          </div>
          <h3 className="font-heading text-base font-medium text-foreground line-clamp-2 group-hover:text-foreground transition-colors">
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
        <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors shrink-0 mt-1" />
      </div>
    </motion.button>
  );
}

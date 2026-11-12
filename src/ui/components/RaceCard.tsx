import { MapPin, ChevronRight } from 'lucide-react';
import type { VodEvent } from '../../domain/vod';
import { getEventCountryCode } from '@/lib/flags';
import { CountryBadge } from './CountryBadge';

interface RaceCardProps {
  event: VodEvent;
  onClick: () => void;
  index: number;
  /** Optional circuit/location text */
  circuit?: string;
}

export function RaceCard({ event, onClick, index, circuit }: RaceCardProps) {
  const countryCode = getEventCountryCode(event);

  return (
    <button
      type="button"
      onClick={onClick}
      className="race-card w-full text-left group"
      style={{ animationDelay: `${Math.min(index, 14) * 25}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <CountryBadge code={countryCode} isTest={event.isTest} />
            <span className="text-xs font-medium text-muted-foreground tabular-nums">
              {event.isTest ? 'TEST' : `R${String(event.meetingNumber || index + 1).padStart(2, '0')}`}
            </span>
          </div>
          <h3 className="text-base font-medium text-foreground line-clamp-2">
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
            <div className="mt-1 text-xs text-muted-foreground">{event.country}</div>
          )}
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-[color,transform] shrink-0 mt-1" aria-hidden />
      </div>
    </button>
  );
}

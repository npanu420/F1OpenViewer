import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Check, ChevronDown, MonitorPlay, Star } from 'lucide-react';
import { useLocale } from '../../i18n/LocaleContext';
import { getTeamColor } from '../../lib/teamColors';
import { favoriteDriverKey, toggleFavoriteDriver, useFavoriteDrivers } from '../../services/favoriteDrivers';
import type { StreamOption } from './ResizableStreamGrid';

interface StreamPickerProps {
  streamOptions: StreamOption[];
  shownItemIds: Set<string>;
  playingItemIds: Set<string>;
  onToggle: (itemId: string) => void;
}

/** Checklist of every feed of the session: one click adds a stream to the grid or takes it out. */
export function StreamPicker({ streamOptions, shownItemIds, playingItemIds, onToggle }: StreamPickerProps) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const favorites = useFavoriteDrivers();
  const rank = useMemo(() => new Map(favorites.map((name, index) => [favoriteDriverKey(name), index])), [favorites]);
  const rankOf = (o: StreamOption) => rank.get(favoriteDriverKey(o.driverName || o.label));

  const feeds = streamOptions.filter((o) => o.type !== 'driver');
  const drivers = streamOptions.filter((o) => o.type === 'driver');
  // Favourites first, then grouped by team.
  const onboards = [
    ...drivers.filter((o) => rankOf(o) != null).sort((a, b) => rankOf(a)! - rankOf(b)!),
    ...drivers.filter((o) => rankOf(o) == null).sort((a, b) => (a.teamName || '￿').localeCompare(b.teamName || '￿')),
  ];
  const shownCount = streamOptions.filter((o) => shownItemIds.has(o.item.id)).length;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      rootRef.current?.querySelector('button')?.focus();
    };
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const row = (option: StreamOption) => {
    const shown = shownItemIds.has(option.item.id);
    const playing = playingItemIds.has(option.item.id);
    const isDriver = option.type === 'driver';
    const name = option.driverName || option.label;
    const favorite = isDriver && rankOf(option) != null;
    const teamColor = isDriver ? getTeamColor(option.teamName) : null;
    // The last panel cannot be removed.
    const locked = shown && shownCount <= 1;
    return (
      <li key={option.item.id} className="stream-picker-row" data-shown={shown ? 'true' : undefined}>
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={shown}
          disabled={locked}
          className="stream-picker-item"
          onClick={() => onToggle(option.item.id)}
        >
          <span className="stream-picker-check" aria-hidden>{shown && <Check className="w-3 h-3" />}</span>
          {isDriver ? (
            <>
              <span className="stream-picker-team" style={teamColor ? { backgroundColor: `hsl(${teamColor})` } : undefined} aria-hidden />
              {option.driverNumber != null && <span className="w-6 shrink-0 text-xs tabular-nums text-muted-foreground">{option.driverNumber}</span>}
            </>
          ) : option.type === 'main' ? (
            <MonitorPlay className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <BarChart3 className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate text-left">{name}</span>
          {playing && <span className="stream-picker-live" title={t('experience.playing')} aria-label={t('experience.playing')} />}
        </button>
        {isDriver && (
          <button
            type="button"
            aria-pressed={favorite}
            aria-label={`${favorite ? t('experience.unfavorite') : t('experience.favorite')}: ${name}`}
            title={favorite ? t('experience.unfavorite') : t('experience.favorite')}
            className={`stream-picker-star ${favorite ? 'is-favorite' : ''}`}
            onClick={() => toggleFavoriteDriver(name)}
          >
            <Star className="w-3.5 h-3.5" fill={favorite ? 'currentColor' : 'none'} aria-hidden />
          </button>
        )}
      </li>
    );
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button type="button" className="ui-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {t('experience.streams')}
        <span className="text-muted-foreground tabular-nums">{shownCount}/{streamOptions.length}</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="stream-picker thin-scrollbar" role="menu" aria-label={t('experience.streams')}>
          <p className="stream-picker-hint">{t('experience.streamsHint')}</p>
          <h3 className="stream-picker-heading">{t('experience.feeds')}</h3>
          <ul className="stream-picker-list">{feeds.map(row)}</ul>
          {onboards.length > 0 && (
            <>
              <h3 className="stream-picker-heading">{t('experience.onboards')}</h3>
              <ul className="stream-picker-list">{onboards.map(row)}</ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

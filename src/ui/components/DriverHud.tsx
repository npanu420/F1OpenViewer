import React from 'react';
import type { DriverRow } from '../../domain/timing';
import { useLocale } from '../../i18n/LocaleContext';
import { segColor, TYRE_COLOR, TYRE_LETTER } from './LiveTimingBody';

/** Label over value, the way timing screens stack "LAST" above a lap time. */
function Stat({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className={`driver-hud-stat ${className}`}>
      <span className="driver-hud-label">{label}</span>
      <span className="tabular-nums">{value || '—'}</span>
    </div>
  );
}

interface DriverHudProps {
  row: DriverRow;
  /** Extra control at the right end (the panel menu button). */
  children?: React.ReactNode;
}

/**
 * Strip of live data over an onboard: position, speed and gear, lap times, gaps, micro sectors and
 * tyre. It hides the less important parts as the tile gets narrower (container queries); the micro
 * sectors then move to a thin bar along the bottom edge. The tyre shows the strategy on hover.
 */
export const DriverHud = React.memo(function DriverHud({ row, children }: DriverHudProps) {
  const { t } = useLocale();
  const tyre = TYRE_COLOR[row.tyre] || '#888';
  const sectors = row.sectors.map((s) => s.segments).filter((list) => list.length > 0);
  // One group per sector, so the three sectors read apart.
  const microSectors = (className: string) => (
    <div className={className} aria-hidden>
      {sectors.map((list, sector) => (
        <span key={sector} className="driver-hud-sector">
          {list.map((status, index) => <span key={index} style={{ background: segColor(status) }} />)}
        </span>
      ))}
    </div>
  );
  const telemetry = row.speedKmh != null;
  // The leader's gap fields carry the lap number instead of a time.
  const gap = (value: string) => (/^lap/i.test(value.trim()) ? '' : value);
  return (
    <div className="driver-hud" data-retired={row.retired ? 'true' : undefined}>
      <div className="driver-hud-id" style={{ borderColor: row.teamColour }}>
        <span className="driver-hud-pos tabular-nums">{row.position}</span>
        <span className="driver-hud-tla">{row.tla}</span>
      </div>

      {row.retired ? <span className="driver-hud-chip driver-hud-chip-out">OUT</span>
        : row.inPit ? <span className="driver-hud-chip driver-hud-chip-pit">PIT</span>
        : row.pitOut ? <span className="driver-hud-chip driver-hud-chip-pitout">OUT LAP</span>
        : null}

      {telemetry && (
        <div className="driver-hud-car">
          <span className="driver-hud-gear tabular-nums" title={t('hud.gear')}>{row.gear && row.gear > 0 ? row.gear : 'N'}</span>
          <div className="driver-hud-speed">
            <span className="tabular-nums">{row.speedKmh}<span className="driver-hud-unit">km/h</span></span>
          </div>
          {/* Only when the data has a DRS channel: there is none in 2026. */}
          {row.hasDrs && <span className="driver-hud-drs" data-on={row.drs ? 'true' : undefined}>DRS</span>}
        </div>
      )}

      <div className="driver-hud-times hud-md">
        <Stat label={t('timing.colLast')} value={row.lastLap} />
        <Stat label={t('timing.colBest')} value={row.bestLap} />
      </div>
      <div className="driver-hud-times">
        <Stat label={t('timing.colInt')} value={gap(row.interval)} />
        <Stat label={t('hud.leader')} value={gap(row.gapToLeader)} className="hud-sm" />
      </div>

      {/* Takes the free width, so the tyre stays at the right edge with or without mini sectors. */}
      <div className="driver-hud-spacer" aria-hidden>
        {sectors.length > 0 && microSectors('driver-hud-segments hud-lg')}
      </div>

      <div className="driver-hud-tyre" tabIndex={0}>
        {row.tyre ? (
          <>
            <span className="driver-hud-compound" style={{ borderColor: tyre, color: tyre }}>{TYRE_LETTER[row.tyre] ?? row.tyre[0]}</span>
            <span className="tabular-nums">{row.stintLaps ?? ''}</span>
          </>
        ) : <span className="text-white/50">—</span>}
        {row.stints.length > 0 && (
          <div className="driver-hud-strategy" role="tooltip">
            <p className="driver-hud-label">{t(row.stints.length - 1 === 1 ? 'timing.pitStop' : 'timing.pitStops').replace('{count}', String(row.stints.length - 1))}</p>
            <ol>
              {row.stints.map((stint, index) => {
                const color = TYRE_COLOR[stint.compound] || '#888';
                return (
                  <li key={index}>
                    <span className="driver-hud-compound" style={{ borderColor: color, color }}>{TYRE_LETTER[stint.compound] ?? (stint.compound[0] || '?')}</span>
                    <span className="tabular-nums">{stint.laps != null ? t('timing.stintLaps').replace('{laps}', String(stint.laps)) : '—'}</span>
                    {stint.isNew && <span className="text-white/50">{t('timing.newTyre')}</span>}
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </div>
      {children}
      {/* Narrow tiles have no room for them in the row: the micro sectors run along the bottom edge instead. */}
      {sectors.length > 0 && microSectors('driver-hud-strip')}
    </div>
  );
});

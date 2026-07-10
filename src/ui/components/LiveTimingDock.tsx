import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { ReplayResolvingPanel, LiveTimingPanel } from './LiveTimingBody';
import { getDockWidth, setDockWidth, MIN_DOCK_WIDTH, MAX_DOCK_WIDTH, WIDE_DOCK_THRESHOLD } from '../../services/dockSettings';

/** Same fields as liveTiming.openWindow; one object works for dock or popout. */
export interface DockSessionQuery {
  live?: boolean;
  year?: number;
  meetingName?: string;
  meetingNumber?: number;
  sessionName?: string;
  sessionType?: string;
  sessionKey?: string | number;
  title?: string;
}

interface LiveTimingDockProps {
  query: DockSessionQuery;
  onClose: () => void;
  /** Standalone multiview has no app header; dock can use full height. */
  fullscreen?: boolean;
}

/** Max 60% of window width so video still fits. On ultrawide that can still be huge. */
function effectiveMaxWidth(): number {
  return Math.min(MAX_DOCK_WIDTH, Math.round(window.innerWidth * 0.6));
}

export function LiveTimingDock({ query, onClose, fullscreen }: LiveTimingDockProps) {
  const [width, setWidth] = useState(() => Math.min(getDockWidth(), effectiveMaxWidth()));
  const draggingRef = useRef(false);

  // Register with main process for livetiming IPC (no popout window).
  useEffect(() => {
    window.f1?.liveTiming?.dockRegister?.().catch(() => {});
    return () => {
      window.f1?.liveTiming?.dockUnregister?.().catch(() => {});
    };
  }, []);

  // Clamp again on resize.
  useEffect(() => {
    const onResize = () => setWidth((w) => Math.min(w, effectiveMaxWidth()));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const next = Math.max(MIN_DOCK_WIDTH, Math.min(effectiveMaxWidth(), window.innerWidth - ev.clientX));
      setWidth(next);
    };
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setWidth((w) => {
        setDockWidth(w);
        return w;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  // Wide dock gets interval/last lap; race control stays in the popout only.
  const compact = width < WIDE_DOCK_THRESHOLD;
  const dockWide = width >= WIDE_DOCK_THRESHOLD;
  const dockProps = { docked: true as const, dockWide };

  return (
    <div
      className={`relative shrink-0 glass-panel border-l border-border flex flex-col ${
        fullscreen ? 'h-full' : 'sticky top-14 h-[calc(100vh-3.5rem)]'
      }`}
      style={{ width }}
    >
      <div
        onMouseDown={onDragStart}
        title="Drag to resize"
        className="absolute left-0 top-0 bottom-0 w-1.5 -translate-x-1/2 cursor-ew-resize hover:bg-primary/40 transition-colors z-10"
      />
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50 shrink-0">
        <span className="font-heading text-xs font-bold tracking-widest text-muted-foreground uppercase">
          Live Timing
        </span>
        <button
          type="button"
          onClick={onClose}
          title="Close"
          aria-label="Close"
          className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 min-h-0">
        {query.live ? (
          <LiveTimingPanel
            compact={compact}
            {...dockProps}
            title={query.title || ''}
            query={{
              year: query.year,
              sessionKey: query.sessionKey,
              meetingName: query.meetingName,
              sessionName: query.sessionName,
            }}
          />
        ) : (
          <ReplayResolvingPanel
            compact={compact}
            {...dockProps}
            title={query.title || ''}
            query={{
              year: query.year ?? null,
              meetingName: query.meetingName,
              meetingNumber: query.meetingNumber,
              sessionName: query.sessionName,
              sessionType: query.sessionType,
              sessionKey: query.sessionKey != null ? String(query.sessionKey) : undefined,
            }}
          />
        )}
      </div>
    </div>
  );
}

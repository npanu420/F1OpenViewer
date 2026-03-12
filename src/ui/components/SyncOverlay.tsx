import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { useLocale } from '../../i18n/LocaleContext';

export type SyncStatus = 'idle' | 'syncing' | 'done' | 'error';

export interface SyncStreamInfo {
  id: string;
  label: string;
  /** offset in seconds from the reference stream (negative = behind, positive = ahead) */
  offset: number;
  /** playbackRate applied during correction */
  rate: number;
  /** whether this stream is the reference (no adjustment) */
  isReference: boolean;
  done: boolean;
}

interface SyncOverlayProps {
  isOpen: boolean;
  status: SyncStatus;
  streams: SyncStreamInfo[];
  onClose: () => void;
}

function StreamRow({ stream }: { stream: SyncStreamInfo }) {
  const { t } = useLocale();
  const offsetAbs = Math.abs(stream.offset);
  const direction = stream.offset > 0 ? 'avanti' : stream.offset < 0 ? 'indietro' : '';
  const rateLabel =
    stream.isReference
      ? '1.00×  (riferimento)'
      : stream.rate > 1
      ? `${stream.rate.toFixed(2)}×  ↑ velocizza`
      : stream.rate < 1
      ? `${stream.rate.toFixed(2)}×  ↓ rallenta`
      : '1.00×';

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors ${
        stream.isReference
          ? 'border-primary/30 bg-primary/5'
          : stream.done
          ? 'border-emerald-500/30 bg-emerald-500/5'
          : 'border-border/50 bg-card/50'
      }`}
    >
      <div className="shrink-0">
        {stream.isReference ? (
          <div className="w-2 h-2 rounded-full bg-primary" />
        ) : stream.done ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        ) : (
          <div className="w-2 h-2 rounded-full bg-muted-foreground animate-pulse" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-xs font-heading font-bold tracking-wider truncate text-foreground">
          {stream.label}
        </p>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {stream.isReference
            ? t('sync.noAdjustment')
            : offsetAbs < 0.05
            ? t('sync.synced')
            : `${offsetAbs.toFixed(2)}s ${direction}`}
        </p>
      </div>

      <div className="shrink-0 text-right">
        <span
          className={`text-[10px] font-heading font-bold tracking-wider px-2 py-0.5 rounded ${
            stream.isReference
              ? 'bg-primary/20 text-primary'
              : stream.rate > 1
              ? 'bg-sky-500/20 text-sky-400'
              : stream.rate < 1
              ? 'bg-amber-500/20 text-amber-400'
              : 'bg-muted/30 text-muted-foreground'
          }`}
        >
          {rateLabel}
        </span>
      </div>
    </div>
  );
}

export function SyncOverlay({
  isOpen,
  status,
  streams,
  onClose,
}: SyncOverlayProps) {
  const { t } = useLocale();
  const doneCount = streams.filter((s) => s.done).length;
  const totalCount = streams.length;
  const progress = totalCount > 0 ? doneCount / totalCount : 0;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-background/70 backdrop-blur-sm z-[60]"
            onClick={status !== 'syncing' ? onClose : undefined}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 20 }}
            transition={{ type: 'spring', stiffness: 350, damping: 28 }}
            className="fixed inset-0 flex items-center justify-center z-[61] pointer-events-none"
          >
            <div className="pointer-events-auto w-full max-w-lg glass-panel rounded-2xl overflow-hidden shadow-2xl">
              <div className="flex items-center gap-3 px-6 py-4 border-b border-border/50 bg-primary/5">
                <div className="relative flex items-center justify-center w-9 h-9">
                  {status === 'syncing' ? (
                    <>
                      <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-20 animate-ping" />
                      <Zap className="w-5 h-5 text-primary relative z-10" />
                    </>
                  ) : status === 'done' ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-destructive" />
                  )}
                </div>
                <div className="flex-1">
                  <h2 className="font-heading text-base font-bold tracking-wider text-foreground">
                    {status === 'syncing'
                      ? t('sync.inProgress')
                      : status === 'done'
                      ? t('sync.done')
                      : t('sync.error')}
                  </h2>
                  <p className="text-[11px] text-muted-foreground tracking-wide mt-0.5">
                    {status === 'syncing'
                      ? t('sync.inProgressDescription')
                      : status === 'done'
                      ? t('sync.doneDescription')
                      : t('sync.errorDescription')}
                  </p>
                </div>
                {status !== 'syncing' && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {status === 'syncing' && streams.length > 0 && (
                <div className="px-6 py-4 border-b border-border/30">
                  <div className="flex justify-between text-[10px] text-muted-foreground font-heading tracking-wider mb-1.5">
                    <span>{t('sync.progressLabel')}</span>
                    <span>
                      {t('sync.progressValue')
                        .replace('{done}', String(doneCount))
                        .replace('{total}', String(totalCount))}
                    </span>
                  </div>
                  <div className="h-1.5 bg-border rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-primary rounded-full"
                      style={{ width: `${progress * 100}%` }}
                      transition={{ duration: 0.15 }}
                    />
                  </div>
                </div>
              )}

              <div className="px-6 py-4 space-y-2 max-h-64 overflow-y-auto scrollbar-hide">
                {streams.map((s) => (
                  <StreamRow key={s.id} stream={s} />
                ))}
              </div>

              {status === 'done' && (
                <div className="px-6 pb-5 pt-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="w-full py-2.5 rounded-lg font-heading text-sm font-bold tracking-wider bg-primary text-primary-foreground border border-primary hover:opacity-90 transition-opacity"
                  >
                    Chiudi
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

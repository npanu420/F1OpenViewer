import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Monitor, Radio, BarChart3, Volume2, VolumeX, Play } from 'lucide-react';
import type { CatalogItem } from '../../domain/catalog';
import type { PlaybackInfo } from '../../services/entitlement';
import { useLocale } from '../../i18n/LocaleContext';
import { ShakaVideo, type ShakaVideoHandle } from '../widgets/ShakaVideo';

export type StreamPanelHandle = {
  getVideoElement: () => HTMLVideoElement | null;
};

interface StreamPanelProps {
  label: string;
  type: 'main' | 'driver' | 'data';
  driverNumber?: number;
  teamColor?: string;
  index?: number;
  onClick?: () => void;
  catalogItem?: CatalogItem;
  playback?: PlaybackInfo | null;
  loading?: boolean;
  accessToken?: string;
  onPlayEmbedded?: (item: CatalogItem) => void;
  onEmbedError?: (msg: string) => void;
  /** When true, panel fills container height (e.g. inside grid slot) */
  fillHeight?: boolean;
  /** When true, hide the header bar (label + volume) so content fills full height */
  hideHeader?: boolean;
}

export const StreamPanel = forwardRef<StreamPanelHandle, StreamPanelProps>(
  function StreamPanel(
    {
      label,
      type,
      driverNumber,
      teamColor,
      index = 0,
      onClick,
      catalogItem,
      playback,
      loading = false,
      accessToken,
      onPlayEmbedded,
      onEmbedError,
      fillHeight = false,
      hideHeader = false,
    },
    ref
  ) {
    const { t } = useLocale();
    const shakaRef = useRef<ShakaVideoHandle | null>(null);
    const [muted, setMuted] = useState(true);

    useImperativeHandle(ref, () => ({
      getVideoElement: () => shakaRef.current?.getVideoElement() ?? null,
    }));

    const borderColor = teamColor ? `hsl(${teamColor})` : undefined;
    const canEmbed = catalogItem && onPlayEmbedded;
    const showPlaceholder = !playback && !loading;

    function toggleMute() {
      const video = shakaRef.current?.getVideoElement();
      if (!video) return;
      const next = !video.muted;
      video.muted = next;
      setMuted(next);
    }

    return (
      <motion.div
        className={`stream-placeholder flex flex-col text-left overflow-hidden ${fillHeight ? 'flex-1 min-h-0' : ''}`}
        style={borderColor ? { borderColor, borderWidth: '1px' } : undefined}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: index * 0.04, duration: 0.3 }}
      >
        {/* Header bar — hidden when hideHeader (e.g. fullscreen with titles hidden) */}
        {!hideHeader && (
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/50 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {type === 'main' && <Monitor className="w-3.5 h-3.5 text-primary shrink-0" />}
            {type === 'driver' && (
              <Radio className="w-3.5 h-3.5 shrink-0" style={{ color: borderColor }} />
            )}
            {type === 'data' && (
              <BarChart3 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            )}
            <span className="text-xs font-heading font-bold tracking-wider uppercase truncate">
              {label}
            </span>
            {driverNumber != null && (
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0"
                style={
                  teamColor
                    ? { backgroundColor: `hsl(${teamColor} / 0.2)`, color: borderColor }
                    : undefined
                }
              >
                #{driverNumber}
              </span>
            )}
          </div>

          {/* Volume button — only active when stream is playing */}
          <button
            type="button"
            onClick={playback ? toggleMute : undefined}
            title={muted ? t('ui.audioOn') : t('ui.audioOff')}
            className={`shrink-0 w-6 h-6 flex items-center justify-center rounded transition-colors ${
              playback
                ? 'hover:bg-accent cursor-pointer text-muted-foreground hover:text-foreground'
                : 'cursor-default text-muted-foreground/30'
            }`}
          >
            {muted ? (
              <VolumeX className="w-3.5 h-3.5" />
            ) : (
              <Volume2 className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
        )}

        {/* Content area */}
        <div className={`flex-1 flex flex-col min-w-0 bg-black ${fillHeight ? 'min-h-0' : 'min-h-[120px]'}`}>
          {loading && (
            <div className={`flex-1 flex items-center justify-center carbon-texture ${fillHeight ? 'min-h-0' : ''}`}>
              <div className="text-center">
                <div className="w-10 h-10 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto mb-2" />
                <p className="text-[10px] text-muted-foreground font-heading tracking-wider">
                  {t('dashboard.loadingStream')}
                </p>
              </div>
            </div>
          )}

          {playback && (
            <div className="flex-1 min-h-0 flex flex-col">
              <ShakaVideo
                ref={shakaRef}
                manifestUrl={playback.manifestUrl}
                licenseUrl={playback.licenseUrl}
                licenseHeaders={playback.licenseHeaders}
                fallbackManifestUrl={playback.fallbackManifestUrl}
                fallbackLicenseUrl={playback.fallbackLicenseUrl}
                fallbackLicenseHeaders={playback.fallbackLicenseHeaders}
                accessToken={accessToken}
                onError={(msg) => onEmbedError?.(msg)}
                compact
              />
            </div>
          )}

          {showPlaceholder && (
            <div className={`flex-1 flex items-center justify-center carbon-texture ${fillHeight ? 'min-h-0' : 'min-h-[120px]'}`}>
              <div className="text-center px-2">
                {canEmbed ? (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPlayEmbedded!(catalogItem!);
                      }}
                      className="flex items-center justify-center w-10 h-10 rounded-full bg-primary text-primary-foreground mx-auto mb-2 hover:opacity-90 transition-opacity"
                      title={t('dashboard.playEmbedded')}
                    >
                      <Play className="w-5 h-5" />
                    </button>
                    <p className="text-[10px] text-muted-foreground font-heading tracking-wider">
                      {t('dashboard.playEmbedded')}
                    </p>
                    {onClick && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onClick();
                        }}
                        className="mt-1 text-[10px] text-primary hover:underline font-heading"
                      >
                        {t('dashboard.openInWindow')}
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    {onClick ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onClick();
                        }}
                        className="flex flex-col items-center justify-center w-full h-full min-h-[120px] cursor-pointer hover:bg-white/5 transition-colors rounded focus:outline-none focus:ring-2 focus:ring-primary/50"
                      >
                        <div className="w-10 h-10 rounded-full border border-border/50 flex items-center justify-center mx-auto mb-2">
                          {type === 'main' && <Monitor className="w-5 h-5 text-muted-foreground" />}
                          {type === 'driver' && <Radio className="w-5 h-5 text-muted-foreground" />}
                          {type === 'data' && <BarChart3 className="w-5 h-5 text-muted-foreground" />}
                        </div>
                        <p className="text-[10px] text-primary font-heading tracking-wider hover:underline">
                          {t('ui.clickToOpen')}
                        </p>
                      </button>
                    ) : (
                      <>
                        <div className="w-10 h-10 rounded-full border border-border/50 flex items-center justify-center mx-auto mb-2">
                          {type === 'main' && <Monitor className="w-5 h-5 text-muted-foreground" />}
                          {type === 'driver' && <Radio className="w-5 h-5 text-muted-foreground" />}
                          {type === 'data' && <BarChart3 className="w-5 h-5 text-muted-foreground" />}
                        </div>
                        <p className="text-[10px] text-muted-foreground font-heading tracking-wider">
                          {t('ui.stream')}
                        </p>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    );
  }
);

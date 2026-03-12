import React, { useEffect, useState } from 'react';
import type { CatalogItem } from '../../domain/catalog';
import { resolvePlayback } from '../../services/entitlement';
import { ShakaVideo } from '../widgets/ShakaVideo';
import { useLocale } from '../../i18n/LocaleContext';

type Props = {
  item: CatalogItem;
  accessToken?: string;
  onBack: () => void;
};

export function PlayerView({ item, accessToken, onBack }: Props) {
  const { t } = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [playback, setPlayback] = useState<{
    manifestUrl: string;
    licenseUrl: string;
    licenseHeaders?: Record<string, string>;
    streamType?: string;
    fallbackManifestUrl?: string;
    fallbackLicenseUrl?: string;
    fallbackLicenseHeaders?: Record<string, string>;
    fallbackStreamType?: string;
  } | null>(null);

  useEffect(() => {
    setError(null);
    setPlayback(null);
    resolvePlayback(item)
      .then(setPlayback)
      .catch((e) => setError(e instanceof Error ? e.message : t('player.errorStreamStart')));
  }, [item, t]);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: '0 0 6px' }}>{t('player.title')}</h2>
          <div className="kpi">
            <span>{t('player.content')}: <strong>{item.title}</strong></span>
          </div>
        </div>
        <button className="btn" onClick={onBack} type="button">
          {t('player.back')}
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {!playback ? (
        <div className="pill" style={{ justifySelf: 'start' }}>
          {t('player.preparingStream')}
        </div>
      ) : (
        <div className="playerWrap">
          <div style={{ minWidth: 0 }}>
            <ShakaVideo
              manifestUrl={playback.manifestUrl}
              licenseUrl={playback.licenseUrl}
              accessToken={accessToken}
              licenseHeaders={playback.licenseHeaders}
              fallbackManifestUrl={playback.fallbackManifestUrl}
              fallbackLicenseUrl={playback.fallbackLicenseUrl}
              fallbackLicenseHeaders={playback.fallbackLicenseHeaders}
              onError={setError}
            />
          </div>
          <div className="panel" style={{ alignSelf: 'start', minWidth: 0 }}>
            <div className="panelInner" style={{ display: 'grid', gap: 10 }}>
              <div className="pill">{t('player.streamInfo')}</div>
              <div className="mono">
                {`${t('player.manifest')}: ${playback.manifestUrl}\n`}
                {`${t('player.license')}: ${playback.licenseUrl || t('player.inline')}\n`}
                {`${t('player.stream')}: ${playback.streamType || t('player.na')}\n`}
                {`${t('player.fallback')}: ${playback.fallbackStreamType || t('player.na')}\n`}
                {`${t('player.drm')}: ${t('player.widevine')}`}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

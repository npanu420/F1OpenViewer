import React, { useEffect, useState } from 'react';
import type { CatalogItem } from '../../domain/catalog';
import { resolvePlayback } from '../../services/entitlement';
import { ShakaVideo } from '../widgets/ShakaVideo';

type Props = {
  item: CatalogItem;
  accessToken?: string;
  onBack: () => void;
};

export function PlayerView({ item, accessToken, onBack }: Props) {
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
      .catch((e) => setError(e instanceof Error ? e.message : 'Errore avvio stream.'));
  }, [item]);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: '0 0 6px' }}>Player</h2>
          <div className="kpi">
            <span>Contenuto: <strong>{item.title}</strong></span>
          </div>
        </div>
        <button className="btn" onClick={onBack} type="button">
          Indietro
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {!playback ? (
        <div className="pill" style={{ justifySelf: 'start' }}>
          Preparazione stream…
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
              <div className="pill">Info stream</div>
              <div className="mono">
                {`Manifest: ${playback.manifestUrl}\n`}
                {`License: ${playback.licenseUrl || '(inline)'}\n`}
                {`Stream: ${playback.streamType || 'n/a'}\n`}
                {`Fallback: ${playback.fallbackStreamType || 'n/a'}\n`}
                {`DRM: Widevine`}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

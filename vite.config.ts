import path from 'path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Content-Security-Policy for the packaged app (injected at build time only: the dev server needs
 * inline scripts for React Refresh). The windows run with relaxed web security so the F1 CDN/DRM
 * requests work, which makes a CSP the main barrier against injected script.
 *  - scripts: only our own bundle (no inline, no eval);
 *  - network: F1 (APIs/CDNs/license), OpenF1 and the local license proxy ports only;
 *  - media: blob: (MSE), data: (team-radio clips) and F1 hosts;
 *  - no plugins, frames, forms or <base>.
 */
// The windows run with webSecurity off (no CORS barrier), so the CSP is what keeps an injected
// script from posting data to an arbitrary host: network only to F1 (APIs, CDNs, license), OpenF1
// (driver headshots) and the local license proxy (ports 18765-18775, see licenseProxy.js; CSP has
// no port ranges, so they are listed).
const LICENSE_PROXY_ORIGINS = Array.from({ length: 11 }, (_, i) => `http://127.0.0.1:${18765 + i}`).join(' ');
// Live and some VOD manifests/segments are served from Akamai (e.g. f1prodlive.akamaized.net).
const F1_MEDIA_HOSTS = 'https://*.formula1.com https://*.akamaized.net https://*.akamaihd.net';
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.formula1.com",
  `media-src 'self' blob: data: ${F1_MEDIA_HOSTS}`,
  "font-src 'self' data:",
  `connect-src 'self' ${F1_MEDIA_HOSTS} https://api.openf1.org ${LICENSE_PROXY_ORIGINS}`,
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'f1ov-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}

export default defineConfig({
  base: './', // required for Electron file:// loadFile; absolute /assets/ paths break in production
  plugins: [react(), cspPlugin()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // Heavy vendors in their own chunks: views are lazy-loaded per window (App.tsx), so e.g. the
        // live-timing popout never parses Shaka or the grid, and vendor chunks cache across builds.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('shaka-player')) return 'vendor-shaka';
          if (id.includes('react-grid-layout') || id.includes('react-draggable') || id.includes('react-resizable')) return 'vendor-grid';
          if (id.includes('framer-motion') || id.includes('motion-dom') || id.includes('motion-utils')) return 'vendor-motion';
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react';
          return undefined;
        },
      },
    },
  },
});

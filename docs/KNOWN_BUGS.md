# KNOWN BUGS LIST

## **Severe**

### Sync

- ~~Syncing problem when main stream is far ahead and all streams buffer / never sync (VOD)~~ **Fixed (VOD-safe)**: sync is now seek-only: we read the reference (main) stream once, seek all other streams to that time, then stop. No continuous loop and no playback-rate changes, so the main stream is never stressed and does not buffer (see `useSyncEngine.ts`). For live, other projects (e.g. RaceControl) use rate-only; for VOD with main ahead, seek-once is the safest approach.

### DRM

- **Dev mode**: When running `npm run dev`, the Widevine CDM is in development mode. The F1 license server returns 403 with `DEVELOPMENT_CERTIFICATE_NOT_ALLOWED`. This is expected; use a signed production build (e.g. `release\win-unpacked\F1 OpenViewer.exe`) to play DRM content.
- ~~DRM license rejected (403 / ACN_5002) with VMP-signed build~~ **Fixed**: `contentPlay` now performs a HEAD request on the manifest URL to obtain the `playToken` cookie required by the F1 license server. The cookie is injected into every license proxy request and set as a session cookie for CDN requests (see `f1tv-bridge.js` `fetchPlayToken`, `electron/main.js`).

### Video Players

- When a race player is open, the stream lists could show sessions/races from other years **Working on it**: (1) LiveSection shows only catalog items for the selected year (live always; replay filtered by `season === selectedYear`). (2) Session cache is trimmed to the current event when switching race weekend, so only that weekend’s sessions are shown in the horizontal tabs. Doesn't seem to work though.
- ~~Horizontal scroll (season/session tabs) not scrollable~~ **Fixed**: scroll containers now use `min-w-0` so flex children can shrink and overflow-x-auto works (Header, SessionTabs, DashboardView wrapper).
- ~~CloudFront 403 "Request blocked" / "too much traffic" when opening many streams (Play all)~~ **Mitigated**: 450 ms delay between successive `contentPlay` requests to reduce rate limiting (see `electron/main.js`).

## **Moderate**

### Messages

- ~~Error messages (such as the "region not allowed" message) might show the Shaka error code instead~~

## **Future Fixes**

//
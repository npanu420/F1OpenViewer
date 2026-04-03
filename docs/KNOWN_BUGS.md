# KNOWN BUGS LIST

## **Severe**

### Sync

- ~~Syncing problem when main stream is far ahead and all streams buffer / never sync (VOD)~~ **Fixed (VOD-safe)**: sync is now seek-only: we read the reference (main) stream once, seek all other streams to that time, then stop. No continuous loop and no playback-rate changes, so the main stream is never stressed and does not buffer (see `useSyncEngine.ts`). For live, other projects (e.g. RaceControl) use rate-only; for VOD with main ahead, seek-once is the safest approach.

### DRM

- **Dev mode**: When running `npm run dev`, the Widevine CDM is in development mode. The F1 license server returns 403 with `DEVELOPMENT_CERTIFICATE_NOT_ALLOWED`. This is expected; use a signed production build (e.g. `release\win-unpacked\F1 OpenViewer.exe`) to play DRM content.

- ~~playToken / license failures (403 / ACN_5002) with VMP-signed builds~~ **Fixed**: `contentPlay` loads the DASH manifest with **GET** (`fetchManifestData` in `f1tv-bridge.js`) so CloudFront can set the `playToken` cookie. **HEAD** responses do not carry `Set-Cookie` for that CDN, so the older HEAD-only flow could miss the cookie. The session cookie is then available to the license proxy and Chromium. `npm run build:signed` defaults to **`--force`** so Widevine VMP signing does not reuse a stale cached signature.

- ~~2026+ VOD / pipelineVersion 5+ — license POST returns CloudFront HTML 403~~ **Fixed**: On newer pipelines, `CONTENT/PLAY` often omits `laURL` and `drmToken`, and the MPD has no LA URL inside the XML. The app used to fall back to `.../CONTENT/LA/{entitlement}/{groupId}`, which frequently hit a **generic CloudFront 403** (not a KeyOS license body). The fallback is now **`.../CONTENT/LA/widevine?contentId=...`** (and `channelId` when applicable), consistent with F1’s license acquisition pattern. The license proxy also **deduplicates** repetitive CloudFront HTML error logs and uses **quiet retries** during LA discovery (see `electron/main.js`).

### Video Players

- When a race player is open, the stream lists could show sessions/races from other years **Working on it**: (1) LiveSection shows only catalog items for the selected year (live always; replay filtered by `season === selectedYear`). (2) Session cache is trimmed to the current event when switching race weekend, so only that weekend’s sessions are shown in the horizontal tabs. Doesn't seem to work though.
- ~~Horizontal scroll (season/session tabs) not scrollable~~ **Fixed**: scroll containers now use `min-w-0` so flex children can shrink and overflow-x-auto works (Header, SessionTabs, DashboardView wrapper).
- ~~CloudFront 403 "Request blocked" / "too much traffic" when opening many streams (Play all)~~ **Mitigated**: 450 ms delay between successive `contentPlay` requests to reduce rate limiting (see `electron/main.js`).

## **Moderate**

### Messages

- ~~Error messages (such as the "region not allowed" message) might show the Shaka error code instead~~

## **Future Fixes**

//
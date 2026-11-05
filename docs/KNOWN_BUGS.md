# KNOWN BUGS LIST

## **Severe**

### Sync

- ~~Syncing problem when main stream is far ahead and all streams buffer / never sync (VOD)~~ **Fixed**: `useSyncEngine.ts` is the single owner of drift correction in the multiview (a second corrector inside `MultiViewer` used to fight it and was removed). How it works today:
  - The main feed is always the reference. If it stalls (buffering or paused) every other stream is held instead of being seeked backwards, and resumes when the reference recovers.
  - Drift of 0.5 s or more: seek to the reference time. Smaller drift (above the tolerance): gentle playback-rate nudge (0.95x / 1.05x). Within tolerance: rate back to 1x.
  - Live/DVR streams also seek, but only inside their own seekable window and with a higher threshold (1.5 s); otherwise they fall back to the rate nudge. The decision logic is pure and unit-tested (`src/domain/syncPlan.ts`).
  - Checked on real playback (4 streams of a 2026 race): spread between streams 0.02–0.05 s, others follow a +10 min seek of the main feed, pausing the main feed pauses the rest. This continuous behaviour needs the default "keep streams locked" setting; with it off, sync is one-shot.
  - Video elements are re-resolved on every tick, so moving the main feed to another slot or reloading a stream no longer leaves the engine watching a detached (paused) element, which used to hold every other stream.
  - **Not yet verified**: the live/DVR branch against a real live session.

### DRM

- **Electron fuses are not compatible with VMP signing**: castlabs EVS answers `Binary signature denied` as soon as any fuse is flipped (tested with Electron 42.11.18, even `runAsNode` alone). Fuses stay off; without VMP, encrypted (live) content does not play.

- **Dev mode**: When running `npm run dev`, the Widevine CDM is in development mode. The F1 license server returns 403 with `DEVELOPMENT_CERTIFICATE_NOT_ALLOWED` for **encrypted** content. This is expected; use a signed production build (e.g. `release\win-unpacked\F1 OpenViewer.exe`). Some recent VODs (e.g. 2026 pipeline 6, `SDR_HD_DASH`) are served in the clear and do play in dev builds.

- ~~playToken / license failures (403 / ACN_5002) with VMP-signed builds~~ **Fixed**: `contentPlay` loads the DASH manifest with **GET** (`fetchManifestData` in `f1tv-bridge.js`) so CloudFront can set the `playToken` cookie. **HEAD** responses do not carry `Set-Cookie` for that CDN, so the older HEAD-only flow could miss the cookie. The session cookie is then available to the license proxy and Chromium. `npm run build:signed` defaults to **`--force`** so Widevine VMP signing does not reuse a stale cached signature.

- ~~2026+ VOD / pipelineVersion 5+ — license POST returns CloudFront HTML 403~~ **Fixed**: On newer pipelines, `CONTENT/PLAY` often omits `laURL` and `drmToken`, and the MPD has no LA URL inside the XML. The app used to fall back to `.../CONTENT/LA/{entitlement}/{groupId}`, which frequently hit a **generic CloudFront 403** (not a KeyOS license body). The fallback is now **`.../CONTENT/LA/widevine?contentId=...`** (and `channelId` when applicable), consistent with F1’s license acquisition pattern. The license proxy also **deduplicates** repetitive CloudFront HTML error logs and uses **quiet retries** during LA discovery (see `electron/licenseProxy.js`).

### Video Players

- ~~No seek slider on live streams in the custom player (cannot rewind into the DVR window)~~ **Fixed**: the live progress bar in `VideoControls.tsx` is now a seekable DVR scrubber (click to seek back; clicking near the end snaps back to the live edge via `goToLive`). A "-mm:ss" behind-live indicator is shown when not at the edge.
- When a race player is open, the stream lists could show sessions/races from other years **Working on it**: (1) LiveSection shows only catalog items for the selected year (live always; replay filtered by `season === selectedYear`). (2) Session cache is trimmed to the current event when switching race weekend, so only that weekend’s sessions are shown in the horizontal tabs. Not reproduced when browsing a 2026 weekend end-to-end; leaving it open until confirmed on other years.
- ~~Horizontal scroll (season/session tabs) not scrollable~~ **Fixed**: scroll containers now use `min-w-0` so flex children can shrink and overflow-x-auto works (Header, SessionTabs, DashboardView wrapper).
- ~~CloudFront 403 "Request blocked" / "too much traffic" when opening many streams (Play all)~~ **Mitigated**: 450 ms delay between successive `contentPlay` requests to reduce rate limiting (see `electron/ipc.js`).
- ~~Stream that fails to start showed only the Play button again, with no message~~ **Fixed**: failures of `contentPlay` (region block, expired session, F1 messages) are now shown as an error banner; "Start all streams" reports how many failed and why (`useEmbeddedPlayback.ts`).

- ~~A paused video (or one held by the sync engine) resumed by itself after a seek or rebuffer~~ **Fixed**: auto-play now only applies until playback has started once.
- ~~The standalone player window could not be muted: the volume was forced back on every 350 ms~~ **Fixed**: it unmutes once when playback starts.
- ~~Catalog loading errors (calendar, sessions, streams) were swallowed and looked like "no GPs found" / "main feed only"~~ **Fixed**: they reject all the way to the error banner.
- ~~GP flags never showed (always a chequered flag)~~ **Fixed**: the country is derived from the event name (the meeting key is only a page id).

### Login / Session

- ~~Login session expires too soon; users forced to sign in again~~ **Fixed (silent refresh)**: the app now (1) checks the JWT `exp` of the persisted subscription token before using it, (2) when the token is expired or rejected it silently recovers a fresh token from the persisted F1 cookies, first from the `login-session` cookie, then via a hidden window on account.formula1.com that makes F1 re-issue the cookie, (3) proactively renews the token every 30 min while the app runs if it expires within 6 h, and (4) re-persists token + cookies (rolling 30-day persistence) after every successful refresh. Silent refresh is wired into startup restore, `f1:restoreSession`, `refreshSessionBeforePlayback` and the license-proxy 403 retry.
- ~~Random return to the login screen right after launch~~ **Fixed**: at startup two restores ran in parallel (main process + renderer) and a transient network error in one of them made the fallback **delete the saved token** even though the other had succeeded. Now: concurrent inits with the same token are shared, a transient network error retries once and never drops the session, and the fallback never drops anything if the client became ready meanwhile. F1's edge often resets the first request on a cold connection (`ECONNRESET`), so every GET to F1 (JWKS, location, entitlement, catalog) now retries transient failures.
- ~~The app could fail to open at all on a first launch (no network, or the Widevine CDM download failing with "Failed to install required components")~~ **Fixed**: the CDM wait is capped at 45 s and an install failure no longer aborts startup (it used to leave a running app with **no window**); any other startup failure still opens the main window. Protected streams fail until the CDM installs on a later launch.
- Token and cookies are stored **encrypted** with the OS keystore (Electron `safeStorage`). Plain files from older versions are upgraded on first launch. If the OS cannot encrypt (e.g. Linux without a keyring) they fall back to plain text.

### Live Timing

- ~~Live feed dies for good after a connection drop, and the timing table is replaced by a permanent error~~ **Fixed**: `electron/liveConnection.js` keeps one connection, reconnects with exponential backoff (also when the reconnect itself fails), drops half-open sockets with a watchdog, and the UI shows a "RECONNECTING…" pill instead of an error screen.
- ~~Timing dock of a multiview popout could show the wrong race~~ **Fixed**: the popout now keeps the meeting/session info, and a session query without any meeting hint resolves to the *newest* event instead of round 1.
- ~~Two sessions open at once drove each other's timing / video seek~~ **Fixed**: clock and seek messages carry the session's `contentId` and are ignored by other sessions.
- ~~Empty "Spd" column / DRS badge~~ **Fixed (hidden)**: telemetry (`CarData`) is not subscribed yet, so the column is hidden until that data exists.
- ~~Team radio played the wrong clip after a new message arrived~~ **Fixed**: list keys were positional in a newest-first list.
- ~~"Unsync", manual pause and seek in the timing window were undone within 250 ms while the video was playing~~ **Fixed**: the window now stays detached until you press **Sync to video**.
- ~~A live socket that never opened or answered the handshake hung forever~~ **Fixed**: 20 s handshake timeout, then the normal retry. A record consumer that throws can no longer bring the connection (or the main process) down.
- ~~Live team radio could not be played when the session was not yet in the archive index at start~~ **Fixed**: the archive path is re-resolved every minute until found.
- ~~A timing archive that failed to download (VPN, offline) was cached as an empty session for 10 minutes~~ **Fixed**: a failed load is not cached; reopening retries.
- Archive downloads are cached (memory + disk for sessions finished more than 3 days ago), so re-opening a session, or the dock plus a popout, no longer re-downloads everything.

## **Moderate**

### Messages

- ~~Error messages (such as the "region not allowed" message) might show the Shaka error code instead~~

### Settings

- ~~"Reset all data" did not reset saved layouts/preferences (they were re-seeded from the settings file) nor the archive cache~~ **Fixed**.
- ~~Live Timing dock width and header collapsed state did not survive a reinstall~~ **Fixed**: the main-process allowlist was missing two keys the renderer sent (and a test now keeps both lists in sync). Per-session timing sync offsets are persisted too.

## **Known limitations**

- ~~Replay timing archive returned HTTP 401 for every session~~ **Fixed**: since Nov 2026 `livetiming.formula1.com/static/*` requires `Authorization: Bearer <F1 TV subscription token>`; the app now sends it (main-process session token).
- **Live timing is real-time, F1 TV live video lags behind it** by tens of seconds, so the timing screen can spoil what the video is about to show. There is no delay control yet.
- **No telemetry, no track map**: `CarData.z` / `Position.z` are not subscribed (the decoding code exists).
- Live Timing popout at the default window width (~1100 px) scrolls horizontally: the sectors column is cut off next to the Race Control panel. Widen the window or use the dock on an ultrawide.
- Only one instance per profile: a second launch (including `npm run dev` while the installed app is open, they share the profile) just focuses the running window and exits.
- The app windows run with `webSecurity: false` and `sandbox: false`, and on Windows the whole process is started with `--no-sandbox` (needed for the Widevine CDM and F1's CDN/DRM requests). Mitigations: a Content-Security-Policy in the packaged build, navigation locked to the app itself, `window.open` denied, IPC accepted only from the app's own document, a permission allowlist, no account token in the renderer, no generic network bridge, license proxy protected by a per-launch secret.
- Live Timing archive requests use the system `curl.exe` on Windows so a VPN can split-tunnel it (see README). macOS/Linux use the in-process client.
- `npm audit` (dev tree) still reports `extract-zip` (a transitive dependency used only while installing Electron); nothing from it ships in the app.

## **Future Fixes**

- Live timing delay (buffer the feed to match video latency).
- Subscribe `CarData.z` / `Position.z`: speed, gear, DRS, track map.
- Verify the live/DVR sync branch and macOS packaging on real hardware.

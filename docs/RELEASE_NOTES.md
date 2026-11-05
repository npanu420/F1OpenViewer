# Release Notes - F1 OpenViewer

## Unreleased

Reliability, security and cleanup pass. No new user-facing feature; a lot of things that failed quietly now work or say why.

### Reliability

- **No more login flash at launch**: the app shows a "Restoring your session…" screen until the saved session is checked, instead of the sign-in form for a few seconds.
- **Offline at launch**: when F1 TV can't be reached the app says so and offers "Try again" (the saved session is kept) instead of dropping you on the sign-in form.
- **Replay timing works again**: F1 now requires the F1 TV subscription token on the timing archive (it answered HTTP 401 to every request, so past-session timing and team radio failed for everyone). The token is sent as `Authorization: Bearer`, through curl's stdin so it never appears on a command line.
- **Expired session**: when F1 rejects the saved session mid-use, the app returns to the sign-in screen with an explanation (and closes its popouts) instead of failing stream by stream.
- **Sign-out closes the popouts** (multiview, timing, player windows kept playing on a session that no longer existed), and a catalog load still in flight can no longer refill the dashboard after sign-out.
- The app window opens right away: the Widevine CDM is awaited before the first playback instead of before showing anything (up to 45 s on a fresh profile).
- Failed "Start all streams" requests keep the 450 ms spacing (a batch of failures used to burst); switching timing sessions no longer shows the previous session's table; no duplicate session/event requests; a session whose title also mentions another year is no longer hidden.
- **"Start all streams" then switching session** no longer drops the previous session's streams into the new one when they resolve late.
- **Sign-in survives network hiccups**: a transient error at launch (F1's edge often resets the first request) no longer sends you back to the login screen. Concurrent session restores are merged, every GET to F1 retries transient failures, and a saved session is only dropped for real auth failures.
- **Live Timing reconnects**: one shared connection with exponential backoff, a watchdog for dead sockets, and a "RECONNECTING…" indicator instead of a permanent error screen. A failed reconnect attempt no longer ends the feed.
- **One sync engine**: the multiview had two drift correctors fighting each other. Now only the sync engine corrects; live/DVR streams can be seeked inside their window. Verified with real playback: streams stay within ~0.05 s, follow seeks, and hold when the main feed pauses.
- **Failed streams say why**: region blocks, expired sessions and "Start all streams" failures show a message (before, the play button just came back).
- **Timing fixes**: the popout multiview showed the wrong race's timing; two open sessions no longer drive each other's clock or seek; radio clips no longer attach to the wrong message; the empty speed column is hidden.
- Settings that were supposed to survive a reinstall now do (dock width, header state, per-session timing offsets). "Reset all data" now really resets them (and the archive cache).
- **Timing window controls work**: Unsync, manual pause and seek used to be undone within 250 ms while the video played. It stays detached until you press "Sync to video".
- A paused video no longer resumes itself after a seek; the standalone player window can be muted again.
- Calendar / session / stream loading errors show up instead of looking like an empty list. GP flags actually show.
- The app opens even on a first launch without network (CDM download capped at 45 s); a live socket that never handshakes is retried; live team radio resolves its archive path late if needed.
- Video controls, session tabs and the whole timing UI are translated (EN/IT).

- **Live timing with two windows** (dock + popout): the second one used to stay on "CONNECTING…" without drivers; it now gets the connection status and a fresh snapshot.
- **The app always opens**: a failed Widevine CDM download (seen on fresh profiles) used to abort startup and leave the app running with no window; now it logs and opens anyway.
- **Robustness**: every network request has a timeout (a stalled request used to block the playback queue for up to 5 minutes); one instance per profile (a second launch focuses the running app instead of racing on the same files); a crashed window reloads itself; stray errors in the main process are logged instead of popping an error box; the live timing falls back to the built-in HTTP client when `curl.exe` is missing (Windows older than 1803).

### Performance

- The multiview no longer re-renders twice a second forever after a sync (the drift watcher only updates the UI when something visible changes), and players are memoized so a multiview re-render no longer re-renders every player and control bar.
- Live timing only rebuilds the lists whose feed changed (race control / radio were rebuilt 10x/s); video control bars skip time updates while hidden; compact tiles keep 10 s of played media instead of 30 s; the video clock is only relayed while a timing window listens; event/stream lists are cached for 3 minutes (Refresh clears it); stale per-launch cache folders in %TEMP% are deleted; no backdrop blur over playing video.
- Replay timing skips no-op updates (it re-rendered 4-5x/s even while paused); race control and team radio lists only re-render when their data changes.
- Smaller, split bundle: views load per window (the live-timing popout no longer loads Shaka or the grid), vendors are in separate cached chunks, and Shaka is the core build without its unused UI (-320 KB). Total JS 1.55 MB -> 1.24 MB.
- Live Timing view models are only recomputed when data changed, rows only re-render when their content changed, live updates are rendered at most every 100 ms.
- Scrubbing the replay timeline restores the nearest checkpoint instead of rebuilding the whole session.
- Archive downloads are cached (memory, plus disk for finished sessions), so dock + popout share one download.

### Security and privacy

- **Electron 42** (castlabs `v42.11.18+wvcus`): the v40 line is end-of-life and had open advisories. Production `npm audit` is clean (undici, follow-redirects).
- The F1 sign-in and silent-refresh windows (remote pages, Chromium sandbox off on Windows for the CDM) can only navigate over https; popups are denied (refresh window) or https-only and locked down (sign-in window).
- **Stricter CSP**: network, images and media only to F1 hosts, OpenF1 and the local license proxy ports (was any https host and any local port).
- Developer switches (`ELECTRON_START_URL`, `ELECTRON_OPEN_DEVTOOLS`, `ELECTRON_RELAX_CORS`) are ignored in packaged builds; F12 DevTools there only with `F1OV_DEVTOOLS=1`. Search parameters from the renderer are allowlisted; "open external" only opens this project's GitHub pages; license URLs and challenge bytes are no longer logged.
- Account tokens are attached only to real license requests (an `LA` path segment on formula1.com), no longer to any formula1.com URL containing `/LA`, query strings included.
- **No credentials in the UI process**: the F1 TV account token and the account-level license tokens (ascendon, entitlement) no longer reach the renderer. (The per-play playToken still travels inside the signed manifest URL the player has to load; it is scoped to that one stream.) It only learns "signed in / not signed in"; the main process attaches the tokens to license and CDN requests itself.
- **IPC sender check**: every bridge call is rejected unless it comes from the app's own document.
- **Permissions locked down**: Electron granted every permission to every page by default (camera, microphone, geolocation, notifications… including the F1 login page). Only fullscreen, the Widevine key system and clipboard write are allowed now.
- **Input validation at the IPC boundary**: ids, season years, meeting/session keys and feed names are validated before they end up in a URL; live telemetry payloads are decompressed with a size cap.

- Account token and cookies are **encrypted at rest** (OS keystore); old plain files are upgraded automatically.
- Content-Security-Policy in the packaged app, windows locked to the app document, `window.open` denied.
- Removed an unused generic network bridge that injected the account token into any URL the renderer asked for.
- The local license proxy requires a per-launch secret; the multiview hand-off in localStorage carries no account tokens (only per-play data such as signed manifest URLs, removed again on the next start); logs no longer contain entitlement claims or signed manifest URLs.
- Fonts are bundled: the app no longer contacts Google at runtime.

### Tooling and docs

- Accessibility: icon buttons have labels (screen readers), keyboard focus is always visible, Esc closes Settings.

- CI (typecheck, tests, build, production audit) and Dependabot. `npm run check` runs typecheck + tests locally.
- Test suite grew from 72 to 150+ tests: connection resilience, sync decisions, replay checkpoints, caches, session storage, translations consistency.
- Verbose Shaka/license traces are off unless `localStorage.setItem('f1-debug','1')`.
- `docs/KNOWN_BUGS.md`, `docs/SETUP.md`, README and CONTRIBUTING brought in line with the code.

---

## v1.2.2

This patch restores reliable F1 account sign-in and live timing, improves replay synchronization, and makes race weekend navigation clearer across F1 and support series.

### Login and sessions

- **Reliable browser sign-in**: the login window now uses the app's actual Chromium user agent and persistent session instead of a hardcoded browser version and a temporary partition.
- **Safer token capture**: sign-in completes from the updated `login-session` cookie, without injecting fetch or XHR overrides into the F1 account page.
- **Session persistence**: successful browser sign-in saves the current F1 cookies immediately and restores a valid existing session when available.
- **Clearer diagnostics**: browser login failures and session initialization now produce focused main-process logs.

### Live Timing

- **Live feed restored**: the live timing client now connects to F1's current SignalR Core endpoint, including negotiation, protocol handshake, keepalive handling, and reconnects.
- **No account token required for timing**: live timing uses the public timing service independently from F1 TV video authentication.
- **Improved full-window layout**: the standalone timing view uses larger rows, typography, sector indicators, tyre markers, weather data, race control, and team radio panels.
- **Replay scrub synchronization**: seeking from the replay timing timeline now seeks the video, while the existing multiview synchronization keeps the other streams aligned.

### Archive and session navigation

- **Weekend stage tabs**: practice, sprint qualifying, sprint, qualifying, and race sessions are grouped in chronological order.
- **Broadcast variants**: pre-show, main session, post-show, and F1 Kids broadcasts are grouped under their matching weekend stage.
- **Support series**: Formula 2, Formula 3, F1 Academy, and Porsche Supercup sessions remain available under separate series tabs instead of being filtered out.
- **Better defaults**: event pages select the race replay by default when available, identify testing events separately, remove duplicate event containers, and preserve chronological event order.

### Maintenance

- Added focused tests for browser-login cookie handling, SignalR Core messages, and session grouping.
- Removed the obsolete login preload bridge and simplified related IPC and timing code.
- Fixed Windows executable icon application with the current `rcedit` module API.
- Updated HTTP clients and build tooling to patched releases.
- Cleaned up comments and implementation details across the touched code paths.

---

## v1.2.1

Polish release: standalone player and multiview improvements, quieter session handling, an in-window Live Timing dock, a driver shelf for multiview, ultrawide-friendly layouts, and an in-house F1 TV API client (MIT).

### Multiview & UI

- **Driver shelf**: horizontal strip of main feed, data channels, and onboard cameras grouped by team. Drag a card onto a grid slot, or click to pick then click a slot. Driver headshots via OpenF1 when available; team-color accent on each card.
- **Live Timing dock**: open timing beside the multiview grid (toggle in the toolbar) without spawning a separate window. Resizable panel; drag wider on an ultrawide monitor to unlock the full timing table (sectors, intervals, stint detail, race control, and team radio). Width is remembered across restarts.
- **Command bar refactor**: Play All, sync, layouts, Live Timing popout/dock, and fullscreen controls moved into a shared toolbar component (normal and fullscreen layouts).
- **Default layout no longer starts letterboxed**: built-in tile sizes account for the slot header height, so a fresh grid matches 16:9 instead of showing bars until you resize.
- **Auto-fit on load**: once a slot's real stream resolution is known, it snaps to that aspect automatically.
- **"Hide titles" outside fullscreen**: the toggle is now in the normal grid toolbar, not only in fullscreen.
- **"Add slot" in fullscreen**: available from the fullscreen floating toolbar.
- **Auto-sync**: streams sync when a new one starts playing (debounced; "Play All" still triggers a single pass).
- **Fullscreen mode fix**: standalone multiview fullscreen now loads and lays out correctly.

### Ultrawide monitors

- **Multiview + timing side by side**: the grid and the Live Timing dock share one window (`multiview | timing`) instead of cramming everything into a narrow column or forcing a second monitor for timing.
- **Dock scales with your display**: the panel can grow up to 60% of the window width (capped at 1600px), so on a 34" ultrawide you can give timing ~1000px without eating the entire screen.
- **Wide dock = full timing UI**: below 640px the dock stays in a compact glance layout (positions, gaps, sectors only). At 640px and above it adds interval, last/best lap, stint history, and the race-control / team-radio columns, same detail level as the standalone timing window.
- **Layout doesn't clip on resize**: dock width re-clamps when you move the window between an ultrawide and a smaller display, and the multiview grid keeps `min-w-0` flex sizing so streams don't overflow horizontally.

### Standalone player window ("Open in window")

- **Fixed black bars**: the popped-out window no longer letterboxes the video (removed a leftover global CSS rule capping `<video>` height).
- **Fixed crash on close**: DRM teardown runs before the window is destroyed, instead of killing the page mid-playback.
- **Reload stream**: right-click → Reload.
- **Switch stream**: right-click → Switch stream (main feed, onboard, data) without closing the window.

### Live Timing

- **Faster popout open**: the main window passes session info straight through; the timing window resolves the archive path itself instead of blocking the click on network calls.

### Login & sessions

- **Silent session refresh**: expired or rejected tokens are recovered from saved F1 cookies (or a hidden background window) without forcing a manual login every few days.

### Update notifier

- Checks GitHub releases once per launch and shows a dismissible banner with a link to the release page. Dismissing it won't nag again for that version.

### Settings persistence

- Saved grid layouts, sync preferences, theme, language, and Live Timing dock width now also persist in a userData-backed settings file, so they survive a manual reinstall to a different folder (not only localStorage tied to the install path).

### F1 TV API (licensing)

- **In-house client** (`electron/f1tvapi.js`, MIT): replaces the `@exhumer/f1tv-api` dependency (AGPL-3.0), which did not match this app's MIT license. Covers JWT verification and the endpoints the app actually uses.

### Under the hood

- **Electron main process split**: `main.js` broken into focused modules (`ipc`, `session`, `windows`, `licenseProxy`, `livetiming`, etc.) for easier maintenance.
- **F1 TV bridge split**: catalog, client lifecycle, and playback resolution are separate modules.
- **CodeQL**: URL sanitization hardening.
- **GitHub community standards**: issue templates, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`.

---

## v1.2.0

This release adds **Live Timing**: a synced timing screen for replays, plus a round of UI fixes and polish across the app.

### Live Timing

- **New feature**: a standalone Live Timing window with driver standings, gaps, sector times, tyre stints (with pit stop history on hover), race control messages and team radio, replayed alongside a session in sync with the video. Open it from the "Live Timing" button on a Grand Prix or live event page.
- **Auto-sync**: timing lines up with the video automatically, no manual alignment needed for most sessions. A small sync menu is still available (align to the lap shown on screen, or nudge by seconds) for sessions where auto-sync isn't available.
- **No extra login**: Live Timing reads from F1's public timing archive, separate from F1 TV, so it works without your F1 TV account. Only the video side of the app still needs one.
- **Team radio playback**: radio clips now actually play (previously stuck at 0:00 for some setups) and use a custom slim player instead of the browser's default audio controls.
- **Race control colors**: flag messages (blue, yellow, clear, etc.) are now color-coded instead of showing everything in the same color.
- **Layout**: race control and team radio are now two independently scrollable panels instead of one shared list, so a long race control feed no longer pushes team radio out of view.
- Fixed a short UI freeze when opening the Live Timing window: it now opens instantly and loads its data in the background.
- Fixed the app icon showing as the generic Electron icon on the Multiview and Live Timing windows.

---

## v1.1.4

This release fixes **DRM playback for newer F1 TV pipelines** (e.g. **2026 VOD**), where the API no longer returns a license URL in `CONTENT/PLAY` and the DASH manifest does not embed an LA endpoint.

### DRM & license

- **Pipeline 5+ / 2026 replays**: When `laURL` / `drmToken` are missing, the app now uses a **Widevine-style license URL** — `.../CONTENT/LA/widevine?contentId=...` (and `channelId` when needed) — instead of the older entitlement-only path that often resulted in **CloudFront HTML 403** on the license POST. Playback for **live** and **pre-2026** VOD is unchanged when the API still returns `laURL` as before.
- **License proxy logging**: CloudFront **403** HTML errors are **deduplicated** semantically (same error text, different request IDs). **LA discovery** retries after a 403 are logged in **quiet** mode with a short summary, so the console stays readable during troubleshooting.

### Documentation

- **KNOWN_BUGS**: DRM section updated to describe the **GET**-manifest / `playToken` cookie fix and the **widevine** LA fallback separately and accurately.

### macOS

- **Building for Mac**: The project can now be built for **macOS** (see `docs/SETUP.md` / `docs/BUILD_SIGNING.md`): use `npm run build` on a Mac to produce a `.app` bundle, with the same Widevine (Castlabs) and EVS signing considerations as on Windows.
- **Apple silicon release**: A **Mac ARM64** build has been published for distribution (Apple Silicon / M-series).

---

## v1.1.3

- **Localization**: Additional UI strings and live section texts are now fully localized (EN/IT).
- **UI**: App logo icon in the header (top left) instead of the generic TV icon; minor aesthetic tweaks.

---

## v1.1.2

This release improves **fullscreen multiview**, **live streaming**, and **user feedback** when loading multiple streams.

### Fullscreen

- **Streams in fullscreen**: When you open the multiview in the separate fullscreen window while streams are already playing, those streams are now handed off to the fullscreen window and stop in the main app. The fullscreen window re-resolves playback so streams start there with valid tokens instead of showing a blank or stuck state. "Start all streams" in fullscreen now starts all available streams (no cap).

### Live

- **Click to open**: The "Click to open" action on live stream cards now correctly opens the live event in a dedicated view with the same grid layout as a Grand Prix (main feed, data channel, onboard).
- **Localized live section**: Live section labels and messages are fully localized.

### UX

- **Loading hint**: When you press "Start all streams", a short localized message appears and then fades out, explaining that loading all streams may take a moment and that we are working to minimize this wait.

**Note:** On Windows, unsigned or non–commercially signed builds may still trigger a **Microsoft Defender SmartScreen** warning. This is expected; you can use "More info" → "Run anyway" if you trust the source.

**Note (macOS):** Builds without a paid Apple Developer ID / notarization will trigger a **Gatekeeper** "cannot be opened because it is from an unidentified developer" warning on first launch. This is expected; right‑click (or Control‑click) the app → **Open** to bypass it, or run `xattr -d com.apple.quarantine "F1 OpenViewer.app"` in Terminal.

---

## v1.1.1

This release adds a **resizable stream grid** for the multiview: you can arrange and resize streams in a flexible layout, save and reuse custom layouts, and open the multiview in a **separate fullscreen window**. A **clean-release** script is available to clear the build output folder before rebuilding (e.g. to avoid "Access denied" on Windows when the app or another process is using files in `release/`).

---

## v1.1.0

This release focuses on **stability, multi-stream playback, and UI fixes** built on the initial 1.0.0 client.

### DRM & playback

- **DRM license (403 / ACN_5002)**: Fixed license rejection with VMP-signed builds. The app now obtains the required `playToken` cookie via a HEAD request on the manifest URL and injects it into license and CDM requests, so DRM-protected content plays correctly after signing.
- **Multiple streams**: You can open several streams at once. Playback requests are serialized and spaced (450 ms between each) to avoid CloudFront rate limiting (403 "Request blocked" / "too much traffic") when using "Play all" or opening many streams.
- **"F1 TV client not ready"**: Resolved by serializing `contentPlay` calls so session refresh and init run in order; no more race conditions when opening multiple streams quickly.

### Sync & buffering

- **VOD sync**: Sync no longer causes the main stream to buffer indefinitely. Sync is now **seek-only**: the main stream is the reference; other streams are seeked once to match it, with no continuous rate-adjustment loop, so the main stream stays stable.

### UI

- **Horizontal scroll**: Season and session tabs scroll correctly; layout uses `min-w-0` so the scroll area can shrink and scroll.
- **Session list**: When a race weekend is open, the stream list and session tabs show only **that weekend's sessions** (and the selected year's replays), not sessions from other years or events.

The SmartScreen note from 1.0.0 still applies if you use an unsigned or non–commercially signed build; VMP-signed builds are for DRM and do not remove the need for a trusted code-signing certificate for SmartScreen reputation.

---

## v1.0.0

This is the initial public release of **F1 OpenViewer**, a desktop client for F1 TV built with Electron and React. The app allows you to sign in with your own F1 TV account, perform entitlement checks, and play DRM-protected content using Widevine, closely mirroring the official F1 TV web experience while remaining strictly non-pirate and subscription‑based.

On Windows, this first version is not yet signed with a trusted commercial code‑signing certificate, so you will likely see a **Microsoft Defender SmartScreen warning** when you run the installer or executable. This is expected for new, unsigned open‑source applications.

> If you trust the project and want to proceed, you may need to click "More info" and then "Run anyway."

I am already in contact with SignPath to obtain and integrate a proper open‑source code‑signing certificate for future builds. Once the signing pipeline is in place and releases are regularly signed, SmartScreen warnings should be significantly reduced or disappear over time as reputation is established.

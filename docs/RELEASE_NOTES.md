# Release Notes – F1 OpenViewer

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

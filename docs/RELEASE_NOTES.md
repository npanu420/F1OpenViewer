# Release Notes – F1 OpenViewer

## v1.2.1 (Work in Progress)

This release is a polish pass on the standalone player window and the multiview grid, plus a login session that no longer needs you to sign in again every few days, an update notifier, and settings that now survive a manual reinstall.

### Standalone player window ("Open in window")

- **Fixed black bars**: the popped-out window no longer letterboxes the video. The bug was a leftover global CSS rule capping any `<video>` element to 70% of viewport height with a border and rounded corners, meant for the old inline player. The new fill mode opts out of it.
- **Fixed a crash on close**: closing the window while a DRM stream was actively playing could bring down the whole app. The window now asks the player to tear itself down cleanly before it's actually destroyed, instead of killing the page mid-playback.
- **Reload stream**: right-click → "Reload" to recover from a stuck or errored stream without closing the window.
- **Switch stream**: right-click → "Switch stream" to change camera angle (main feed, onboard, data channel) without closing and reopening the window.

### Multiview grid

- **Default layout no longer starts letterboxed**: the built-in default tile sizes now account for the slot header's height, so a fresh grid actually matches a 16:9 stream instead of showing bars until you resize.
- **Every slot self-corrects on load**: once a slot's real stream resolution is known, it snaps to that aspect automatically, using the same logic that already runs on manual resize.
- **"Hide titles" now works outside fullscreen too**: previously only available in the fullscreen toolbar, the toggle is now in the normal grid toolbar as well.
- **"Add slot" is now usable in fullscreen**: it was disabled there because the button didn't fit fullscreen's layout; it's now available from the fullscreen toolbar instead.
- **Auto-sync**: streams now sync automatically as soon as a new one starts playing, instead of requiring a manual click on "Sync". Starting several streams close together (e.g. "Play All") still only triggers one sync pass, not one per stream.

### Login & sessions

- **Silent session refresh**: the app no longer forces a fresh login every time the token nears expiry. It checks the token's expiry up front, and if it's expired or gets rejected, it quietly recovers a new one from the saved F1 cookies (or a hidden background window if needed) and keeps playback going. Manual login is only needed if the saved cookies themselves are gone.

### Update notifier

- The app checks GitHub releases once per launch and shows a small dismissible banner if a newer version is available, with a link straight to the release page. Dismissing it won't nag you again for that same version.

### Settings persistence

- Saved grid layouts, sync preferences, theme, and language now also live in a small settings file next to your session data, not only in the browser-style local storage tied to the app's install folder. If you update by deleting the old folder and unzipping a new one somewhere else, these settings now come with you instead of resetting.

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

- **Streams in fullscreen**: When you open the multiview in the separate fullscreen window while streams are already playing, those streams are now handed off to the fullscreen window and stop in the main app. The fullscreen window re-resolves playback so streams start there with valid tokens instead of showing a blank or stuck state. “Start all streams” in fullscreen now starts all available streams (no cap).

### Live

- **Click to open**: The “Click to open” action on live stream cards now correctly opens the live event in a dedicated view with the same grid layout as a Grand Prix (main feed, data channel, onboard).
- **Localized live section**: Live section labels and messages are fully localized.

### UX

- **Loading hint**: When you press “Start all streams”, a short localized message appears and then fades out, explaining that loading all streams may take a moment and that we are working to minimize this wait.

**Note:** On Windows, unsigned or non–commercially signed builds may still trigger a **Microsoft Defender SmartScreen** warning. This is expected; you can use “More info” → “Run anyway” if you trust the source.

**Note (macOS):** Builds without a paid Apple Developer ID / notarization will trigger a **Gatekeeper** “cannot be opened because it is from an unidentified developer” warning on first launch. This is expected; right‑click (or Control‑click) the app → **Open** to bypass it, or run `xattr -d com.apple.quarantine "F1 OpenViewer.app"` in Terminal.

---

## v1.1.1

This release adds a **resizable stream grid** for the multiview: you can arrange and resize streams in a flexible layout, save and reuse custom layouts, and open the multiview in a **separate fullscreen window**. A **clean-release** script is available to clear the build output folder before rebuilding (e.g. to avoid “Access denied” on Windows when the app or another process is using files in `release/`).

---

## v1.1.0

This release focuses on **stability, multi-stream playback, and UI fixes** built on the initial 1.0.0 client.

### DRM & playback

- **DRM license (403 / ACN_5002)**: Fixed license rejection with VMP-signed builds. The app now obtains the required `playToken` cookie via a HEAD request on the manifest URL and injects it into license and CDM requests, so DRM-protected content plays correctly after signing.
- **Multiple streams**: You can open several streams at once. Playback requests are serialized and spaced (450 ms between each) to avoid CloudFront rate limiting (403 “Request blocked” / “too much traffic”) when using “Play all” or opening many streams.
- **“F1 TV client not ready”**: Resolved by serializing `contentPlay` calls so session refresh and init run in order; no more race conditions when opening multiple streams quickly.

### Sync & buffering

- **VOD sync**: Sync no longer causes the main stream to buffer indefinitely. Sync is now **seek-only**: the main stream is the reference; other streams are seeked once to match it, with no continuous rate-adjustment loop, so the main stream stays stable.

### UI

- **Horizontal scroll**: Season and session tabs scroll correctly; layout uses `min-w-0` so the scroll area can shrink and scroll.
- **Session list**: When a race weekend is open, the stream list and session tabs show only **that weekend’s sessions** (and the selected year’s replays), not sessions from other years or events.

The SmartScreen note from 1.0.0 still applies if you use an unsigned or non–commercially signed build; VMP-signed builds are for DRM and do not remove the need for a trusted code-signing certificate for SmartScreen reputation.

---

## v1.0.0

This is the initial public release of **F1 OpenViewer**, a desktop client for F1 TV built with Electron and React. The app allows you to sign in with your own F1 TV account, perform entitlement checks, and play DRM-protected content using Widevine, closely mirroring the official F1 TV web experience while remaining strictly non-pirate and subscription‑based.

On Windows, this first version is not yet signed with a trusted commercial code‑signing certificate, so you will likely see a **Microsoft Defender SmartScreen warning** when you run the installer or executable. This is expected for new, unsigned open‑source applications.

> If you trust the project and want to proceed, you may need to click “More info” and then “Run anyway.”

I am already in contact with SignPath to obtain and integrate a proper open‑source code‑signing certificate for future builds. Once the signing pipeline is in place and releases are regularly signed, SmartScreen warnings should be significantly reduced or disappear over time as reputation is established.

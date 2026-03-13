# Release Notes – F1 OpenViewer

## v1.1.0

This release focuses on **stability, multi-stream playback, and UI fixes** built on the initial 1.0.0 client.

### DRM & playback

- **DRM license (403 / ACN_5002)**: Fixed license rejection with VMP-signed builds. The app now obtains the required `playToken` cookie via a HEAD request on the manifest URL and injects it into license and CDM requests, so DRM-protected content plays correctly after signing.
- **Multiple streams**: You can open several streams at once. Playback requests are serialized and spaced (450 ms between each) to avoid CloudFront rate limiting (403 “Request blocked” / “too much traffic”) when using “Play all” or opening many streams.
- **“F1 TV client not ready”**: Resolved by serializing `contentPlay` calls so session refresh and init run in order; no more race conditions when opening multiple streams quickly.

### Sync & buffering

- **VOD sync**: Sync no longer causes the main stream to buffer indefinitely. Sync is now **seek-only**: the main stream is the reference; other streams are seeked once to match it, with no continuous rate-adjustment loop, so the main stream stays stable.
- **Multi-stream buffering**: Lower buffer targets and 720p cap for embedded streams reduce constant buffering when many streams are open, in line with other F1 TV multiview apps.

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

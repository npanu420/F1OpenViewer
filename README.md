# ![OpenViewer](assets/openviewer_banner.png)

# OpenViewer by npanu420

Official login, entitlement, and DRM (Widevine) playback in an Electron app. Authorized access only, no piracy.

[![OpenViewer auto layout: streams are added, dropped and re-arranged while the window is resized](assets/auto-layout-demo.gif)](docs/media/auto-layout-demo.mp4)

*The auto layout following the window, with Live Timing and the driver HUD. [Watch the full video](docs/media/auto-layout-demo.mp4).*

📖 **Setup:** [docs/SETUP.md](docs/SETUP.md) — clone, configure `.env`, run in dev, build and sign.

🔐 **Build & signing:** [docs/BUILD_SIGNING.md](docs/BUILD_SIGNING.md) — code signing, Widevine VMP, certificates.

## Contents

- [What it does](#what-it-does)
- [Live Timing](#live-timing)
- [Tech stack](#tech-stack)
- [Requirements](#requirements)
- [Screenshots](#screenshots)
- [Roadmap](#roadmap)
- [Contact](#contact-me)
- [Disclaimer & Legal Notice](#disclaimer--legal-notice)
- [License](#license)

---

## What it does

- **Authorized access** — Sign in with your F1 TV account (email/password, token, or in-app browser login).
- **DRM playback** — Stream protected content via Widevine CDM in a compliant way.
- **No unauthorized content** — No keys, bypasses, or stream sharing.

### The cool part

- **Everything stays in sync, automatically** — In multiview, the main feed, onboards, and data channel are continuously locked to each other: the sync engine anchors on the race/world feed and keeps correcting the rest (seek if the drift is large, subtle playback-rate nudges if it's small), so onboards never quietly drift ahead or behind the race. If the world feed rebuffers, everything else automatically syncs instead of running away.
- **Live Timing synced to the video, not just running alongside it** — Standings, gaps, sector times, tyre stints, race control messages and team radio line up automatically with whatever moment you're watching in the replay, no manual alignment needed.
- **Auto layout that fills any screen** — Every tile is exactly 16:9, so there are no black bars, and the number of streams follows the window: the main feed stays the big tile, favourite drivers come next, and ultrawide monitors get filled edge to edge. Remove, add or swap panels by hand, save layouts you like, or pop the whole multiview out into its own window.
- **Live-edge playback** — Live sessions track the live edge instead of drifting behind like a plain HTML5 video.

---

## Live Timing

Live Timing opens in its own window next to a session replay and shows the same kind of data you'd see on the official timing screen: standings, gaps, sector times, tyre stints, race control messages and team radio clips.

| Ultrawide (dock beside the auto layout) | Standard width |
|---|---|
| ![Live Timing dock, ultrawide](assets/livetiming.png) | ![Live Timing dock, standard width](assets/livetiming-compact.png) |

It runs on a public F1 archive that has nothing to do with F1 TV or DRM, so it doesn't need you to be logged in at all. The only login in this app is still the one for video playback.

**VPN note (Windows):** Live Timing isn't georestricted, but its host blocks many VPN exit IPs at the WAF level. On Windows, the app fetches the archive via the system `curl.exe` instead of in-process, specifically so that a full-tunnel VPN (e.g. NordVPN) can split-tunnel by excluding just `curl.exe` — Live Timing then leaves on your real IP while everything else stays on the VPN. If your VPN client only supports app-based split-tunneling, add an exclusion rule for `C:\Windows\System32\curl.exe`.

Live sessions are supported too (the feed reconnects by itself if the connection drops). Note that F1 TV live video lags the timing feed by tens of seconds, so the timing screen can show things the video has not reached yet.

Manual alignment used to be difficult because the archive and video clocks weren't synchronized. Now, the app automatically fetches the correct offset  when you start a session. If this lookup fails or a session is unsupported, you can still align them manually via the sync menu by selecting the lap shown on screen or nudging the offset.

---

## Privacy & security

- No telemetry, no analytics, no ads. Your F1 TV token and cookies stay on your machine, encrypted with the OS keystore.
- The only third-party services the app talks to, besides F1's own: a public video-to-timing sync offset service, `api.openf1.org` (driver headshots) and GitHub (once per launch, to look for a newer release).
- The packaged app ships a Content-Security-Policy, only ever shows its own document, and its local license proxy needs a per-launch secret. The playback windows still run with relaxed web security because F1's CDN/DRM requests need it; details in [docs/KNOWN_BUGS.md](docs/KNOWN_BUGS.md).
- Found a vulnerability? See [SECURITY.md](SECURITY.md).

---

## Tech stack

| Layer | Technology |
|---|---|
| Desktop shell / DRM | **Electron** (Castlabs fork for Widevine), CDM handling, IPC to avoid CORS |
| UI | **React + Vite** |
| Playback | **Shaka Player** — DASH/HLS and Widevine DRM |
| Storage | Account token and cookies encrypted at rest with the OS keystore (Electron `safeStorage`); settings in a JSON file under the app data folder |
| Fonts | Bundled locally (`@fontsource`), no requests to Google at runtime |
| Data | Unofficial F1 TV APIs — login at `api.formula1.com`, catalog/playback via an in-house client (`electron/f1tvapi.js`, MIT) against f1tv.formula1.com |

---

## Requirements

- **Node.js** (LTS recommended)
- **Valid F1 TV subscription**
- **Windows or macOS** — both are supported for build and Widevine DRM playback (see [docs/SETUP.md](docs/SETUP.md) / [docs/BUILD_SIGNING.md](docs/BUILD_SIGNING.md) for the per-OS Widevine CDM path and signing steps). Other platforms may need manual CDM setup.

---

## Screenshots

| | |
|---|---|
| **Session view, auto layout** | ![Session view with the auto layout](assets/screenshot001.png) |
| **Multiview window, ultrawide** | ![Multiview window on an ultrawide monitor](assets/screenshot002.png) |
| **Controls hidden, ultrawide** | ![Controls hidden with the Live Timing dock](assets/screenshot004.png) |
| **Home** | ![Home with the race calendar](assets/screenshot003.png) |

---

## Contact Me

- Github: github.com/npanu420
- Discord: @Ovetto

---

## Disclaimer & Legal Notice

Please read carefully before using or contributing to this project.

This project is a strictly non-profit, educational, and open-source endeavor developed solely by a university student for academic research purposes. The primary goal of this software is to study modern desktop streaming architectures, hybrid web-desktop frameworks (Electron/React), and the secure implementation of Digital Rights Management (DRM) technologies.

- **No Piracy or Paywall Bypass** — This application does NOT provide free access to Formula 1 broadcasts. It is fundamentally impossible to watch any live or on-demand session without authenticating via a legally purchased, active, and valid F1 TV Pro or Premium subscription.
- **Strict DRM Compliance** — This client does not decrypt, rip, record, or bypass any video protection mechanisms. It utilizes Google's certified Widevine Content Decryption Module (CDM) to legally and securely request and play the encrypted video streams (DASH/HLS), exactly as the official web player does.
- **No Geoblocking or VPN Bypass** — This software does not alter or mask your location. The official F1 TV servers enforce all regional restrictions and blackout rules based on your network IP during the entitlement process.
- **Zero Commercial Intent** — This project is 100% free, open-source, and contains no advertisements, telemetry, or monetization schemes of any kind.
- **Trademarks and Copyright** — This is an unofficial, community-driven academic project. It is not affiliated with, endorsed by, or sponsored by Formula One Digital Media Limited, Formula One Management, or any of their partners. "F1", "FORMULA 1", "F1 TV", and related marks are registered trademarks of Formula One Licensing B.V. All rights to the broadcast content, data, and official branding remain the exclusive property of their respective owners.

If you represent Formula One Digital Media Limited and have any concerns regarding this educational project, please contact me directly, and I will promptly address them or remove the repository.

### AI Disclaimer

AI was used in this project for **repetitive code** (e.g. login flows and boilerplate) and, in particular, for **translating the application, READMEs and code comments into English** so that documentation and code are easier to understand for everyone. Core logic and architecture remain human-authored.

---

## License

MIT — see [LICENSE](LICENSE).

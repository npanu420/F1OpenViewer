# The First Open Source Desktop client for **F1 TV**

# F1 OpenViewer by panu420
Official login, entitlement, and DRM (Widevine) playback in an Electron app. Authorized access only — no piracy.

**Detailed setup instructions:** [docs/SETUP.md](docs/SETUP.md) — clone, configure `.env`, run in dev, build and sign.

For **build and signing** (code signing, Widevine VMP, certificates): [docs/BUILD_SIGNING.md](docs/BUILD_SIGNING.md).

---

## What it does

- **Authorized access** — Sign in with your F1 TV account (email/password, token, or in-app browser login).
- **DRM playback** — Stream protected content via Widevine CDM in a compliant way.
- **No unauthorized content** — No keys, bypasses, or stream sharing.

---

## Tech stack

- **Electron** (Castlabs fork for Widevine) — desktop shell, CDM handling, IPC to avoid CORS.
- **React + Vite** — UI.
- **Shaka Player** — DASH/HLS and Widevine DRM.
- **Unofficial F1 TV APIs** — login at `api.formula1.com`, catalog/playback via `@exhumer/f1tv-api` (f1tv.formula1.com).

---

## Requirements

- **Node.js** (LTS recommended)
- **Valid F1 TV subscription**
- **Windows** (Widevine path is documented for Windows; other OS may need manual CDM setup)

---

## Security

- **Sensitive config in `.env`** — License servers, CDM paths, etc. go in `.env` (or environment); `.env` is in `.gitignore`.
- **`.env.example`** — Contains only variable names and comments; copy to `.env` and fill in locally.

---

## Roadmap

1. **Login / Auth** (Milestone 1) — Done: login UI, session token in memory, network layer.
2. **Entitlement / Licenses** (Milestone 2) — Entitlement, asset/manifest selection, permissions and expiry.
3. **DRM playback** (Milestone 3) — End-to-end playback with real licenses.
--WE ARE HERE--
4. **UI and UX improvements** — New UI and better UX
5. **Live Timing** — Live Timing support for lives and replays

---

## Contact Me

Github: github.com/panu420
Discord: @Ovetto
Mail: biliardocancelli@gmail.com

---

## AI disclaimer

AI was used in this project for **repetitive code** (e.g. login flows and boilerplate) and, in particular, for **translating the application, READMEs and code comments into English** so that documentation and code are easier to understand for everyone. Core logic and architecture remain human-authored.

---

## License

MIT — see [LICENSE](LICENSE).

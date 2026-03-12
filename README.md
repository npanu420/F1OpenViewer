# F1 OpenViewer

Desktop client for **F1 TV**: official login, entitlement, and DRM (Widevine) playback in an Electron app. Authorized access only — no piracy.

**Beginner-friendly setup (English):** [SETUP.md](SETUP.md) — clone, configure `.env`, test build, create certificate, build and sign for DRM.

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

## Quick start

```bash
git clone https://github.com/YOUR_USER/F1OpenViewer.git
cd F1OpenViewer

npm install
cp .env.example .env
# Edit .env and set Widevine path/version (see Configuration below)

npm run dev
```

---

## Build

| Command | Description |
|--------|-------------|
| `npm run build` | Build without signing. Output: `release/` (installer + portable). DRM will not work. |
| `npm run build:signed` | Build with code signing, then VMP signing. Use for DRM playback. See [SETUP.md](SETUP.md). |

Signed builds (code signing + Widevine VMP) are required for DRM; see [docs/BUILD_SIGNING.md](docs/BUILD_SIGNING.md) for details.

---

## Configuration (`.env`)

Copy `.env.example` to `.env` and adjust as needed.

**Electron**

- `ELECTRON_OPEN_DEVTOOLS` — Open DevTools in development (default: `false`).
- `ELECTRON_RELAX_CORS` — Relax CORS in dev (default: `false`).

**Widevine CDM (needed for DRM)**

- `ELECTRON_WIDEVINE_CDM_PATH` — Folder containing `widevinecdm.dll` (e.g. from a Chrome install).
- `ELECTRON_WIDEVINE_CDM_VERSION` — Widevine version string (e.g. `4.10.2934.0` from `manifest.json` in the WidevineCdm folder).

Without these, the app may show error 6001 on protected content. Step-by-step instructions to find path and version on Windows are in `.env.example`.

---

## Security

- **Sensitive config in `.env`** — License servers, CDM paths, etc. go in `.env` (or environment); `.env` is in `.gitignore`.
- **`.env.example`** — Contains only variable names and comments; copy to `.env` and fill in locally.

---

## Roadmap

1. **Login / Auth** (Milestone 1) — Done: login UI, session token in memory, network layer.
2. **Entitlement / Licenses** (Milestone 2) — Entitlement, asset/manifest selection, permissions and expiry.
3. **DRM playback** (Milestone 3) — End-to-end playback with real licenses, retry, telemetry, and UX.

---

## AI disclaimer

AI was used in this project for **repetitive code** (e.g. login flows and boilerplate) and, in particular, for **translating READMEs and code comments into English** so that documentation and code are easier to understand for everyone. Core logic and architecture remain human-authored.

---

## License

MIT — see [LICENSE](LICENSE).

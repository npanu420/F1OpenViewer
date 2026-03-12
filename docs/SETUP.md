# F1 OpenViewer — Setup guide (English)

This guide walks you through cloning the repo, configuring the app, building a test version (without signing), and then building a signed version so that **DRM-protected F1 TV content** works.

For **detailed build and signing instructions** (certificates, Widevine VMP, Castlabs EVS): see [BUILD_SIGNING.md](BUILD_SIGNING.md) in this folder.

---

## What you need before starting

- **Node.js** (LTS recommended) — [nodejs.org](https://nodejs.org)
- **Git** — [git-scm.com](https://git-scm.com)
- **F1 TV subscription** — you will log in with your own account inside the app
- **Windows** — this guide focuses on Windows; the app may work on other OS with minor changes

---

## Step 1 — Clone the repository

Open a terminal (PowerShell or Command Prompt) and run:

```bash
git clone https://github.com/npanu420/F1OpenViewer.git
cd F1OpenViewer
```



## Step 2 — Install dependencies

In the same folder (`F1OpenViewer`), run:

```bash
npm install
```

This installs Node packages and downloads the Electron build used by the project. It may take a few minutes.

---

## Step 3 — Set up the `.env` file

The app uses a `.env` file for configuration (no secrets are stored in the repo).

1. **Copy the example file**
   - Windows (Command Prompt): `copy .env.example .env`
   - Windows (PowerShell): `Copy-Item .env.example .env`
   - macOS/Linux: `cp .env.example .env`

2. **Edit `.env`** with any text editor.

3. **Widevine (required for DRM playback)**  
   For F1 TV DRM streams to work, you need to point the app to the Widevine CDM. If you have **Google Chrome** installed on Windows:

   - **Path:** Open File Explorer and go to:  
     `C:\Program Files\Google\Chrome\Application\`  
     Then open the folder with numbers (e.g. `145.0.7632.162`). The path to use is:  
     `C:\Program Files\Google\Chrome\Application\THAT_NUMBER\WidevineCdm\_platform_specific\win_x64`  
     (Replace `THAT_NUMBER` with the folder name you see. Make sure the folder contains `widevinecdm.dll`.)

   - **Version:** In the parent folder `WidevineCdm` (one level above `_platform_specific`), open `manifest.json` and find the line with `"version": "4.10.2934.0"`. The value in quotes is your version.

   - In `.env`, set:
     ```env
     ELECTRON_WIDEVINE_CDM_PATH=C:\Program Files\Google\Chrome\Application\THAT_NUMBER\WidevineCdm\_platform_specific\win_x64
     ELECTRON_WIDEVINE_CDM_VERSION=4.10.2934.0
     ```
     (Use your actual path and version.)

   The comments inside `.env.example` have more detail if your Chrome is installed elsewhere (e.g. User Data folder).

You can leave the other options in `.env` as they are for now.

---

## Step 4 — Run in development (optional)

To run the app in development mode (with hot reload):

```bash
npm run dev
```

The app window will open and load the UI from the local dev server. You can log in with your F1 TV account and browse; DRM playback may still be limited in dev depending on your setup.

---

## Step 5 — Build for test (no signing)

To build the app **without** code signing or DRM (VMP) signing:

```bash
npm run build
```

- The build finishes and creates:
  - **Installer:** `release\F1 OpenViewer Setup 1.0.0.exe`
  - **Portable app:** `release\win-unpacked\F1 OpenViewer.exe`

- You can run the installer or the `.exe` directly. The app will work for browsing and login.

- **DRM-protected videos will not play** (or will show license errors). That is expected: without signing, the F1 TV license server rejects the app. This build is useful to check that the app runs and that the UI works.

---

## Step 6 — Create a self-signed certificate (for signing the app)

To get a **signed** build so that DRM works, you need a code-signing certificate. For personal or test use, you can create a **self-signed** certificate on Windows.

1. Open **PowerShell** (no need to run as Administrator).

2. Run the following commands. Replace `PASSWORD` with a password you choose (you will use it again when building):

   ```powershell
   $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=F1 OpenViewer Dev" -CertStoreLocation "Cert:\CurrentUser\My" -NotAfter (Get-Date).AddYears(3)
   $pwd = ConvertTo-SecureString -String "PASSWORD" -Force -AsPlainText
   Export-PfxCertificate -Cert $cert -FilePath "$env:USERPROFILE\Desktop\f1openviewer-dev.pfx" -Password $pwd
   ```

   **Important:** Use exactly `Cert:\CurrentUser\My` for `CertStoreLocation`. Do not use a normal folder path (e.g. `C:\...\certificatoBuildF1`) or you will get “Access denied”.

3. A file **`f1openviewer-dev.pfx`** (or the name you used) will appear on your Desktop. Remember its path and the password you set.

---

## Step 7 — Build and sign (so DRM works)

**Recommended approach: `npm run build:signed`**

Use **`npm run build:signed`** to build the app and then run the VMP (Widevine) signing in one go. This command runs the script in the **`scripts/`** folder (`scripts/build-and-sign-vmp.js`): it first runs a normal build (with VMP signing disabled during the build), then runs the VMP signing step on the built app. **This is the approach we recommend.** The alternative — building with `npm run build` and having signing run automatically during the build — did not work reliably in our experience (e.g. the build hangs on "Requesting VMP signature" or the EVS step never completes). So we recommend always using `npm run build:signed` and the script in `scripts/` for a signed, DRM-capable build.

**Why we use "build first, then sign"**

- During the build, electron-builder can run a "VMP signing" step that talks to Castlabs' servers. That step often **hangs** when run automatically from the build (no way to prompt for EVS login, or timeouts). Running the build without VMP, then signing afterwards via the script in `scripts/`, avoids that: you can log in to Castlabs EVS in the terminal when the script asks, and the signing finishes correctly.

**What you need for the signed build**

1. **Certificate** from Step 6 (e.g. `f1openviewer-dev.pfx` on your Desktop).
2. **Castlabs EVS account** (free): install the EVS client and log in once:
   ```bash
   pip install castlabs-evs
   python -m castlabs_evs.account signup
   ```
   (Or `reauth` if you already have an account.) Follow the prompts and confirm your email.

3. **Windows Developer Mode** (recommended):  
   Settings → Privacy & security → For developers → turn **Developer mode** **On**.  
   If you skip this, you may see an error about “symbolic link” when building; enabling Developer mode usually fixes it.

**Run the build-and-sign script** (in the project root)

1. Set your certificate and password (PowerShell). Use the **real path** to your `.pfx` and the password you chose:

   ```powershell
   $env:CSC_LINK = "C:\Users\YourUsername\Desktop\f1openviewer-dev.pfx"
   $env:CSC_KEY_PASSWORD = "YourPassword"
   ```

2. Run the script that builds and then signs (it lives in **`scripts/build-and-sign-vmp.js`**):

   ```powershell
   npm run build:signed
   ```

   This script (in the **`scripts/`** folder):

   - Runs `npm run build` with **VMP signing disabled** during the build (so the build does not hang).
   - After the build finishes, it runs the **VMP signing** step on the built app folder (`release\win-unpacked`). This step can ask for your Castlabs login if needed; because it runs in your terminal, you can type your credentials.

   If the output stays on **"Requesting VMP signature"**, we recommend **just waiting**, for up to **3–5 minutes**; the step often takes that long and then completes.

3. When it completes, you will see something like:  
   `[build-and-sign-vmp] Build e firma VMP completate.`

**Where to find the signed app**

- **Portable (signed, DRM-capable):**  
  `release\win-unpacked\F1 OpenViewer.exe`  
  This is the one that has been VMP-signed and can play DRM content.

- **Installer:**  
  `release\F1 OpenViewer Setup 1.0.0.exe`  
  This installer was created before the VMP signing step, so the exe inside it is not VMP-signed. For DRM playback, use the exe in `release\win-unpacked` directly, or run the build script again and then create a new installer if your build process supports that.

---

## Quick reference

| Goal                         | Command / Step                                                                 |
|-----------------------------|-------------------------------------------------------------------------------|
| Run in development           | `npm run dev`                                                                 |
| Build for test (no DRM)     | `npm run build` → run `release\win-unpacked\F1 OpenViewer.exe` or the installer |
| Build + sign (DRM works)    | Set `CSC_LINK` and `CSC_KEY_PASSWORD`, then `npm run build:signed`             |
| Signed app (DRM)            | `release\win-unpacked\F1 OpenViewer.exe`                                       |

---

## App icon (logo)

To use a custom logo for the app:

- **Icona nella finestra** (barra del titolo): metti un file `icon.png` o `icon.ico` nella cartella **`electron/`**. L’app userà la prima che trova.
- **Icona dell’eseguibile e dell’installer** (Windows): metti un file **`build/icon.ico`** nella root del progetto. electron-builder lo userà per l’exe e per l’installer NSIS. Formato consigliato: .ico con più dimensioni (es. 256×256, 48×48, 32×32, 16×16).

Se `build/icon.ico` o `electron/icon.png` / `electron/icon.ico` non esistono, l’app funziona comunque con l’icona predefinita di Electron.

---

## Troubleshooting

- **“Cannot create symbolic link” during build**  
  Enable **Developer mode** in Windows (see Step 7). Then delete the cache and build again:
  ```powershell
  Remove-Item -Recurse -Force "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign" -ErrorAction SilentlyContinue
  npm run build
  ```

- **“Access denied” when creating the certificate**  
  Use `Cert:\CurrentUser\My` as in Step 6. Do not use a normal disk path for `CertStoreLocation`.

- **Gray or blank window in the built app**  
  Make sure you did a fresh build after the project was updated (the build uses `base: './'` so that assets load correctly from the packaged app).

- **DRM / 403 license errors**  
  Use the **signed** build (`npm run build:signed` and then run `release\win-unpacked\F1 OpenViewer.exe`). Ensure you are logged in with “Sign in with browser” (or equivalent) so that the app has the right cookies for the license server.

For more details on signing and certificates, see **docs/BUILD_SIGNING.md**.

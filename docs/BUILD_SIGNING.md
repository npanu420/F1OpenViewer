# Signed build (code signing + Widevine VMP)

There are **two types of signing** useful for F1 OpenViewer:

1. **Code signing** — signing the executable (Windows/macOS) so the system and user recognise the app (no “Unknown publisher”).
2. **Widevine VMP signing** — required for the F1 TV server to accept DRM licenses (avoids `DEVELOPMENT_CERTIFICATE_NOT_ALLOWED`).

---

## Recommended: build then sign with `npm run build:signed`

**We recommend** using **`npm run build:signed`** to build the app and then run the VMP (Widevine) signing in one go **on Windows**: the script in **`scripts/build-and-sign-vmp.js`** runs a normal build (with EVS during `afterSign` disabled via `SKIP_EVS_SIGN`), then runs **`castlabs_evs.vmp sign-pkg`** on **`release/win-unpacked`**. **On macOS**, the same command only runs **`npm run build`** and exits — you must run VMP **manually** on the folder that contains the `.app` (e.g. `release/mac-arm64`); see [§2.4](#24-vmp-sign-the-build). **This approach is recommended** on Windows because building with `npm run build` and having EVS run inside the build did not work reliably in our experience (e.g. the build hangs on "Requesting VMP signature" or the EVS step never completes). See [SETUP.md](SETUP.md) for the full step-by-step (certificate, EVS account, `CSC_LINK` / `CSC_KEY_PASSWORD`, then `npm run build:signed`). If during `npm run build:signed` on Windows the output stays on **"Requesting VMP signature"**, we recommend **just waiting**, for up to **3–5 minutes**; the step often takes that long and then completes.

---

## 1. Code signing (executable signing)

### Windows

- You need an **Authenticode** certificate (`.pfx` / `.p12`), e.g. from:
  - A commercial CA (DigiCert, Sectigo, etc.)
  - Or a **development** (self-signed) certificate for testing only
- Set the environment variables (or use them in CI):

**Command Prompt (CMD):**
```cmd
set CSC_LINK=C:\path\to\certificate.pfx
set CSC_KEY_PASSWORD=your_certificate_password
```

**PowerShell:** (use `$env:` — otherwise the variable is not set)
```powershell
$env:CSC_LINK = "C:\path\to\certificate.pfx"
$env:CSC_KEY_PASSWORD = "your_certificate_password"
```

**If you don't have a .pfx**

- **Just to use the app**: you can build **without** setting `CSC_LINK` / `CSC_KEY_PASSWORD`. The installer and exe will not be signed; Windows may show “Unknown publisher” but the app works. You can still do VMP (EVS) signing manually after the build (see below).
- **For a test (self-signed) certificate** on Windows, in PowerShell (no admin required):

```powershell
# CertStoreLocation MUST be "Cert:\CurrentUser\My" (certificate store), NOT a disk folder (otherwise: Access denied)
$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=F1 OpenViewer Dev" -CertStoreLocation "Cert:\CurrentUser\My" -NotAfter (Get-Date).AddYears(3)

# Export to .pfx (replace PASSWORD with a password of your choice)
$pwd = ConvertTo-SecureString -String "PASSWORD" -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath "$env:USERPROFILE\Desktop\f1openviewer-dev.pfx" -Password $pwd
```

The `.pfx` file ends up on your Desktop. Use that path in `CSC_LINK` and the password in `CSC_KEY_PASSWORD`. The exe will be “signed” but Windows/SmartScreen will not trust it like a commercial CA certificate; fine for development and for pairing with VMP signing.

- **For serious distribution**: you need a certificate from a CA (e.g. DigiCert, Sectigo), paid.

- To build and sign: we recommend **`npm run build:signed`** (uses the script in `scripts/` to build then run VMP signing). If you only want code signing without VMP, you can run:

```bash
npm run build
```

electron-builder will automatically sign the exe and NSIS installer when `CSC_LINK` and `CSC_KEY_PASSWORD` are set. For DRM (Widevine) to work you still need VMP signing afterwards; use `npm run build:signed` for the full flow (see "Recommended" section above).

- On macOS/Linux to build a signed Windows installer you can use `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`.

**Error «Cannot create symbolic link: A required privilege is not held by the client» (winCodeSign .7z)**  
On Windows, extracting the winCodeSign package fails because the archive contains symlinks (for macOS build). You can:

1. **Enable Developer mode** (recommended): Settings → Privacy & security → For developers → **Developer mode** = On. Then delete the cache and run the build again:
   ```powershell
   Remove-Item -Recurse -Force "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign" -ErrorAction SilentlyContinue
   npm run build
   ```
2. **Run PowerShell as Administrator**: right-click PowerShell → Run as administrator, go to the project folder, set `$env:CSC_LINK` and `$env:CSC_KEY_PASSWORD` again, delete the winCodeSign cache as above and run `npm run build`.

### macOS

- You need an **Apple Developer ID** (“Developer ID Application” certificate).
- Set for example:

```bash
export CSC_LINK="file:///path/to/Developer ID Application.p12"
export CSC_KEY_PASSWORD="password"
export CSC_NAME="Developer ID Application: Name (TEAM_ID)"
```

- Then run **`npm run build`** on macOS (or `npm run build:signed` — see below).

**Widevine VMP on macOS:** `scripts/build-and-sign-vmp.js` runs the Castlabs EVS step **only on Windows** (`release/win-unpacked`). On macOS it stops after the build and prints a reminder to run VMP **manually** (see [§2.4 macOS](#24-vmp-sign-the-build)). You still need **`pip install castlabs-evs`** and **`python -m castlabs_evs.account reauth`** for that step.

---

## 2. Widevine VMP signing (Castlabs EVS)

The build with Electron castLabs is already signed for **development** (Widevine UAT). For **production** (e.g. F1 TV servers that reject the development certificate) you need a production VMP signature via Castlabs’ **EVS** service (free, with registration).

### Steps

#### 2.1 Install the EVS client (Python 3.7+)

```bash
python -m pip install --upgrade castlabs-evs
```

(Optional: use a virtualenv.)

#### 2.2 Create an EVS account

```bash
python -m castlabs_evs.account signup
```

Follow the prompts (email, name, organisation, account name, password). Confirm the account with the code received by email.

#### 2.3 Login (on another PC or after changing account)

```bash
python -m castlabs_evs.account reauth
```

#### 2.4 VMP sign the build

- **Windows**: The **recommended** way is **`npm run build:signed`** (script in `scripts/build-and-sign-vmp.js`): it builds with code signing, then runs VMP signing on the built app. That avoids the build hanging when EVS runs during the build. Alternatively, you can build with `npm run build` and then run VMP signing manually as below. VMP signing must be done **after** code signing.  
  After `npm run build` you will have e.g. `release/win-unpacked/` with the exe already code-signed. Run:

```bash
python3 -m castlabs_evs.vmp sign-pkg path/to/release/win-unpacked
```

Replace `path/to/release/win-unpacked` with the actual path (e.g. `.\release\win-unpacked` on Windows).

**If you use `npm run build:signed`** and the output stays on "Requesting VMP signature", we recommend **just waiting** for up to **3–5 minutes**; the step often takes that long and then completes.

**If VMP signing hangs during the build** (stuck on “Requesting VMP signature”): the build skips EVS signing after ~35 s and continues. To skip it entirely and have a faster build, set before building:

```powershell
$env:SKIP_EVS_SIGN = "1"
npm run build
```

Then run VMP signing **manually** in another terminal (after the build has finished):

```powershell
python -m castlabs_evs.vmp sign-pkg release\win-unpacked
```

**`npm run build:signed` uses `--force` by default** so each new build always gets a fresh VMP signature from EVS. A stale cached signature (from a previous build) no longer matches the new exe and causes DRM 403 / ACN_5002 on Widevine-protected content (e.g. 2026 on-demand races).

If EVS is unreachable (VPN/firewall blocking `evs-api.castlabs.com`), set `SKIP_VMP_FORCE=1` to fall back to the cached signature:

```powershell
$env:SKIP_VMP_FORCE = "1"
npm run build:signed
```

To run the sign step manually with `--force`:

```powershell
py -m castlabs_evs.vmp sign-pkg --force release\win-unpacked
```

For apps that also support offline download you can use `--persistent`:

```bash
python3 -m castlabs_evs.vmp sign-pkg --persistent path/to/release/win-unpacked
```

- **macOS (manual VMP):** `castlabs_evs.vmp sign-pkg` does **not** take the path to the `.app` bundle. It expects the **same directory electron-builder uses as output for that target** — the folder that **contains** `F1 OpenViewer.app` (electron-builder’s `appOutDir`), for example:
  - **Apple Silicon:** `release/mac-arm64`
  - **Intel:** often `release/mac` (name depends on arch / your `package.json` build config)

```bash
# Correct: directory that contains F1 OpenViewer.app
python3 -m castlabs_evs.vmp sign-pkg --force "/path/to/project/release/mac-arm64"
```

Passing the `.app` itself (e.g. dragging `F1 OpenViewer.app` into the terminal) causes **`FileNotFoundError: No matching executable found`**, because the tool looks for `*.app` **inside** the path you give, and searches for the Electron Framework there.

**macOS — signing order:** EVS signs binaries inside the bundle (e.g. `Electron Framework`). **Apple code signing must include those files**, so either:

1. **Preferred:** build an **unsigned** app (do not set `CSC_*`), run `sign-pkg` on `release/mac-arm64` (or `release/mac`), then **code sign and notarize** the `.app` yourself; or  
2. Run **`npm run build`** with Developer ID so electron-builder signs first, then run `sign-pkg` on the output folder above, then **re-sign the whole `.app`** (VMP changes files after the first signature) and notarize if you ship to users.

The `afterSign` hook in this repo runs EVS **only on Windows**; macOS is not signed by EVS during the build.

#### 2.5 Connection errors (evs-api.castlabs.com unreachable or reset)

If **`npm run build:signed`** fails with **"Request for upload URL failed"**, **"Failed to resolve 'evs-api.castlabs.com'"**, or **"Connection aborted / ConnectionResetError (10054)"**, your network (or firewall/antivirus/VPN) is blocking or resetting the connection to CastLabs. The script will retry **without** `--force` (using the cached signature) so the build still completes, but the cached signature may not match the new exe → **DRM 403** when playing.

**What to do:**

1. **Run the sign step from a network where CastLabs is reachable**  
   Build locally as usual (or set `SKIP_VMP_FORCE=1` to skip the failing `--force` attempt and save time). Copy the folder `release/win-unpacked` to another PC or a network where you can reach the internet without VPN/firewall blocking it, then run:
   ```powershell
   py -m castlabs_evs.vmp sign-pkg --force release/win-unpacked
   ```
   Copy the signed exe back if needed.

2. **Skip the --force attempt locally**  
   If you know your network always blocks evs-api.castlabs.com, set before building:
   ```powershell
   $env:SKIP_VMP_FORCE = "1"
   npm run build:signed
   ```
   The script will only use the cache (no connection to CastLabs). You still need to run the sign with `--force` somewhere else (see above) for DRM to work.

3. **Temporarily disable VPN/firewall/antivirus** for the sign step only, then run:
   ```powershell
   py -m castlabs_evs.vmp sign-pkg --force release/win-unpacked
   ```
   Re-enable them after.

Running as Administrator does not fix connection/DNS issues; the problem is network access to **evs-api.castlabs.com**.

#### 2.6 "Verified media path has been tampered" (Widevine VMP)

If you see **"F1 TV: Widevine license generation failed >> Verified media path has been tampered"** (or similar), the Widevine CDM has detected that the executable was **modified after VMP signing**. Any change to the exe after Castlabs EVS signs it invalidates the Verified Media Path.

**Common cause:** The project previously re-applied the app icon to the exe *after* VMP signing (via `rcedit` in the afterSign hook). That modification triggered the tamper check. This has been removed: the icon is applied only in `afterPack` (before code sign and before any VMP step), so the exe is never modified after VMP.

**What to do:**

1. **Use the correct exe** — Run **`release\win-unpacked\F1 OpenViewer.exe`** (the one that was VMP-signed). Do **not** run the app from the NSIS installer if the installer was built before the VMP step: the installed exe may not be VMP-signed, or may have been overwritten by a copy that was modified after signing.
2. **Do not modify the exe after VMP** — Do not run any tool (rcedit, resource editors, etc.) on the exe after `castlabs_evs.vmp sign-pkg`. If you need to change the icon, do it in `afterPack` (see `scripts/apply-exe-icon.js`) so it happens before code sign and VMP.
3. **Rebuild and re-sign** — Build with `npm run build:signed` so that VMP is applied to the final exe with no subsequent modifications. If you had previously applied the icon after VMP, do a clean build and use the new exe from `release\win-unpacked`.

#### 2.7 DRM 403 / ACN_5002 (license rejected)

If you see "DRM license rejected by server (error 403 / ACN_5002)" with a build that previously worked:

1. **Session/token expiry (most common)** — F1 TV session tokens (ascendon/entitlement) often expire after a few hours. The same build can work in the morning and return 403 in the afternoon; the server may report it like an uncertified client. The app now **refreshes the session before each playback** (and retries once on 403). If it still fails, **sign in again** with "Sign in with browser" and retry.
2. **Re-sign with a fresh VMP signature** — If re-login does not help, the binary may no longer match the cached EVS signature. On **Windows**, run `npm run build:signed` (uses `--force` by default), or manually: `py -m castlabs_evs.vmp sign-pkg --force release\win-unpacked`. On **macOS**, run `python3 -m castlabs_evs.vmp sign-pkg --force` on the folder that **contains** `F1 OpenViewer.app` (e.g. `release/mac-arm64`), then **re-sign** the `.app` if you had already code-signed it (see §2.4).
3. **Ensure the license proxy receives the right headers** — The app forwards `drmToken`, `Authorization`, and entitlement headers from the player to the F1 license server. If you use a custom build, ensure the main process license proxy is used (dashboard and player both use it when `licenseUrl` is rewritten to the local proxy).

**macOS (same DRM issues):** If VMP is missing or stale, re-run EVS on the **output folder** (not the `.app`), with `--force` when the network allows:

```bash
python3 -m castlabs_evs.vmp sign-pkg --force "/path/to/project/release/mac-arm64"
```

After that, if you had already code-signed the app, **re-sign** the bundle so Gatekeeper matches the VMP-updated binaries.

### Automation (Windows): afterSign hook

You can run VMP signing right after code signing using electron-builder’s **afterSign** hook. That way the folder used to create the NSIS installer will already contain the exe signed with VMP too.

1. Create a script that receives the context and runs EVS on the app directory (see below).
2. In `package.json`, in the `build` section, add:

```json
"afterSign": "scripts/evs-after-sign.js"
```

3. Make sure `castlabs-evs` is installed (`pip install castlabs-evs`) and you have logged in to EVS (`python3 -m castlabs_evs.account reauth`) before building.

The script `scripts/evs-after-sign.js` calls `castlabs_evs.vmp sign-pkg` on `context.appOutDir` **on Windows only**, so the order “code sign first, then VMP” matches Castlabs’ guidance for Windows. **macOS** is not handled in that hook; use the manual path and folder described in [§2.4 macOS](#24-vmp-sign-the-build).

---

## Signing order summary

| Platform  | Correct order |
|-----------|----------------|
| **Windows** | 1) Code signing (electron-builder) → 2) VMP signing (EVS `sign-pkg` on `release/win-unpacked`) |
| **macOS**   | 1) VMP signing (EVS `sign-pkg` on the folder **containing** `F1 OpenViewer.app`, e.g. `release/mac-arm64`) → 2) Apple code signing / notarization of the whole `.app` **if** you started from an unsigned build; **if** you already signed with electron-builder, run VMP then **re-sign** the bundle. |

**`sign-pkg` path:** Always pass the **directory that contains the `.app`**, not `Something.app` itself (see §2.4).

---

## References

- [electron-builder – Code signing](https://www.electron.build/code-signing)
- [Castlabs EVS (VMP signing)](https://github.com/castlabs/electron-releases/wiki/EVS)
- [Castlabs VMP (explanation)](https://github.com/castlabs/electron-releases/wiki/VMP)

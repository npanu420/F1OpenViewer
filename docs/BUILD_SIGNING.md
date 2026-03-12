# Signed build (code signing + Widevine VMP)

There are **two types of signing** useful for F1 OpenViewer:

1. **Code signing** — signing the executable (Windows/macOS) so the system and user recognise the app (no “Unknown publisher”).
2. **Widevine VMP signing** — required for the F1 TV server to accept DRM licenses (avoids `DEVELOPMENT_CERTIFICATE_NOT_ALLOWED`).

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

- Then run the build as usual:

```bash
npm run build
```

electron-builder will automatically sign the exe and NSIS installer when `CSC_LINK` and `CSC_KEY_PASSWORD` are set.

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

- Then `npm run build` on macOS.

---

## 2. Widevine VMP signing (Castlabs EVS)

The build with Electron castLabs is already signed for **development** (Widevine UAT). For **production** (e.g. F1 TV servers that reject the development certificate) you need a production VMP signature via Castlabs’ **EVS** service (free, with registration).

### Steps

#### 2.1 Install the EVS client (Python 3.7+)

```bash
python3 -m pip install --upgrade castlabs-evs
```

(Optional: use a virtualenv.)

#### 2.2 Create an EVS account

```bash
python3 -m castlabs_evs.account signup
```

Follow the prompts (email, name, organisation, account name, password). Confirm the account with the code received by email.

#### 2.3 Login (on another PC or after changing account)

```bash
python3 -m castlabs_evs.account reauth
```

#### 2.4 VMP sign the build

- **Windows**: VMP signing must be done **after** code signing.  
  After `npm run build` you will have e.g. `release/win-unpacked/` with the exe already code-signed. Run:

```bash
python3 -m castlabs_evs.vmp sign-pkg path/to/release/win-unpacked
```

Replace `path/to/release/win-unpacked` with the actual path (e.g. `.\release\win-unpacked` on Windows).

**If VMP signing hangs during the build** (stuck on “Requesting VMP signature”): the build skips EVS signing after ~35 s and continues. To skip it entirely and have a faster build, set before building:

```powershell
$env:SKIP_EVS_SIGN = "1"
npm run build
```

Then run VMP signing **manually** in another terminal (after the build has finished):

```powershell
python -m castlabs_evs.vmp sign-pkg release\win-unpacked
```  
For apps that also support offline download you can use `--persistent`:

```bash
python3 -m castlabs_evs.vmp sign-pkg --persistent path/to/release/win-unpacked
```

- **macOS**: VMP signing must be done **before** code signing. So:
  1. Run the build (without code sign) or stop at the app folder (e.g. `release/mac/F1 OpenViewer.app`).
  2. VMP sign:

```bash
python3 -m castlabs_evs.vmp sign-pkg path/to/F1\ OpenViewer.app
```

  3. Then apply code signing (Developer ID certificate) to that app.

### Automation (Windows): afterSign hook

You can run VMP signing right after code signing using electron-builder’s **afterSign** hook. That way the folder used to create the NSIS installer will already contain the exe signed with VMP too.

1. Create a script that receives the context and runs EVS on the app directory (see below).
2. In `package.json`, in the `build` section, add:

```json
"afterSign": "scripts/evs-after-sign.js"
```

3. Make sure `castlabs-evs` is installed (`pip install castlabs-evs`) and you have logged in to EVS (`python3 -m castlabs_evs.account reauth`) before building.

The example script `scripts/evs-after-sign.js` (if present in the repo) calls `castlabs_evs.vmp sign-pkg` on `context.appOutDir` on Windows only, so the order “code sign first, then VMP” is respected.

---

## Signing order summary

| Platform  | Correct order |
|-----------|----------------|
| **Windows** | 1) Code signing (electron-builder) → 2) VMP signing (EVS `sign-pkg`) |
| **macOS**   | 1) VMP signing (EVS `sign-pkg`) → 2) Code signing |

---

## References

- [electron-builder – Code signing](https://www.electron.build/code-signing)
- [Castlabs EVS (VMP signing)](https://github.com/castlabs/electron-releases/wiki/EVS)
- [Castlabs VMP (explanation)](https://github.com/castlabs/electron-releases/wiki/VMP)

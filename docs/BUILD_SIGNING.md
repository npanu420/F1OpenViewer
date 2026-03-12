# Build firmata (code signing + Widevine VMP)

Ci sono **due tipi di firma** utili per F1 OpenViewer:

1. **Code signing** — firma dell’eseguibile (Windows/macOS) così il sistema e l’utente riconoscono l’app (niente “Autore sconosciuto”).
2. **Firma VMP Widevine** — richiesta per far accettare le licenze DRM dal server F1 TV (evita l’errore `DEVELOPMENT_CERTIFICATE_NOT_ALLOWED`).

---

## 1. Code signing (firma dell’eseguibile)

### Windows

- Serve un certificato **Authenticode** (`.pfx` / `.p12`), ad esempio da:
  - CA commerciale (DigiCert, Sectigo, ecc.)
  - Oppure certificato per **firma di sviluppo** (self-signed) solo per test
- Imposta le variabili d’ambiente (o usale nella CI):

**Prompt dei comandi (CMD):**
```cmd
set CSC_LINK=C:\path\to\certificate.pfx
set CSC_KEY_PASSWORD=tua_password_certificato
```

**PowerShell:** (usa `$env:` — senza non imposti la variabile)
```powershell
$env:CSC_LINK = "C:\path\to\certificate.pfx"
$env:CSC_KEY_PASSWORD = "tua_password_certificato"
```

**Se non hai un .pfx**

- **Solo per usare l’app**: puoi fare la build **senza** impostare `CSC_LINK` / `CSC_KEY_PASSWORD`. L’installer e l’exe non saranno firmati; Windows può mostrare “Autore sconosciuto” ma l’app funziona. La firma VMP (EVS) puoi farla comunque a mano dopo la build (vedi sotto).
- **Per un certificato di test (self-signed)** su Windows, in PowerShell (non serve amministratore):

```powershell
# CertStoreLocation DEVE essere "Cert:\CurrentUser\My" (store certificati), NON una cartella del disco (altrimenti: Accesso negato)
$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=F1 OpenViewer Dev" -CertStoreLocation "Cert:\CurrentUser\My" -NotAfter (Get-Date).AddYears(3)

# Esporta in .pfx (sostituisci PASSWORD con una password a tua scelta)
$pwd = ConvertTo-SecureString -String "PASSWORD" -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath "$env:USERPROFILE\Desktop\f1openviewer-dev.pfx" -Password $pwd
```

Il file `.pfx` finisce sul Desktop. Usa quel path in `CSC_LINK` e la password in `CSC_KEY_PASSWORD`. L’exe risulterà “firmato” ma Windows/SmartScreen non lo considereranno attendibile come un certificato da CA commerciale; va bene per sviluppo e per abbinare la firma VMP.

- **Per distribuzione seria**: serve un certificato da una CA (es. DigiCert, Sectigo), a pagamento.

- Poi esegui la build come al solito:

```bash
npm run build
```

electron-builder firmerà automaticamente l’exe e l’installer NSIS quando `CSC_LINK` e `CSC_KEY_PASSWORD` sono impostate.

- Su macOS/Linux per costruire un installer Windows firmato puoi usare `WIN_CSC_LINK` e `WIN_CSC_KEY_PASSWORD`.

**Errore «Cannot create symbolic link : Il privilegio richiesto non appartiene al client» (winCodeSign .7z)**  
Su Windows, l’estrazione del pacchetto winCodeSign fallisce perché l’archivio contiene symlink (per build macOS). Puoi:

1. **Abilitare la Modalità sviluppatore** (consigliato): Impostazioni → Privacy e sicurezza → Per gli sviluppatori → **Modalità sviluppatore** = Attivata. Poi elimina la cache e rilancia la build:
   ```powershell
   Remove-Item -Recurse -Force "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign" -ErrorAction SilentlyContinue
   npm run build
   ```
2. **Eseguire PowerShell come Amministratore**: tasto destro su PowerShell → Esegui come amministratore, vai alla cartella del progetto, imposta di nuovo `$env:CSC_LINK` e `$env:CSC_KEY_PASSWORD`, elimina la cache winCodeSign come sopra e lancia `npm run build`.

### macOS

- Serve un **Apple Developer ID** (certificato “Developer ID Application”).
- Imposta ad esempio:

```bash
export CSC_LINK="file:///path/to/Developer ID Application.p12"
export CSC_KEY_PASSWORD="password"
export CSC_NAME="Developer ID Application: Nome (TEAM_ID)"
```

- Poi `npm run build` su macOS.

---

## 2. Firma VMP Widevine (Castlabs EVS)

La build con Electron castLabs è già firmata per **sviluppo** (Widevine UAT). Per la **produzione** (es. server F1 TV che rifiutano il certificato di sviluppo) serve una firma VMP di produzione tramite il servizio **EVS** di Castlabs (gratuito, con registrazione).

### Passi

#### 2.1 Installa il client EVS (Python 3.7+)

```bash
python3 -m pip install --upgrade castlabs-evs
```

(Opzionale: usa un virtualenv.)

#### 2.2 Crea un account EVS

```bash
python3 -m castlabs_evs.account signup
```

Segui i prompt (email, nome, organizzazione, account name, password). Conferma l’account con il codice ricevuto via email.

#### 2.3 Login (su un altro PC o dopo aver cambiato account)

```bash
python3 -m castlabs_evs.account reauth
```

#### 2.4 Firma VMP della build

- **Windows**: la firma VMP va fatta **dopo** il code signing.  
  Dopo `npm run build` avrai ad esempio `release/win-unpacked/` con l’exe già code-signed. Esegui:

```bash
python3 -m castlabs_evs.vmp sign-pkg path/to/release/win-unpacked
```

Sostituisci `path/to/release/win-unpacked` con il percorso reale (es. `.\release\win-unpacked` su Windows).

**Se la firma VMP si blocca durante la build** (resta su “Requesting VMP signature”): la build salta la firma EVS dopo ~35 s e prosegue. Per non eseguirla proprio e avere una build veloce, imposta prima di buildare:

```powershell
$env:SKIP_EVS_SIGN = "1"
npm run build
```

Poi firma VMP **a mano** in un altro terminale (dopo che la build è finita):

```powershell
python -m castlabs_evs.vmp sign-pkg release\win-unpacked
```  
Per app che supportano anche download offline puoi usare `--persistent`:

```bash
python3 -m castlabs_evs.vmp sign-pkg --persistent path/to/release/win-unpacked
```

- **macOS**: la firma VMP va fatta **prima** del code signing. Quindi:
  1. Fai la build (senza code sign) oppure fermati alla cartella dell’app (es. `release/mac/F1 OpenViewer.app`).
  2. Firma VMP:

```bash
python3 -m castlabs_evs.vmp sign-pkg path/to/F1\ OpenViewer.app
```

  3. Poi applica il code signing (certificato Developer ID) su quell’app.

### Automazione (Windows): hook afterSign

Puoi far eseguire la firma VMP subito dopo il code signing usando l’hook **afterSign** di electron-builder. In questo modo la cartella usata per creare l’installer NSIS conterrà già l’exe firmato anche con VMP.

1. Crea uno script che riceve il contesto e lancia EVS sulla directory dell’app (vedi sotto).
2. In `package.json`, nella sezione `build`, aggiungi:

```json
"afterSign": "scripts/evs-after-sign.js"
```

3. Assicurati che `castlabs-evs` sia installato (`pip install castlabs-evs`) e di aver fatto login EVS (`python3 -m castlabs_evs.account reauth`) prima della build.

Lo script di esempio `scripts/evs-after-sign.js` (se presente nel repo) invoca `castlabs_evs.vmp sign-pkg` su `context.appOutDir` solo su Windows, così l’ordine “prima code sign, poi VMP” è rispettato.

---

## Riepilogo ordine delle firme

| Piattaforma | Ordine corretto |
|-------------|------------------|
| **Windows** | 1) Code signing (electron-builder) → 2) Firma VMP (EVS `sign-pkg`) |
| **macOS**   | 1) Firma VMP (EVS `sign-pkg`) → 2) Code signing |

---

## Riferimenti

- [electron-builder – Code signing](https://www.electron.build/code-signing)
- [Castlabs EVS (VMP signing)](https://github.com/castlabs/electron-releases/wiki/EVS)
- [Castlabs VMP (spiegazione)](https://github.com/castlabs/electron-releases/wiki/VMP)

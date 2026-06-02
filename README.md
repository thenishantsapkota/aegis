# Aegis — Codes you carry

A privacy-first PWA for storing TOTP/HOTP authentication codes. Codes live
encrypted on your device with optional zero-knowledge cloud sync via Appwrite.
Installable on iOS, Android, and desktop.

## Stack

- **TanStack Start** + **TanStack Router** (file-based routing, SSR-capable)
- **Vite** + **vite-plugin-pwa** (offline-first PWA, installable on iOS, Android, desktop)
- **Tailwind CSS** for styling
- **Dexie** (IndexedDB) for on-device encrypted storage
- **WebCrypto** (PBKDF2 + AES-GCM) for encryption — your master password never leaves your device
- **Appwrite** for cloud account & encrypted vault sync (optional)
- **otpauth** for RFC 6238 TOTP / RFC 4226 HOTP code generation
- **@zxing/browser** for camera-based QR scanning

## Features

- 🔐 Master-password-encrypted vault (AES-256-GCM, PBKDF2 with 310k iterations)
- 📂 Folder organization with colors
- 📷 QR code scanning to import accounts
- ✍️ Manual entry with full TOTP/HOTP parameters
- 📤 Encrypted file export/import for moving between devices
- ☁️ Optional zero-knowledge cloud sync via Appwrite (server stores only ciphertext)
- 📱 Works on iOS, Android, and desktop as an installable PWA
- 🌚 Auto-locks when the app is backgrounded for 5+ minutes
- 🌓 Safe-area aware (iOS notch, Android gesture bar)

## Security model

- The master password is used to derive **two independent keys**:
  - `vaultKey` — never leaves the device; encrypts all TOTP secrets
  - `authPassword` (cloud sync only) — sent to Appwrite as the account password; Appwrite hashes it again (Argon2) before storing
- Salts are 16 random bytes (local) and SHA-256 of `email` (cloud auth) — the latter is deterministic so a fresh device can sign in without a round trip
- Folder names and issuer/account labels are stored in plaintext **on-device only**; when synced, the entire vault including labels is encrypted before upload
- A wrong password produces a decrypt failure — there is no recoverable backup. Save your password in a password manager.

## Getting started

### 1. Install

```bash
npm install
```

### 2. (Optional) Configure Appwrite for cloud sync

Skip this section if you only want local + file-based export.

1. Create a project at [appwrite.io](https://appwrite.io) (or self-host).
2. Create a Database with ID `vault`.
3. Inside it, create a **Table** with ID `vaults` and these attributes (camelCase exactly):
   - `cipherText` — String, size **5,000,000**, required
   - `version` — Integer, required, default `1`
   - `vaultKdfSalt` — String, size **256**, required
   - `vaultKdfIterations` — Integer, required
4. **Table permissions** → add role **Users** with only the **Create** action ticked. (Per-row read/update/delete permissions are set on each row by the client at write time.)
5. **Row Security** (a.k.a. Document Security on older builds): **Enabled**.
6. **Overview → Platforms** → add a Web platform with hostname `localhost` (and your prod domain later).
7. Copy `.env.example` to `.env` and fill in:

   ```
   VITE_APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
   VITE_APPWRITE_PROJECT_ID=...
   VITE_APPWRITE_DATABASE_ID=vault
   VITE_APPWRITE_TABLE_VAULTS=vaults
   ```

   > Appwrite renamed Collections → Tables in their newer SDKs. If you're on an older build
   > that still uses Collections, the env var `VITE_APPWRITE_COLLECTION_VAULTS` is also accepted.

### 3. Run

```bash
npm run dev
```

Open <http://localhost:5173>.

### 4. Build for production

```bash
npm run build
npm run start
```

## Installing as a PWA

- **Android (Chrome)**: tap the install prompt in the address bar, or "Add to home screen" from the menu.
- **iOS (Safari)**: tap the Share button → "Add to Home Screen". (Camera-based QR scanning works in Safari 14.3+ over HTTPS, including localhost.)
- **Desktop (Chrome/Edge)**: click the install icon in the address bar.

## Importing from other authenticator apps

In-app: **Settings → Import from another authenticator** (or **Add → "Bulk import"** link).

### Google Authenticator (most popular)
1. Open Google Authenticator on your old phone.
2. Menu (top-right) → **Transfer accounts** → **Export accounts**.
3. Pick the accounts to move → **Next**. Google will generate one or more QR codes.
4. In Aegis, **Import → Scan migration QR**, point your camera at each QR. Aegis collects them all.
5. Pick a folder, **Import N**.

### Authy
Authy doesn't expose a clean export. Easiest path: in each service (GitHub, Discord, etc.) → 2FA settings → set up a new authenticator → scan with Aegis (**Add → Scan QR**).

If you've extracted otpauth:// URIs from Authy's local DB another way, paste them in **Import → Paste URIs**, one per line.

### 2FAS Auth
1. 2FAS → Settings → Backup → Export → **unencrypted**.
2. Open the `.2fas`/`.json` file, copy each entry's `otp` URL.
3. Aegis → **Import → Paste URIs**, paste them (one per line) → **Parse & preview** → **Import N**.

### andOTP / Aegis (Android, different project)
Same as 2FAS — export plaintext JSON, build otpauth:// URIs from fields, paste.

### Microsoft Authenticator
No export available. Re-enroll each account: open the service's 2FA setup, scan its new QR in **Add → Scan QR**. For Microsoft work/school accounts, add Aegis as an *additional* method first so you don't lose access.

## Moving codes between Aegis devices

Two ways:

1. **File export/import** — Settings → "Export encrypted file". The file is encrypted with your master password. Move it via AirDrop / USB / email; on the new device, Settings → "Import from file" and enter the same password.
2. **Cloud sync** — Settings → "Enable cloud sync", create an account with your master password (which encrypts the vault before upload). On the other device, tap "Restore from cloud" on the unlock screen, sign in with the same email + password.

## Threat model & limitations

- An attacker with physical access to an unlocked device can read codes.
- An attacker who can run JavaScript in this app's origin can read codes after unlock (no protection against XSS in your hosting setup — keep the deployment surface tight).
- Appwrite admins can see your *ciphertext* and metadata (when you last synced, version number) but cannot recover your codes without your master password.
- We do not implement code-recovery questions, biometric unlock, or hardware-key wrapping in this version.

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
- 👥 Team (shared) OTP codes — end-to-end encrypted with a per-team key shared via public-key envelopes
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

**Team codes** add public-key envelope encryption on top:

- Each user has an RSA-OAEP keypair. The private key is wrapped with that user's `vaultKey` and stored in vault metadata; the public key is published in cleartext.
- Each team has a random AES-256 `teamKey` that encrypts the team's codes. Membership is a "grant": `teamKey` wrapped to each member's public key. Only that member's private key can unwrap it — the plaintext team key never reaches the server.
- Removing a member rotates the team key (re-encrypt + re-grant), so a removed member's cached key stops working for future changes.
- Because your private key is derived from your master password, losing the password also means losing team access — you'd need to be re-invited after resetting.

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

### 2b. (Optional) Enable team (shared) OTP codes

Teams let several people share a set of OTP codes while keeping zero-knowledge:
each team has its own random AES key, and a copy of that key is wrapped to every
member's public key. The plaintext team key never touches the server. This uses
Appwrite's native **Teams** feature plus three extra tables in the `vault` database.

1. **Auth → Teams** is enabled by default in Appwrite — no toggle needed. Members,
   roles (`owner` / `admin` / `member`) and email invites are handled here.
2. Add these three **Tables** to the `vault` database. For all of them, set
   **Row Security: Enabled** and give the **Users** role only the **Create**
   action (per-row permissions are set by the client — including team-scoped
   ones like "team members can read", which the app writes at creation time).

   **`publicKeys`** — one row per user, holding their RSA public key.
   - `userId` — String, size 64, required
   - `publicKeyJwk` — String, size **4000**, required

   **`teamVaults`** — one row per team, holding the encrypted shared codes.
   - `teamId` — String, size 64, required
   - `cipherText` — String, size **5,000,000**, required
   - `version` — Integer, required
   - `keyEpoch` — Integer, required (bumps when the team key is rotated)

   **`teamKeyGrants`** — one row per (team, member), the team key wrapped to that member.
   - `teamId` — String, size 64, required (add an **index** on this attribute)
   - `userId` — String, size 64, required (add an **index** on this attribute)
   - `wrappedKey` — String, size **2000**, required
   - `keyEpoch` — Integer, required

3. Add the table IDs to `.env`:

   ```
   VITE_APPWRITE_TABLE_PUBLIC_KEYS=publicKeys
   VITE_APPWRITE_TABLE_TEAM_VAULTS=teamVaults
   VITE_APPWRITE_TABLE_TEAM_GRANTS=teamKeyGrants
   ```

**How sharing works day to day**

- Open **Teams** (the people icon on the home screen) → **Create a team**. You
  become its owner and get the team key.
- **Invite by email.** Appwrite emails the person an accept link. They must have
  (or create) an Aegis cloud account with that same email. When they accept and
  open Aegis, their public key is published; the next time an owner/admin opens
  Teams and refreshes, the team key is granted to them automatically.
- **Add shared codes** from **Add → Save to → (your team)**. Only owners/admins
  can add or edit shared codes; members can view and use them.
- **Removing a member rotates the team key**: the shared vault is re-encrypted
  and re-granted to everyone remaining, so the removed member's cached key is
  useless going forward.

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

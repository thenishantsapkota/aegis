import { AppwriteException } from "appwrite";
import {
  appwrite,
  DATABASE_ID,
  ID,
  Permission,
  Role,
  VAULTS_TABLE_ID,
} from "./appwrite";
import {
  decryptJSON,
  deriveAuthProof,
  deriveVaultKey,
  encryptJSON,
  makeKeyCheck,
  newKdfParams,
  verifyKeyCheck,
  type EncryptedBlob,
  type KdfParams,
} from "./crypto";
import { db, getMeta, type VaultMeta } from "./db";
import {
  EXPORT_VERSION,
  isEncryptedExport,
  type EncryptedExport,
} from "./export";

// ---- Auth derivation --------------------------------------------------------
// `authPassword` is derived from (email, masterPassword) using a deterministic
// salt — that lets us sign in on a brand-new device without any pre-fetch.
// It is the ONLY thing sent to Appwrite. Appwrite itself hashes it again
// (Argon2 by default) before storing.

const AUTH_CONTEXT = "auth";
const VAULT_CONTEXT = "vault";

async function deriveAuthSalt(email: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode("vault-authenticator-auth-v1|" + email.toLowerCase());
  const hash = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hash);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function deriveAuthPassword(
  masterPassword: string,
  email: string,
): Promise<string> {
  const kdf: KdfParams = {
    algorithm: "PBKDF2",
    hash: "SHA-256",
    iterations: 310_000,
    salt: await deriveAuthSalt(email),
  };
  return deriveAuthProof(masterPassword, kdf, AUTH_CONTEXT);
}

// ---- Account flows ----------------------------------------------------------

export async function cloudSignUp(
  masterPassword: string,
  email: string,
): Promise<VaultMeta> {
  const meta = await getMeta();
  if (!meta) throw new Error("Initialize the local vault first.");

  // Master password must unlock the existing local vault.
  const vaultKey = await deriveVaultKey(
    masterPassword,
    meta.kdf,
    VAULT_CONTEXT,
  );
  if (!(await verifyKeyCheck(vaultKey, meta.keyCheck))) {
    throw new Error(
      "Password doesn't match this device's vault. Use the same master password.",
    );
  }

  const authPassword = await deriveAuthPassword(masterPassword, email);
  const { account } = appwrite();
  try {
    await account.create(ID.unique(), email, authPassword);
  } catch (e) {
    throw normalizeError(e, "Sign-up failed");
  }
  try {
    await safeCreateSession(email, authPassword);
  } catch (e) {
    throw normalizeError(e, "Sign-in after sign-up failed");
  }
  const user = await account.get();
  const linked: VaultMeta = {
    ...meta,
    email,
    userId: user.$id,
    sessionToken: "appwrite",
  };
  await db().meta.put(linked);

  // Auto-push the initial vault so this account isn't empty in the cloud.
  return await pushLocalVault(vaultKey);
}

// Create a brand-new cloud account AND a fresh local vault in one shot, for
// users who land on /setup and want cloud sync from day one — no separate
// "make local vault first, then link" dance. The empty vault is pushed up
// immediately so future devices can /restore.
export async function cloudSignUpFresh(
  masterPassword: string,
  email: string,
): Promise<{ meta: VaultMeta; vaultKey: CryptoKey }> {
  const authPassword = await deriveAuthPassword(masterPassword, email);
  const { account } = appwrite();
  try {
    await account.create(ID.unique(), email, authPassword);
  } catch (e) {
    throw normalizeError(e, "Sign-up failed");
  }
  try {
    await safeCreateSession(email, authPassword);
  } catch (e) {
    throw normalizeError(e, "Sign-in after sign-up failed");
  }
  const user = await account.get();

  const kdf = newKdfParams();
  const vaultKey = await deriveVaultKey(masterPassword, kdf, VAULT_CONTEXT);
  const keyCheck = await makeKeyCheck(vaultKey);
  const initialMeta: VaultMeta = {
    id: "vault",
    email,
    kdf,
    keyCheck,
    createdAt: Date.now(),
    remoteVersion: null,
    lastSyncedAt: null,
    sessionToken: "appwrite",
    userId: user.$id,
    biometric: null,
  };
  await db().meta.put(initialMeta);

  const pushed = await pushLocalVault(vaultKey);
  return { meta: pushed, vaultKey };
}

// Sign in on a device that already has a local vault. If the cloud has data,
// we adopt it wholesale — replacing local entries/folders/KDF/keyCheck with the
// cloud copy. This is what makes multi-device sync work: every device after
// the first ends up with the same KDF as the device that pushed first, so
// every device derives the same vault key and can decrypt the same blob.
//
// If the cloud has no data yet (rare — this is "sign in" not "sign up"), we
// link the account and push the local vault up.
export async function cloudSignInExisting(
  masterPassword: string,
  email: string,
): Promise<VaultMeta> {
  const meta = await getMeta();
  if (!meta) throw new Error("Initialize the local vault first.");

  const authPassword = await deriveAuthPassword(masterPassword, email);
  try {
    await safeCreateSession(email, authPassword);
  } catch (e) {
    throw normalizeError(e, "Sign-in failed");
  }
  const { account } = appwrite();
  const user = await account.get();
  const cloudRow = await getOrNullVaultRow(user.$id);

  if (cloudRow) {
    // Cloud has a vault — adopt it. Derive the key with the CLOUD'S KDF, not
    // ours, so we can decrypt the blob that was encrypted by another device.
    const cloudKdf: KdfParams = {
      algorithm: "PBKDF2",
      hash: "SHA-256",
      iterations: cloudRow.vaultKdfIterations,
      salt: cloudRow.vaultKdfSalt,
    };
    const vaultKey = await deriveVaultKey(
      masterPassword,
      cloudKdf,
      VAULT_CONTEXT,
    );
    const wrapped = JSON.parse(atob(cloudRow.cipherText)) as EncryptedBlob;
    let exportObj: unknown;
    try {
      exportObj = await decryptJSON<unknown>(vaultKey, wrapped);
    } catch {
      // Wrong master password — back out so the user can retry cleanly.
      try {
        await account.deleteSession("current");
      } catch {
        /* ignore */
      }
      throw new Error(
        "Wrong master password for this cloud account. Use the same password you set up on your other device.",
      );
    }
    if (!isEncryptedExport(exportObj)) {
      throw new Error("Cloud data is in an unexpected format.");
    }

    await db().transaction(
      "rw",
      [db().folders, db().entries, db().meta],
      async () => {
        await db().folders.clear();
        await db().entries.clear();
        if (exportObj.folders.length)
          await db().folders.bulkPut(exportObj.folders);
        if (exportObj.entries.length)
          await db().entries.bulkPut(exportObj.entries);
        const adopted: VaultMeta = {
          ...meta,
          email,
          userId: user.$id,
          sessionToken: "appwrite",
          kdf: exportObj.kdf,
          keyCheck: exportObj.keyCheck,
          remoteVersion: cloudRow.version,
          lastSyncedAt: Date.now(),
          // Biometric binding on this device wrapped the OLD vault key, so it
          // can no longer unwrap correctly. Force re-enroll.
          biometric: null,
        };
        await db().meta.put(adopted);
      },
    );
    return (await getMeta())!;
  }

  // No cloud data — link the account and push the local vault.
  const localKey = await deriveVaultKey(
    masterPassword,
    meta.kdf,
    VAULT_CONTEXT,
  );
  if (!(await verifyKeyCheck(localKey, meta.keyCheck))) {
    try {
      await account.deleteSession("current");
    } catch {
      /* ignore */
    }
    throw new Error(
      "Password doesn't match this device's local vault. Use the same master password.",
    );
  }
  const linked: VaultMeta = {
    ...meta,
    email,
    userId: user.$id,
    sessionToken: "appwrite",
  };
  await db().meta.put(linked);
  return await pushLocalVault(localKey);
}

// Sign in on a FRESH device (no local vault yet). We sign in to Appwrite,
// fetch the encrypted vault blob (which carries the KDF params used to encrypt
// it), then derive the vault key with THOSE params.
export async function cloudSignInFresh(
  masterPassword: string,
  email: string,
): Promise<{ meta: VaultMeta; vaultKey: CryptoKey }> {
  const authPassword = await deriveAuthPassword(masterPassword, email);
  const { account } = appwrite();
  try {
    await safeCreateSession(email, authPassword);
  } catch (e) {
    throw normalizeError(e, "Sign-in failed");
  }
  const user = await account.get();
  const row = await getOrNullVaultRow(user.$id);
  if (!row) {
    throw new Error(
      "This account has no vault yet. Push from your original device first.",
    );
  }
  const remoteKdf: KdfParams = {
    algorithm: "PBKDF2",
    hash: "SHA-256",
    iterations: row.vaultKdfIterations,
    salt: row.vaultKdfSalt,
  };
  const vaultKey = await deriveVaultKey(masterPassword, remoteKdf, VAULT_CONTEXT);
  // Validate by attempting to decrypt the wrapper.
  const wrapped = JSON.parse(atob(row.cipherText)) as EncryptedBlob;
  let exportObj: unknown;
  try {
    exportObj = await decryptJSON<unknown>(vaultKey, wrapped);
  } catch {
    // Wrong password — back out of the session so the user can retry.
    try {
      await account.deleteSession("current");
    } catch {
      /* ignore */
    }
    throw new Error("Wrong master password for this account.");
  }
  if (!isEncryptedExport(exportObj)) {
    throw new Error("Cloud data is in an unexpected format.");
  }

  const keyCheck = await makeKeyCheck(vaultKey);
  const meta: VaultMeta = {
    id: "vault",
    email,
    kdf: remoteKdf,
    keyCheck,
    createdAt: Date.now(),
    remoteVersion: row.version,
    lastSyncedAt: Date.now(),
    sessionToken: "appwrite",
    userId: user.$id,
    biometric: null,
  };

  await db().transaction(
    "rw",
    [db().folders, db().entries, db().meta],
    async () => {
      await db().folders.clear();
      await db().entries.clear();
      if (exportObj.folders.length) await db().folders.bulkPut(exportObj.folders);
      if (exportObj.entries.length) await db().entries.bulkPut(exportObj.entries);
      await db().meta.put(meta);
    },
  );

  return { meta, vaultKey };
}

export async function cloudSignOut(): Promise<void> {
  try {
    await appwrite().account.deleteSession("current");
  } catch {
    /* already signed out */
  }
  const meta = await getMeta();
  if (meta) {
    await db().meta.put({ ...meta, sessionToken: null, userId: null });
  }
}

export async function getCloudUser() {
  try {
    return await appwrite().account.get();
  } catch {
    return null;
  }
}

// ---- Vault blob push / pull -------------------------------------------------
// Appwrite renamed Collections → Tables and Documents → Rows. We use TablesDB.
// The table needs these attributes (camelCase, matching the keys we send below):
//   cipherText           string  (size 5,000,000)
//   version              integer
//   vaultKdfSalt         string  (size 256)
//   vaultKdfIterations   integer

type VaultRow = {
  $id: string;
  $updatedAt: string;
  cipherText: string;
  version: number;
  vaultKdfSalt: string;
  vaultKdfIterations: number;
};

async function getOrNullVaultRow(userId: string): Promise<VaultRow | null> {
  const { tablesDB } = appwrite();
  try {
    const row = await tablesDB.getRow(DATABASE_ID, VAULTS_TABLE_ID, userId);
    return row as unknown as VaultRow;
  } catch (e) {
    if (e instanceof AppwriteException && e.code === 404) return null;
    throw e;
  }
}

export async function pushLocalVault(vaultKey: CryptoKey): Promise<VaultMeta> {
  const meta = await getMeta();
  if (!meta || !meta.userId) throw new Error("Sign in to cloud first.");

  const folders = await db().folders.toArray();
  const entries = await db().entries.toArray();
  const exportObj: EncryptedExport = {
    format: "vault-authenticator",
    version: EXPORT_VERSION,
    exportedAt: Date.now(),
    email: meta.email,
    kdf: meta.kdf,
    keyCheck: meta.keyCheck,
    folders,
    entries,
  };
  const wrapped: EncryptedBlob = await encryptJSON(vaultKey, exportObj);
  const cipherText = btoa(JSON.stringify(wrapped));

  const payload = {
    cipherText,
    vaultKdfSalt: meta.kdf.salt,
    vaultKdfIterations: meta.kdf.iterations,
  };

  const { tablesDB } = appwrite();
  const existing = await getOrNullVaultRow(meta.userId);
  const ownerOnly = [
    Permission.read(Role.user(meta.userId)),
    Permission.update(Role.user(meta.userId)),
    Permission.delete(Role.user(meta.userId)),
  ];
  let newVersion: number;
  if (!existing) {
    const created = await tablesDB.createRow(
      DATABASE_ID,
      VAULTS_TABLE_ID,
      meta.userId,
      { ...payload, version: 1 },
      ownerOnly,
    );
    newVersion = (created as unknown as VaultRow).version;
  } else {
    if (
      meta.remoteVersion !== null &&
      existing.version !== meta.remoteVersion
    ) {
      const err = new Error("Cloud has a newer vault. Pull first to merge.");
      (err as Error & { code?: string }).code = "CONFLICT";
      throw err;
    }
    const updated = await tablesDB.updateRow(
      DATABASE_ID,
      VAULTS_TABLE_ID,
      meta.userId,
      { ...payload, version: existing.version + 1 },
    );
    newVersion = (updated as unknown as VaultRow).version;
  }

  const updatedMeta: VaultMeta = {
    ...meta,
    remoteVersion: newVersion,
    lastSyncedAt: Date.now(),
  };
  await db().meta.put(updatedMeta);
  return updatedMeta;
}

export async function pullRemoteVault(
  vaultKey: CryptoKey,
): Promise<{ meta: VaultMeta; applied: boolean }> {
  const meta = await getMeta();
  if (!meta || !meta.userId) throw new Error("Sign in to cloud first.");
  const row = await getOrNullVaultRow(meta.userId);
  if (!row) return { meta, applied: false };

  const wrapped = JSON.parse(atob(row.cipherText)) as EncryptedBlob;
  let exportObj: unknown;
  try {
    exportObj = await decryptJSON<unknown>(vaultKey, wrapped);
  } catch {
    throw new Error(
      "Couldn't decrypt the cloud vault. Local key doesn't match the cloud copy. Try restoring on a fresh device with /restore.",
    );
  }
  if (!isEncryptedExport(exportObj)) {
    throw new Error("Cloud data is in an unexpected format.");
  }

  await db().transaction(
    "rw",
    [db().folders, db().entries, db().meta],
    async () => {
      await db().folders.clear();
      await db().entries.clear();
      if (exportObj.folders.length) await db().folders.bulkPut(exportObj.folders);
      if (exportObj.entries.length) await db().entries.bulkPut(exportObj.entries);
      const updated: VaultMeta = {
        ...meta,
        kdf: exportObj.kdf,
        keyCheck: exportObj.keyCheck,
        email: exportObj.email ?? meta.email,
        remoteVersion: row.version,
        lastSyncedAt: Date.now(),
      };
      await db().meta.put(updated);
    },
  );
  const fresh = (await getMeta())!;
  return { meta: fresh, applied: true };
}

// ---- helpers ----------------------------------------------------------------

async function safeCreateSession(email: string, password: string) {
  const { account } = appwrite();
  try {
    await account.deleteSession("current");
  } catch {
    /* no current session — fine */
  }
  await account.createEmailPasswordSession(email, password);
}

function normalizeError(e: unknown, fallback: string): Error {
  if (e instanceof AppwriteException) {
    return new Error(e.message || fallback);
  }
  if (e instanceof Error) return e;
  return new Error(fallback);
}

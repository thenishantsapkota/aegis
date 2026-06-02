import Dexie, { type Table } from "dexie";
import type { EncryptedBlob, KdfParams } from "./crypto";
import type { BiometricBinding } from "./biometric";

// Vault metadata stored unencrypted (one row): KDF params, key-check blob, sync info.
export type VaultMeta = {
  id: "vault";
  email: string | null; // null until user creates a cloud account
  kdf: KdfParams;
  keyCheck: EncryptedBlob; // encrypted "ok" sentinel — used to verify password
  createdAt: number;
  // Sync
  remoteVersion: number | null; // version last synced from server
  lastSyncedAt: number | null;
  sessionToken: string | null; // server session (separate from vault key)
  userId: string | null;
  // Biometric unlock — null when disabled. Holds a wrapped vault key that can
  // only be decrypted after a successful WebAuthn PRF assertion.
  biometric: BiometricBinding | null;
};

export type Folder = {
  id: string;
  name: string;
  color: string; // hex
  sortOrder: number;
  createdAt: number;
};

// Per-entry encryption: each TOTP secret is encrypted with the vault key.
// Non-secret metadata (issuer/account/folder) is stored in cleartext so the
// vault list can render before unlocking — but unlock IS required to compute codes.
export type EntryRecord = {
  id: string;
  folderId: string | null;
  issuer: string;
  account: string;
  iconHint: string | null; // e.g. domain for favicon lookup
  // Encrypted blob containing { secret, algorithm, digits, period, type }
  payload: EncryptedBlob;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};

export type EntrySecret = {
  secret: string; // base32 secret
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: 6 | 7 | 8;
  period: number; // seconds, default 30
  type: "TOTP" | "HOTP";
  counter?: number; // HOTP only
};

export class VaultDB extends Dexie {
  meta!: Table<VaultMeta, "vault">;
  folders!: Table<Folder, string>;
  entries!: Table<EntryRecord, string>;

  constructor() {
    super("vault-authenticator");
    this.version(1).stores({
      meta: "id",
      folders: "id, sortOrder, name",
      entries: "id, folderId, sortOrder, issuer, account",
    });
  }
}

let _db: VaultDB | null = null;
export function db(): VaultDB {
  if (typeof window === "undefined") {
    throw new Error("Vault DB is only available in the browser.");
  }
  if (!_db) _db = new VaultDB();
  return _db;
}

export async function getMeta(): Promise<VaultMeta | undefined> {
  return db().meta.get("vault");
}

export async function isVaultInitialized(): Promise<boolean> {
  const m = await getMeta();
  return !!m;
}

export function newId(): string {
  // 16 random bytes -> hex
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

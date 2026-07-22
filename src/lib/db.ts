import Dexie, { type Table } from "dexie";
import type { EncryptedBlob, KdfParams } from "./crypto";
import type { BiometricBinding } from "./biometric";
import type { Identity } from "./team-crypto";

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
  // Asymmetric identity for team (shared) vaults. The private key is wrapped
  // with the vault key; the public key is published so others can share team
  // keys with us. Null until the user first touches a team feature.
  identity: Identity | null;
};

export type TeamRole = "owner" | "admin" | "member";

// Local cache of a team the user belongs to. The encrypted codes live in
// `teamEntries`; the team key itself is never persisted in the clear — only the
// copy wrapped to our public key (`wrappedTeamKey`), which we unwrap in memory.
export type TeamRecord = {
  id: string; // Appwrite team id
  name: string;
  role: TeamRole; // our role in this team
  color: string; // hex, for card labels
  // Team key wrapped to OUR public key. null = access not yet granted by an
  // admin (we're a member but can't decrypt team codes yet).
  wrappedTeamKey: string | null;
  remoteVersion: number | null; // teamVaults row version last synced
  lastSyncedAt: number | null;
  createdAt: number;
};

// A folder scoped to a team. Shared with all members (travels inside the
// encrypted team vault blob), so it's a separate table from personal `folders`.
export type TeamFolder = {
  id: string;
  teamId: string;
  name: string;
  color: string; // hex
  sortOrder: number;
  createdAt: number;
};

// A shared OTP entry. Identical shape to EntryRecord but the payload is
// encrypted with the TEAM key rather than the personal vault key.
export type TeamEntryRecord = {
  id: string;
  teamId: string;
  folderId: string | null; // references a TeamFolder in the same team
  issuer: string;
  account: string;
  iconHint: string | null;
  payload: EncryptedBlob; // encrypted with the team key
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
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
  teams!: Table<TeamRecord, string>;
  teamEntries!: Table<TeamEntryRecord, string>;
  teamFolders!: Table<TeamFolder, string>;

  constructor() {
    super("vault-authenticator");
    this.version(1).stores({
      meta: "id",
      folders: "id, sortOrder, name",
      entries: "id, folderId, sortOrder, issuer, account",
    });
    // v2: shared "team" vaults. Existing tables carry over unchanged.
    this.version(2).stores({
      teams: "id, name",
      teamEntries: "id, teamId, sortOrder",
    });
    // v3: folders within a team.
    this.version(3).stores({
      teamEntries: "id, teamId, folderId, sortOrder",
      teamFolders: "id, teamId, sortOrder",
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

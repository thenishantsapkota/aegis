// Encrypted vault export/import format.
// File contains everything needed to restore on another device:
//   - KDF params + salt (so the same password produces the same key)
//   - Folders (cleartext metadata — no secrets)
//   - Encrypted entries (already AES-GCM encrypted)
// The export file is itself decryptable by the user's master password.
//
// We also support an UNENCRYPTED form (otpauth:// list) for migration to other apps.

import type { EncryptedBlob, KdfParams } from "./crypto";
import type { EntryRecord, EntrySecret, Folder } from "./db";

export const EXPORT_VERSION = 1;

export type EncryptedExport = {
  format: "vault-authenticator";
  version: typeof EXPORT_VERSION;
  exportedAt: number;
  email: string | null;
  kdf: KdfParams;
  keyCheck: EncryptedBlob;
  folders: Folder[];
  entries: Array<Omit<EntryRecord, "createdAt" | "updatedAt"> & {
    createdAt: number;
    updatedAt: number;
  }>;
};

export type PlaintextExport = {
  format: "vault-authenticator-plain";
  version: typeof EXPORT_VERSION;
  exportedAt: number;
  folders: Folder[];
  entries: Array<{
    id: string;
    folderId: string | null;
    issuer: string;
    account: string;
    secret: EntrySecret;
  }>;
};

export function isEncryptedExport(o: unknown): o is EncryptedExport {
  return (
    typeof o === "object" &&
    o !== null &&
    (o as { format?: string }).format === "vault-authenticator"
  );
}

export function isPlaintextExport(o: unknown): o is PlaintextExport {
  return (
    typeof o === "object" &&
    o !== null &&
    (o as { format?: string }).format === "vault-authenticator-plain"
  );
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readJsonFile<T = unknown>(file: File): Promise<T> {
  const text = await file.text();
  return JSON.parse(text) as T;
}

// Browser-only WebCrypto helpers for the vault.
// Architecture:
//   - User has ONE master password.
//   - We derive two keys from it (split by purpose so they're independent):
//       * vaultKey  = PBKDF2(password, "vault:" + email, kdf params)  -> AES-GCM key, never leaves device
//       * authKey   = PBKDF2(password, "auth:"  + email, kdf params)  -> sent to server, re-hashed with bcrypt
//   - vaultKey encrypts each TOTP secret individually (so we can list metadata without unlocking),
//     and also encrypts the full vault blob for cloud sync.

const PBKDF2_ITERATIONS = 310_000; // OWASP recommended for SHA-256 (2023)
const SALT_BYTES = 16;
const IV_BYTES = 12;

const enc = new TextEncoder();
const dec = new TextDecoder();

export type KdfParams = {
  algorithm: "PBKDF2";
  hash: "SHA-256";
  iterations: number;
  salt: string; // base64
};

export type EncryptedBlob = {
  iv: string; // base64
  ciphertext: string; // base64
};

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return buf;
}

export function newKdfParams(): KdfParams {
  return {
    algorithm: "PBKDF2",
    hash: "SHA-256",
    iterations: PBKDF2_ITERATIONS,
    salt: toB64(randomBytes(SALT_BYTES)),
  };
}

async function importPasswordKey(password: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"],
  );
}

// Derive a 256-bit AES-GCM key from password + (salt | purpose context)
export async function deriveVaultKey(
  password: string,
  kdf: KdfParams,
  context: string,
): Promise<CryptoKey> {
  const baseKey = await importPasswordKey(password);
  // Mix the purpose context into the salt so vault key & auth key are independent.
  const saltBytes = fromB64(kdf.salt);
  const contextBytes = enc.encode("|" + context);
  const combined = new Uint8Array(saltBytes.length + contextBytes.length);
  combined.set(saltBytes, 0);
  combined.set(contextBytes, saltBytes.length);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: kdf.hash,
      iterations: kdf.iterations,
      salt: combined,
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    // Extractable so it can be wrapped by the biometric flow. The key
    // already lives in JS memory; extractable=false would not stop an
    // attacker with JS execution from using it for encrypt/decrypt.
    true,
    ["encrypt", "decrypt"],
  );
}

// Import a raw 256-bit AES-GCM key (used after biometric unwrap).
export async function importRawVaultKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    raw as BufferSource,
    { name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"],
  );
}

// Export an AES-GCM key as raw bytes (for biometric wrapping).
export async function exportRawVaultKey(key: CryptoKey): Promise<Uint8Array> {
  const buf = await crypto.subtle.exportKey("raw", key);
  return new Uint8Array(buf);
}

// Derive raw bytes (used to produce an "auth proof" sent to server).
export async function deriveAuthProof(
  password: string,
  kdf: KdfParams,
  context: string,
): Promise<string> {
  const baseKey = await importPasswordKey(password);
  const saltBytes = fromB64(kdf.salt);
  const contextBytes = enc.encode("|" + context);
  const combined = new Uint8Array(saltBytes.length + contextBytes.length);
  combined.set(saltBytes, 0);
  combined.set(contextBytes, saltBytes.length);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: kdf.hash,
      iterations: kdf.iterations,
      salt: combined,
    },
    baseKey,
    256,
  );
  return toB64(bits);
}

export async function encryptJSON<T>(
  key: CryptoKey,
  data: T,
): Promise<EncryptedBlob> {
  const iv = randomBytes(IV_BYTES);
  const plaintext = enc.encode(JSON.stringify(data));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    plaintext as BufferSource,
  );
  return { iv: toB64(iv), ciphertext: toB64(ct) };
}

export async function decryptJSON<T>(
  key: CryptoKey,
  blob: EncryptedBlob,
): Promise<T> {
  const iv = fromB64(blob.iv);
  const ct = fromB64(blob.ciphertext);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ct as BufferSource,
  );
  return JSON.parse(dec.decode(pt)) as T;
}

// Verify a key can decrypt a known "check value" — used to validate a master password.
export async function makeKeyCheck(key: CryptoKey): Promise<EncryptedBlob> {
  return encryptJSON(key, { ok: true, ts: Date.now() });
}
export async function verifyKeyCheck(
  key: CryptoKey,
  blob: EncryptedBlob,
): Promise<boolean> {
  try {
    const v = await decryptJSON<{ ok: boolean }>(key, blob);
    return v.ok === true;
  } catch {
    return false;
  }
}

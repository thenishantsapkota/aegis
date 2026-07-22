// Team (shared) OTP crypto — layered on top of the personal-vault crypto.
//
// The personal vault is symmetric only: one AES key derived from the master
// password, never leaving the device. That can't be shared with a *different*
// person without leaking a key. Teams therefore add PUBLIC-KEY envelope
// encryption on top — the standard "org vault" pattern:
//
//   - Every user has an RSA-OAEP keypair. The PRIVATE key is wrapped with the
//     user's own vault key (AES-GCM) and stored in VaultMeta; the PUBLIC key is
//     published in cleartext to Appwrite so other members can encrypt to it.
//   - Every team has a random AES-256 `teamKey` that encrypts the team's codes.
//   - Membership = a "grant": teamKey wrapped to each member's PUBLIC key. Only
//     that member's private key can unwrap it. The plaintext teamKey never
//     travels — zero-knowledge is preserved end to end.
//
// This module holds only pure WebCrypto; Appwrite wiring lives in teams.ts.

import {
  decryptJSON,
  encryptJSON,
  type EncryptedBlob,
} from "./crypto";

const RSA_PARAMS: RsaHashedKeyGenParams = {
  name: "RSA-OAEP",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
};

// The user's asymmetric identity, stored in VaultMeta.
export type Identity = {
  // Public key as JWK — safe to publish in cleartext.
  publicKeyJwk: JsonWebKey;
  // Private key (JWK) encrypted with the vault key. Only unlockable on-device.
  wrappedPrivateKey: EncryptedBlob;
};

function toB64(bytes: Uint8Array): string {
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

// ---- Identity keypair -------------------------------------------------------

// Generate a fresh identity and wrap its private key with the vault key.
export async function createIdentity(vaultKey: CryptoKey): Promise<Identity> {
  const pair = await crypto.subtle.generateKey(RSA_PARAMS, true, [
    "encrypt",
    "decrypt",
  ]);
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  // Store the private JWK encrypted under the vault key.
  const wrappedPrivateKey = await encryptJSON(vaultKey, privateJwk);
  return { publicKeyJwk, wrappedPrivateKey };
}

// Recover the usable private CryptoKey from an Identity, given the vault key.
export async function unwrapPrivateKey(
  identity: Identity,
  vaultKey: CryptoKey,
): Promise<CryptoKey> {
  const privateJwk = await decryptJSON<JsonWebKey>(
    vaultKey,
    identity.wrappedPrivateKey,
  );
  return crypto.subtle.importKey(
    "jwk",
    privateJwk,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"],
  );
}

// Import someone's published public key (JWK) for encrypting to them.
export async function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSA-OAEP", hash: "SHA-256" },
    true,
    ["encrypt"],
  );
}

// ---- Team key ---------------------------------------------------------------

// A brand-new random symmetric key for a team's codes.
export async function generateTeamKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
}

// Wrap a team key to a member's PUBLIC key. Result is base64 — this is what
// gets stored as a per-member grant in Appwrite.
//
// We export the AES key's 32 raw bytes and RSA-OAEP *encrypt* them (rather than
// using SubtleCrypto.wrapKey), so the RSA keys only need the encrypt/decrypt
// usages — not the separate wrapKey/unwrapKey usages. A 32-byte key fits well
// within RSA-2048 OAEP's ~190-byte limit.
export async function wrapTeamKeyFor(
  teamKey: CryptoKey,
  memberPublicKey: CryptoKey,
): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", teamKey);
  const sealed = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    memberPublicKey,
    raw,
  );
  return toB64(new Uint8Array(sealed));
}

// Unwrap a team key grant with our own private key.
export async function unwrapTeamKey(
  wrappedB64: string,
  ownPrivateKey: CryptoKey,
): Promise<CryptoKey> {
  const sealed = fromB64(wrappedB64);
  const raw = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    ownPrivateKey,
    sealed as BufferSource,
  );
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}

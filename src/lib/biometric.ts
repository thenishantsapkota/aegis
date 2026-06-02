// WebAuthn-based biometric unlock using the PRF extension.
//
// How it works:
//   1. enableBiometric(vaultKeyRaw, label): we create a platform credential
//      with the PRF extension and a random `prfSalt`. We then do a single
//      assertion with the same salt to obtain a deterministic PRF output,
//      derive an AES-GCM "wrap key" from it, and wrap the raw vault key.
//      We persist { credentialId, prfSalt, wrappedKey } in VaultMeta.
//
//   2. unlockWithBiometric(meta): assert against the stored credential with the
//      same salt → same PRF output → same wrap key → unwrap the vault key
//      → import it as a CryptoKey. No password needed.
//
// PRF support:
//   - Chrome 132+ (desktop & Android), Safari 18+ (iOS / macOS), Firefox 119+
//   - Requires HTTPS (or localhost) and a platform authenticator
//   - On iOS Safari, must be a user gesture; we trigger from a button.

import { type EncryptedBlob } from "./crypto";

const enc = new TextEncoder();

function toB64Url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64Url(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export type BiometricBinding = {
  credentialId: string; // base64url
  prfSalt: string; // base64url
  wrappedVaultKey: EncryptedBlob;
  createdAt: number;
  label?: string;
};

// Quick feature-detection. Returns true if the device has a platform
// authenticator available (Touch ID, Face ID, Windows Hello, Android fingerprint).
export async function isBiometricAvailable(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!window.PublicKeyCredential) return false;
  try {
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.();
    return Boolean(available);
  } catch {
    return false;
  }
}

async function derivePrfOutput(
  credentialId: Uint8Array,
  prfSalt: Uint8Array,
): Promise<Uint8Array> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [
        {
          id: credentialId as BufferSource,
          type: "public-key",
          transports: ["internal"],
        },
      ],
      userVerification: "required",
      timeout: 60_000,
      extensions: {
        prf: { eval: { first: prfSalt as BufferSource } },
      } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!assertion) throw new Error("Biometric prompt was cancelled");
  const ext = assertion.getClientExtensionResults() as {
    prf?: { results?: { first?: ArrayBuffer } };
  };
  const prf = ext.prf?.results?.first;
  if (!prf) {
    throw new Error(
      "This device's authenticator doesn't support the PRF extension. Biometric unlock isn't available.",
    );
  }
  return new Uint8Array(prf);
}

async function wrapKey(
  prfOutput: Uint8Array,
  rawVaultKey: Uint8Array,
): Promise<EncryptedBlob> {
  const wrapKey = await crypto.subtle.importKey(
    "raw",
    prfOutput.slice(0, 32) as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    wrapKey,
    rawVaultKey as BufferSource,
  );
  return { iv: toB64Url(iv), ciphertext: toB64Url(ct) };
}

async function unwrapKey(
  prfOutput: Uint8Array,
  blob: EncryptedBlob,
): Promise<Uint8Array> {
  const wrapKey = await crypto.subtle.importKey(
    "raw",
    prfOutput.slice(0, 32) as BufferSource,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const iv = fromB64Url(blob.iv);
  const ct = fromB64Url(blob.ciphertext);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    wrapKey,
    ct as BufferSource,
  );
  return new Uint8Array(pt);
}

// Create a new platform credential bound to the user's master vault key.
// Returns the binding to persist in VaultMeta.
export async function enableBiometric(opts: {
  rawVaultKey: Uint8Array;
  userIdSeed: string; // stable per-vault id (any unique string)
  label: string; // shown in OS prompts
}): Promise<BiometricBinding> {
  if (!window.PublicKeyCredential) {
    throw new Error("Biometric API not supported on this browser.");
  }
  const prfSalt = crypto.getRandomValues(new Uint8Array(32));
  const userId = enc.encode(opts.userIdSeed).slice(0, 64);
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const credential = (await navigator.credentials.create({
    publicKey: {
      rp: {
        name: "Aegis Authenticator",
        // id must be a valid public suffix domain or the current host
        id: window.location.hostname,
      },
      user: {
        id: userId as BufferSource,
        name: opts.label,
        displayName: opts.label,
      },
      challenge: challenge as BufferSource,
      pubKeyCredParams: [
        { type: "public-key", alg: -7 }, // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
      timeout: 60_000,
      attestation: "none",
      extensions: {
        // Ask the authenticator to enable PRF for this credential.
        prf: { eval: { first: prfSalt as BufferSource } },
      } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("Biometric setup was cancelled");

  const ext = credential.getClientExtensionResults() as {
    prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
  };
  // Some platforms return the PRF output here directly; if not, do one extra assertion.
  let prfOutput: Uint8Array;
  if (ext.prf?.results?.first) {
    prfOutput = new Uint8Array(ext.prf.results.first);
  } else if (ext.prf?.enabled !== false) {
    prfOutput = await derivePrfOutput(
      new Uint8Array(credential.rawId),
      prfSalt,
    );
  } else {
    throw new Error(
      "This authenticator can't enable PRF. Biometric unlock isn't available here.",
    );
  }

  const wrappedVaultKey = await wrapKey(prfOutput, opts.rawVaultKey);
  return {
    credentialId: toB64Url(credential.rawId),
    prfSalt: toB64Url(prfSalt),
    wrappedVaultKey,
    createdAt: Date.now(),
    label: opts.label,
  };
}

// Unwrap the raw vault key after a successful biometric assertion.
export async function unlockWithBiometric(
  binding: BiometricBinding,
): Promise<Uint8Array> {
  const credentialId = fromB64Url(binding.credentialId);
  const prfSalt = fromB64Url(binding.prfSalt);
  const prfOutput = await derivePrfOutput(credentialId, prfSalt);
  return unwrapKey(prfOutput, binding.wrappedVaultKey);
}

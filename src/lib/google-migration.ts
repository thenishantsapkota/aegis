// Parser for Google Authenticator's "Transfer accounts" QR code:
//   otpauth-migration://offline?data=<base64url(protobuf MigrationPayload)>
//
// Schema (from Google's reverse-engineered MigrationPayload.proto):
//   message OtpParameters {
//     bytes  secret    = 1;
//     string name      = 2;
//     string issuer    = 3;
//     int32  algorithm = 4;   // 0 invalid, 1 SHA1, 2 SHA256, 3 SHA512, 4 MD5
//     int32  digits    = 5;   // 0 invalid, 1 SIX, 2 EIGHT
//     int32  type      = 6;   // 0 invalid, 1 HOTP, 2 TOTP
//     int64  counter   = 7;
//   }
//   message MigrationPayload {
//     repeated OtpParameters otp_parameters = 1;
//     int32 version    = 2;
//     int32 batch_size = 3;
//     int32 batch_index = 4;
//     int32 batch_id   = 5;
//   }
//
// We hand-decode the wire format (no protobuf library dependency).

import type { ParsedOtpAuth } from "./totp";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function bytesToBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

function fromB64UrlOrStd(s: string): Uint8Array {
  // Google's payload uses standard base64 (with padding) inside a URL-encoded
  // query string, but some apps emit b64url. Accept both.
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (b64.length % 4)) % 4;
  b64 = b64 + "=".repeat(pad);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Minimal protobuf wire-format reader.
class Reader {
  pos = 0;
  constructor(public buf: Uint8Array) {}
  done() {
    return this.pos >= this.buf.length;
  }
  // varint
  varint(): number {
    let result = 0;
    let shift = 0;
    while (true) {
      if (this.pos >= this.buf.length) throw new Error("Truncated varint");
      const b = this.buf[this.pos++];
      result |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
      if (shift > 35) throw new Error("Varint too long");
    }
    return result >>> 0;
  }
  // length-delimited
  bytes(): Uint8Array {
    const len = this.varint();
    if (this.pos + len > this.buf.length) {
      throw new Error("Truncated length-delimited field");
    }
    const out = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }
  // skip a field of the given wire type
  skip(wireType: number) {
    switch (wireType) {
      case 0:
        this.varint();
        return;
      case 2: {
        const len = this.varint();
        this.pos += len;
        return;
      }
      case 1:
        this.pos += 8;
        return;
      case 5:
        this.pos += 4;
        return;
      default:
        throw new Error(`Unsupported wire type ${wireType}`);
    }
  }
}

const dec = new TextDecoder();

function decodeOtpParameters(buf: Uint8Array): ParsedOtpAuth | null {
  const r = new Reader(buf);
  let secret: Uint8Array | null = null;
  let name = "";
  let issuer = "";
  let algorithm: ParsedOtpAuth["algorithm"] = "SHA1";
  let digits: ParsedOtpAuth["digits"] = 6;
  let type: ParsedOtpAuth["type"] = "TOTP";
  let counter: number | undefined;

  while (!r.done()) {
    const tag = r.varint();
    const field = tag >>> 3;
    const wt = tag & 0x07;
    switch (field) {
      case 1:
        if (wt !== 2) {
          r.skip(wt);
          break;
        }
        secret = new Uint8Array(r.bytes());
        break;
      case 2:
        if (wt !== 2) {
          r.skip(wt);
          break;
        }
        name = dec.decode(r.bytes());
        break;
      case 3:
        if (wt !== 2) {
          r.skip(wt);
          break;
        }
        issuer = dec.decode(r.bytes());
        break;
      case 4: {
        if (wt !== 0) {
          r.skip(wt);
          break;
        }
        const v = r.varint();
        algorithm = v === 2 ? "SHA256" : v === 3 ? "SHA512" : "SHA1";
        break;
      }
      case 5: {
        if (wt !== 0) {
          r.skip(wt);
          break;
        }
        const v = r.varint();
        digits = v === 2 ? 8 : 6;
        break;
      }
      case 6: {
        if (wt !== 0) {
          r.skip(wt);
          break;
        }
        const v = r.varint();
        type = v === 1 ? "HOTP" : "TOTP";
        break;
      }
      case 7:
        if (wt !== 0) {
          r.skip(wt);
          break;
        }
        counter = r.varint();
        break;
      default:
        r.skip(wt);
    }
  }

  if (!secret || secret.length === 0) return null;

  // Google's labels are usually "Issuer:account" or just "account"
  let account = name;
  if (!issuer && name.includes(":")) {
    const [maybeIssuer, ...rest] = name.split(":");
    issuer = maybeIssuer.trim();
    account = rest.join(":").trim();
  }

  return {
    type,
    issuer,
    account,
    secret: bytesToBase32(secret),
    algorithm,
    digits,
    period: 30,
    counter: type === "HOTP" ? (counter ?? 0) : undefined,
  };
}

function decodeMigrationPayload(buf: Uint8Array): ParsedOtpAuth[] {
  const r = new Reader(buf);
  const entries: ParsedOtpAuth[] = [];
  while (!r.done()) {
    const tag = r.varint();
    const field = tag >>> 3;
    const wt = tag & 0x07;
    if (field === 1 && wt === 2) {
      const parsed = decodeOtpParameters(r.bytes());
      if (parsed) entries.push(parsed);
    } else {
      r.skip(wt);
    }
  }
  return entries;
}

export function isGoogleMigrationUri(uri: string): boolean {
  return /^otpauth-migration:\/\/offline\?/i.test(uri.trim());
}

export function parseGoogleMigrationUri(uri: string): ParsedOtpAuth[] {
  const trimmed = uri.trim();
  if (!isGoogleMigrationUri(trimmed)) {
    throw new Error("Not a Google Authenticator migration URL.");
  }
  // Lenient parsing — the URL parser treats this scheme fine if we swap.
  const normalized = trimmed.replace(/^otpauth-migration:\/\//i, "https://");
  const u = new URL(normalized);
  const data = u.searchParams.get("data");
  if (!data) throw new Error("Migration URL has no `data` parameter.");
  // Some platforms double-encode the data — decode if needed.
  const decoded = decodeURIComponent(data);
  const bytes = fromB64UrlOrStd(decoded);
  return decodeMigrationPayload(bytes);
}

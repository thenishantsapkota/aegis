import * as OTPAuth from "otpauth";
import type { EntrySecret } from "./db";

export type ParsedOtpAuth = {
  type: "TOTP" | "HOTP";
  issuer: string;
  account: string;
  secret: string;
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: 6 | 7 | 8;
  period: number;
  counter?: number;
};

// Parse an otpauth:// URI (the QR code payload).
//   otpauth://totp/Issuer:account@host?secret=BASE32&issuer=Issuer&algorithm=SHA1&digits=6&period=30
export function parseOtpauthUri(uri: string): ParsedOtpAuth {
  const trimmed = uri.trim();
  if (!/^otpauth:\/\//i.test(trimmed)) {
    throw new Error("Not an otpauth:// URI");
  }
  // URL parser is lenient enough with custom schemes if we swap the scheme:
  const normalized = trimmed.replace(/^otpauth:\/\//i, "https://");
  const u = new URL(normalized);
  const type = u.hostname.toUpperCase() as "TOTP" | "HOTP";
  if (type !== "TOTP" && type !== "HOTP") {
    throw new Error(`Unsupported OTP type: ${type}`);
  }
  // Label: "Issuer:account" or just "account"
  const label = decodeURIComponent(u.pathname.replace(/^\//, ""));
  let issuer = u.searchParams.get("issuer") ?? "";
  let account = label;
  if (label.includes(":")) {
    const [maybeIssuer, ...rest] = label.split(":");
    if (!issuer) issuer = maybeIssuer.trim();
    account = rest.join(":").trim();
  }
  const secret = (u.searchParams.get("secret") ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();
  if (!secret) throw new Error("Missing secret");

  const algoRaw = (u.searchParams.get("algorithm") ?? "SHA1").toUpperCase();
  const algorithm: ParsedOtpAuth["algorithm"] =
    algoRaw === "SHA256" || algoRaw === "SHA512" ? algoRaw : "SHA1";
  const digitsNum = parseInt(u.searchParams.get("digits") ?? "6", 10);
  const digits = (digitsNum === 7 || digitsNum === 8 ? digitsNum : 6) as
    | 6
    | 7
    | 8;
  const period = parseInt(u.searchParams.get("period") ?? "30", 10) || 30;
  const counter = u.searchParams.get("counter")
    ? parseInt(u.searchParams.get("counter")!, 10)
    : undefined;

  return { type, issuer, account, secret, algorithm, digits, period, counter };
}

// Build an otpauth:// URI (for sharing / export).
export function buildOtpauthUri(s: EntrySecret, issuer: string, account: string): string {
  const otp =
    s.type === "TOTP"
      ? new OTPAuth.TOTP({
          issuer,
          label: account,
          algorithm: s.algorithm,
          digits: s.digits,
          period: s.period,
          secret: OTPAuth.Secret.fromBase32(s.secret),
        })
      : new OTPAuth.HOTP({
          issuer,
          label: account,
          algorithm: s.algorithm,
          digits: s.digits,
          counter: s.counter ?? 0,
          secret: OTPAuth.Secret.fromBase32(s.secret),
        });
  return otp.toString();
}

export function generateCode(s: EntrySecret, atUnixMs?: number): string {
  if (s.type === "TOTP") {
    const totp = new OTPAuth.TOTP({
      algorithm: s.algorithm,
      digits: s.digits,
      period: s.period,
      secret: OTPAuth.Secret.fromBase32(s.secret),
    });
    return totp.generate({ timestamp: atUnixMs ?? Date.now() });
  } else {
    const hotp = new OTPAuth.HOTP({
      algorithm: s.algorithm,
      digits: s.digits,
      counter: s.counter ?? 0,
      secret: OTPAuth.Secret.fromBase32(s.secret),
    });
    return hotp.generate();
  }
}

// For TOTP: how many seconds remain in the current step.
export function totpRemainingSeconds(period: number, nowMs: number = Date.now()): number {
  const sec = Math.floor(nowMs / 1000);
  return period - (sec % period);
}

// Validate a user-entered base32 secret. Accepts spaces & lowercase.
export function normalizeBase32Secret(input: string): string | null {
  const cleaned = input.replace(/\s+/g, "").toUpperCase().replace(/=+$/, "");
  if (!/^[A-Z2-7]+$/.test(cleaned)) return null;
  if (cleaned.length < 8) return null;
  try {
    OTPAuth.Secret.fromBase32(cleaned);
    return cleaned;
  } catch {
    return null;
  }
}

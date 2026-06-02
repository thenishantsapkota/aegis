import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { ArrowLeft, KeySquare, ScanLine, AlertTriangle } from "lucide-react";
import { useVault } from "~/lib/vault-context";
import { db, type EntrySecret, type Folder } from "~/lib/db";
import { normalizeBase32Secret, parseOtpauthUri } from "~/lib/totp";
import { QrScanner } from "~/components/QrScanner";
import { cn } from "~/lib/cn";

export const Route = createFileRoute("/add")({
  component: AddRoute,
});

function AddRoute() {
  const { state } = useVault();
  const navigate = useNavigate();

  useEffect(() => {
    if (state.status === "uninitialized") navigate({ to: "/setup" });
    else if (state.status === "locked") navigate({ to: "/unlock" });
  }, [state.status, navigate]);

  if (state.status !== "unlocked") {
    return (
      <div className="h-safe-screen flex items-center justify-center text-muted">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-safe-screen pt-safe pb-safe pl-safe pr-safe">
      <div className="mx-auto max-w-2xl px-4 pt-4">
        <header className="flex items-center justify-between mb-4">
          <Link
            to="/"
            className="w-10 h-10 rounded-xl bg-bg-elev border border-border flex items-center justify-center text-muted hover:text-white"
            aria-label="Back"
          >
            <ArrowLeft size={18} />
          </Link>
          <h1 className="text-lg font-semibold">Add code</h1>
          <div className="w-10" />
        </header>
        <AddTabs />
      </div>
    </div>
  );
}

function AddTabs() {
  const [tab, setTab] = useState<"scan" | "manual">("scan");

  return (
    <div>
      <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-bg-elev border border-border mb-4">
        <button
          type="button"
          onClick={() => setTab("scan")}
          className={cn(
            "py-2.5 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-2 transition",
            tab === "scan" ? "bg-bg-card text-white" : "text-muted",
          )}
        >
          <ScanLine size={16} /> Scan QR
        </button>
        <button
          type="button"
          onClick={() => setTab("manual")}
          className={cn(
            "py-2.5 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-2 transition",
            tab === "manual" ? "bg-bg-card text-white" : "text-muted",
          )}
        >
          <KeySquare size={16} /> Manual entry
        </button>
      </div>

      {tab === "scan" ? <ScanPane /> : <ManualPane />}
    </div>
  );
}

function ScanPane() {
  const navigate = useNavigate();
  const { saveEntry } = useVault();
  const [error, setError] = useState<string | null>(null);

  async function onScan(text: string) {
    try {
      if (/^otpauth-migration:\/\//i.test(text.trim())) {
        // Bulk import path — hand off to the import flow.
        navigate({ to: "/import" });
        return;
      }
      const parsed = parseOtpauthUri(text);
      await saveEntry(
        {
          folderId: null,
          issuer: parsed.issuer,
          account: parsed.account,
          secret: {
            secret: parsed.secret,
            algorithm: parsed.algorithm,
            digits: parsed.digits,
            period: parsed.period,
            type: parsed.type,
            counter: parsed.counter,
          },
        },
        { immediateSync: true },
      );
      navigate({ to: "/" });
    } catch (e) {
      setError(
        e instanceof Error
          ? `Couldn't read that code: ${e.message}`
          : "Couldn't read that code",
      );
    }
  }

  return (
    <div className="space-y-3">
      <QrScanner onScan={onScan} />
      {error && (
        <div className="flex gap-2 text-sm text-danger">
          <AlertTriangle size={16} className="mt-0.5" />
          {error}
        </div>
      )}
      <p className="text-xs text-muted text-center">
        Point your camera at the QR code shown by the service you're enabling
        2FA for.
      </p>
      <div className="text-center">
        <Link
          to="/import"
          className="inline-flex items-center gap-1.5 text-xs text-accent hover:text-accent-hover underline-offset-4 hover:underline"
        >
          Coming from Google Authenticator, Authy or 2FAS? Bulk import →
        </Link>
      </div>
    </div>
  );
}

function ManualPane() {
  const navigate = useNavigate();
  const { saveEntry } = useVault();
  const folders =
    useLiveQuery<Folder[]>(
      () => db().folders.orderBy("sortOrder").toArray(),
      [],
    ) ?? [];

  const [issuer, setIssuer] = useState("");
  const [account, setAccount] = useState("");
  const [secret, setSecret] = useState("");
  const [folderId, setFolderId] = useState<string>("");
  const [algorithm, setAlgorithm] = useState<"SHA1" | "SHA256" | "SHA512">(
    "SHA1",
  );
  const [digits, setDigits] = useState<6 | 7 | 8>(6);
  const [period, setPeriod] = useState(30);
  const [type, setType] = useState<"TOTP" | "HOTP">("TOTP");
  const [counter, setCounter] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const normalized = normalizeBase32Secret(secret);
    if (!normalized) {
      setError("Secret must be a valid base32 string (letters A–Z, digits 2–7).");
      return;
    }
    if (!issuer.trim() && !account.trim()) {
      setError("Add an issuer or account name.");
      return;
    }
    const entrySecret: EntrySecret = {
      secret: normalized,
      algorithm,
      digits,
      period,
      type,
      counter: type === "HOTP" ? counter : undefined,
    };
    setBusy(true);
    try {
      await saveEntry(
        {
          folderId: folderId || null,
          issuer: issuer.trim(),
          account: account.trim(),
          secret: entrySecret,
        },
        { immediateSync: true },
      );
      navigate({ to: "/" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Issuer</label>
          <input
            className="input"
            placeholder="GitHub"
            value={issuer}
            onChange={(e) => setIssuer(e.target.value)}
            autoCapitalize="words"
            autoCorrect="off"
          />
        </div>
        <div>
          <label className="label">Account</label>
          <input
            className="input"
            placeholder="alice@example.com"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            inputMode="email"
          />
        </div>
      </div>

      <div>
        <label className="label">Secret (base32)</label>
        <input
          className="input font-mono"
          placeholder="JBSWY3DPEHPK3PXP"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>

      <div>
        <label className="label">Folder</label>
        <select
          className="input"
          value={folderId}
          onChange={(e) => setFolderId(e.target.value)}
        >
          <option value="">Unfiled</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>

      <details className="card p-3">
        <summary className="cursor-pointer text-sm text-muted">
          Advanced options
        </summary>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="label">Type</label>
            <select
              className="input"
              value={type}
              onChange={(e) => setType(e.target.value as "TOTP" | "HOTP")}
            >
              <option value="TOTP">TOTP (time-based)</option>
              <option value="HOTP">HOTP (counter-based)</option>
            </select>
          </div>
          <div>
            <label className="label">Algorithm</label>
            <select
              className="input"
              value={algorithm}
              onChange={(e) =>
                setAlgorithm(e.target.value as "SHA1" | "SHA256" | "SHA512")
              }
            >
              <option value="SHA1">SHA-1</option>
              <option value="SHA256">SHA-256</option>
              <option value="SHA512">SHA-512</option>
            </select>
          </div>
          <div>
            <label className="label">Digits</label>
            <select
              className="input"
              value={digits}
              onChange={(e) => setDigits(Number(e.target.value) as 6 | 7 | 8)}
            >
              <option value={6}>6</option>
              <option value={7}>7</option>
              <option value={8}>8</option>
            </select>
          </div>
          {type === "TOTP" ? (
            <div>
              <label className="label">Period (s)</label>
              <input
                type="number"
                min={15}
                max={120}
                className="input"
                value={period}
                onChange={(e) =>
                  setPeriod(Math.max(15, Math.min(120, Number(e.target.value) || 30)))
                }
              />
            </div>
          ) : (
            <div>
              <label className="label">Counter</label>
              <input
                type="number"
                min={0}
                className="input"
                value={counter}
                onChange={(e) => setCounter(Math.max(0, Number(e.target.value) || 0))}
              />
            </div>
          )}
        </div>
      </details>

      {error && (
        <div className="flex gap-2 text-sm text-danger">
          <AlertTriangle size={16} className="mt-0.5" />
          {error}
        </div>
      )}

      <button type="submit" disabled={busy} className="btn-primary w-full">
        {busy ? "Saving…" : "Save code"}
      </button>
    </form>
  );
}

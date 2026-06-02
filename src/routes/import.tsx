import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Info,
  ScanLine,
  Check,
} from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useVault } from "~/lib/vault-context";
import { db, type Folder } from "~/lib/db";
import {
  isGoogleMigrationUri,
  parseGoogleMigrationUri,
} from "~/lib/google-migration";
import { parseOtpauthUri, type ParsedOtpAuth } from "~/lib/totp";
import { QrScanner } from "~/components/QrScanner";
import { cn } from "~/lib/cn";

export const Route = createFileRoute("/import")({
  component: ImportRoute,
});

function ImportRoute() {
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
      <div className="mx-auto max-w-2xl px-4 pt-6 pb-32 animate-fade-in">
        <header className="flex items-center justify-between mb-6">
          <Link
            to="/settings"
            className="w-10 h-10 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-muted hover:text-white"
            aria-label="Back"
          >
            <ArrowLeft size={18} />
          </Link>
          <h1 className="text-lg font-semibold">Import from another app</h1>
          <div className="w-10" />
        </header>

        <Instructions />
        <ImportTabs />
      </div>
    </div>
  );
}

function Instructions() {
  const [open, setOpen] = useState<string | null>("google");
  const items = [
    {
      key: "google",
      title: "Google Authenticator",
      steps: [
        "Open Google Authenticator on your old device.",
        "Tap the menu (top-right) → Transfer accounts → Export accounts.",
        "Pick the accounts to move, tap Next — it shows a QR code (or several if there are many accounts).",
        "Back here, choose Scan migration QR below and point your camera at it. Repeat for each QR.",
      ],
    },
    {
      key: "authy",
      title: "Authy",
      steps: [
        "Authy doesn't expose a direct export. The reliable path is to re-enroll each account: log in to the service (GitHub, etc.) → 2FA settings → Set up new authenticator → scan that QR with Aegis (Add → Scan QR).",
        "Some users use the Authy desktop app's local decryption tools to extract otpauth:// URIs. If you have those, paste them in Paste URIs below.",
      ],
    },
    {
      key: "2fas",
      title: "2FAS Auth",
      steps: [
        "In 2FAS, go to Settings → Backup → Export. Choose unencrypted export.",
        "Open the .2fas / .json file in a text editor.",
        "Copy each entry's otpauth:// URL (under \"otp\") and paste them below, one per line.",
      ],
    },
    {
      key: "andotp",
      title: "andOTP / Aegis (Android)",
      steps: [
        "Export as plaintext JSON from the source app.",
        "For each entry, build an otpauth:// URI from the fields (issuer, account, secret, period, algorithm, digits).",
        "Paste all URIs in Paste URIs below, one per line.",
      ],
    },
    {
      key: "microsoft",
      title: "Microsoft Authenticator",
      steps: [
        "Microsoft Authenticator has no general export. You'll need to re-enroll each account: open the service's 2FA setup, scan the new QR with Aegis (Add → Scan QR).",
        "For Microsoft work/school accounts, you can re-enroll without losing access by adding Aegis as an additional method first.",
      ],
    },
  ];

  return (
    <section className="mb-6 space-y-2">
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.08em] text-muted font-semibold">
        <Info size={14} /> How to export from your current app
      </div>
      <div className="card divide-y divide-white/[0.06]">
        {items.map((it) => {
          const isOpen = open === it.key;
          return (
            <div key={it.key}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : it.key)}
                className="w-full flex items-center justify-between text-left p-4 hover:bg-white/[0.02] transition"
              >
                <span className="font-medium">{it.title}</span>
                {isOpen ? (
                  <ChevronDown size={16} className="text-muted" />
                ) : (
                  <ChevronRight size={16} className="text-muted" />
                )}
              </button>
              {isOpen && (
                <ol className="px-5 pb-4 -mt-1 space-y-2 text-sm text-muted list-decimal list-inside marker:text-accent">
                  {it.steps.map((s, i) => (
                    <li key={i} className="leading-relaxed">
                      {s}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ImportTabs() {
  const [tab, setTab] = useState<"scan" | "paste">("scan");

  return (
    <div>
      <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-white/[0.04] border border-white/[0.08] mb-4">
        <button
          type="button"
          onClick={() => setTab("scan")}
          className={cn(
            "py-2.5 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-2 transition",
            tab === "scan"
              ? "bg-gradient-primary text-white shadow-soft"
              : "text-muted hover:text-white",
          )}
        >
          <ScanLine size={16} /> Scan migration QR
        </button>
        <button
          type="button"
          onClick={() => setTab("paste")}
          className={cn(
            "py-2.5 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-2 transition",
            tab === "paste"
              ? "bg-gradient-primary text-white shadow-soft"
              : "text-muted hover:text-white",
          )}
        >
          <ClipboardPaste size={16} /> Paste URIs
        </button>
      </div>

      {tab === "scan" ? <ScanMigration /> : <PasteUris />}
    </div>
  );
}

function ScanMigration() {
  const [entries, setEntries] = useState<ParsedOtpAuth[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(true);

  function onScan(text: string) {
    setError(null);
    try {
      if (isGoogleMigrationUri(text)) {
        const parsed = parseGoogleMigrationUri(text);
        if (parsed.length === 0) {
          throw new Error("Migration QR had no accounts.");
        }
        setEntries((prev) => mergeUnique(prev, parsed));
        setScanning(false);
      } else if (/^otpauth:\/\//i.test(text)) {
        setEntries((prev) => mergeUnique(prev, [parseOtpauthUri(text)]));
        setScanning(false);
      } else {
        throw new Error(
          "That QR isn't a Google migration code or otpauth:// URI.",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-4">
      {scanning ? (
        <>
          <QrScanner onScan={onScan} />
          {error && (
            <div className="flex gap-2 text-sm text-danger">
              <AlertTriangle size={16} className="mt-0.5" />
              {error}
            </div>
          )}
          <p className="text-xs text-muted text-center">
            Google Authenticator may show several QR codes — scan each one;
            Aegis will collect them.
          </p>
          {entries.length > 0 && (
            <button
              type="button"
              onClick={() => setScanning(false)}
              className="btn-ghost w-full"
            >
              Continue with {entries.length}{" "}
              {entries.length === 1 ? "account" : "accounts"}
            </button>
          )}
        </>
      ) : (
        <PreviewAndSave
          entries={entries}
          onScanMore={() => setScanning(true)}
          onChange={setEntries}
        />
      )}
    </div>
  );
}

function PasteUris() {
  const [text, setText] = useState("");
  const [entries, setEntries] = useState<ParsedOtpAuth[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  function onParse() {
    const lines = text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const ok: ParsedOtpAuth[] = [];
    const errs: string[] = [];
    for (const line of lines) {
      try {
        if (isGoogleMigrationUri(line)) {
          ok.push(...parseGoogleMigrationUri(line));
        } else {
          ok.push(parseOtpauthUri(line));
        }
      } catch (e) {
        errs.push(
          `${line.slice(0, 40)}${line.length > 40 ? "…" : ""}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
    setEntries(ok);
    setErrors(errs);
  }

  if (entries.length > 0) {
    return (
      <PreviewAndSave
        entries={entries}
        onChange={setEntries}
        onScanMore={() => {
          setEntries([]);
          setText("");
          setErrors([]);
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      <label className="label">otpauth:// URIs (one per line)</label>
      <textarea
        className="input font-mono text-xs leading-relaxed min-h-[180px] resize-y"
        placeholder={
          "otpauth://totp/GitHub:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub\notpauth://totp/Google:alice?secret=...&issuer=Google"
        }
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
      />
      {errors.length > 0 && (
        <div className="card p-3 border-danger/30 text-xs text-danger space-y-1 max-h-40 overflow-auto">
          {errors.map((e, i) => (
            <div key={i}>• {e}</div>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={onParse}
        disabled={!text.trim()}
        className="btn-primary w-full"
      >
        Parse & preview
      </button>
    </div>
  );
}

function PreviewAndSave({
  entries,
  onChange,
  onScanMore,
}: {
  entries: ParsedOtpAuth[];
  onChange: (e: ParsedOtpAuth[]) => void;
  onScanMore: () => void;
}) {
  const navigate = useNavigate();
  const { saveEntry } = useVault();
  const folders =
    useLiveQuery<Folder[]>(
      () => db().folders.orderBy("sortOrder").toArray(),
      [],
    ) ?? [];
  const [folderId, setFolderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const count = entries.length;

  async function saveAll() {
    setBusy(true);
    setError(null);
    try {
      for (const e of entries) {
        await saveEntry({
          folderId: folderId || null,
          issuer: e.issuer,
          account: e.account,
          secret: {
            secret: e.secret,
            algorithm: e.algorithm,
            digits: e.digits,
            period: e.period,
            type: e.type,
            counter: e.counter,
          },
        });
      }
      navigate({ to: "/" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="font-medium">
            {count} {count === 1 ? "account" : "accounts"} ready to import
          </div>
          <button
            type="button"
            onClick={onScanMore}
            className="text-xs text-accent hover:text-accent-hover"
          >
            Scan more
          </button>
        </div>
        <div className="space-y-1.5 max-h-80 overflow-auto -mx-1 px-1">
          {entries.map((e, i) => (
            <div
              key={`${e.issuer}:${e.account}:${i}`}
              className="flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06]"
            >
              <Check size={14} className="text-success shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">
                  <span className="font-medium">{e.issuer || "—"}</span>
                  <span className="text-muted"> · {e.account || "—"}</span>
                </div>
                <div className="text-[11px] text-muted">
                  {e.type} · {e.algorithm} · {e.digits} digits
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  onChange(entries.filter((_, idx) => idx !== i))
                }
                className="text-xs text-muted hover:text-danger"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <label className="label">Folder for these accounts</label>
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

      {error && (
        <div className="flex gap-2 text-sm text-danger">
          <AlertTriangle size={16} className="mt-0.5" />
          {error}
        </div>
      )}

      <button
        type="button"
        disabled={busy || count === 0}
        onClick={saveAll}
        className="btn-primary w-full"
      >
        {busy ? "Saving…" : `Import ${count}`}
      </button>
    </div>
  );
}

function mergeUnique(
  existing: ParsedOtpAuth[],
  incoming: ParsedOtpAuth[],
): ParsedOtpAuth[] {
  const seen = new Set(existing.map((e) => `${e.issuer}:${e.account}:${e.secret}`));
  const out = [...existing];
  for (const i of incoming) {
    const key = `${i.issuer}:${i.account}:${i.secret}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(i);
    }
  }
  return out;
}


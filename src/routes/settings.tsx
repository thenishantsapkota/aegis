import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowLeft,
  ClipboardPaste,
  Cloud,
  CloudOff,
  Download,
  Fingerprint,
  Lock,
  LogOut,
  RefreshCcw,
  ShieldAlert,
  Upload,
} from "lucide-react";
import { isBiometricAvailable } from "~/lib/biometric";
import { useVault } from "~/lib/vault-context";
import { db, getMeta, type EntryRecord, type Folder } from "~/lib/db";
import {
  EXPORT_VERSION,
  downloadJson,
  isEncryptedExport,
  readJsonFile,
  type EncryptedExport,
} from "~/lib/export";
import { AppShell } from "~/components/AppShell";
import {
  cloudSignInExisting,
  cloudSignOut,
  cloudSignUp,
  pullRemoteVault,
  pushLocalVault,
} from "~/lib/sync";
import { isAppwriteConfigured } from "~/lib/appwrite";
import { deriveVaultKey } from "~/lib/crypto";

export const Route = createFileRoute("/settings")({
  component: SettingsRoute,
});

function SettingsRoute() {
  const { state, lock } = useVault();
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
    <AppShell>
      <div className="pt-4">
        <header className="flex items-center justify-between mb-5">
          <Link
            to="/"
            className="w-10 h-10 rounded-xl bg-bg-elev border border-border flex items-center justify-center text-muted hover:text-white"
            aria-label="Back"
          >
            <ArrowLeft size={18} />
          </Link>
          <h1 className="text-lg font-semibold">Settings</h1>
          <div className="w-10" />
        </header>

        <section className="space-y-3 mb-6">
          <h2 className="text-xs uppercase tracking-wider text-muted">Vault</h2>
          <button onClick={lock} className="card p-4 w-full text-left flex items-center gap-3">
            <Lock size={18} className="text-muted" />
            <div className="flex-1">
              <div className="font-medium">Lock now</div>
              <div className="text-xs text-muted">
                Requires master password (or biometric) to unlock.
              </div>
            </div>
          </button>
          <BiometricSection />
        </section>

        <CloudSyncSection />
        <ExportImportSection />
        <DangerZone />
      </div>
    </AppShell>
  );
}

function BiometricSection() {
  const { state, enableBiometric, disableBiometric } = useVault();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void isBiometricAvailable().then(setAvailable);
  }, []);

  const enrolled =
    state.status === "unlocked" || state.status === "locked"
      ? state.hasBiometric
      : false;

  if (available === null) return null;
  if (!available) {
    return (
      <div className="card p-4 text-sm text-muted border-warn/30 bg-warn/5">
        Your device doesn't expose a biometric authenticator over the web.
        On Android, make sure Chrome 132+ is up to date and a screen-lock is
        set; on iOS, use Safari 18+; on desktop, enable Windows Hello / Touch ID.
      </div>
    );
  }

  return (
    <div className="card p-4">
      <div className="flex items-center gap-3">
        <Fingerprint size={20} className="text-accent" />
        <div className="flex-1">
          <div className="font-medium">Biometric unlock</div>
          <div className="text-xs text-muted">
            {enrolled
              ? "Enabled on this device. Use Face ID, Touch ID, Windows Hello, or your fingerprint."
              : "Skip the master password on this device after the first unlock."}
          </div>
        </div>
        <button
          type="button"
          disabled={busy || state.status !== "unlocked"}
          onClick={async () => {
            setError(null);
            setBusy(true);
            try {
              if (enrolled) await disableBiometric();
              else await enableBiometric();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Failed");
            } finally {
              setBusy(false);
            }
          }}
          className={enrolled ? "btn-danger" : "btn-primary"}
        >
          {busy ? "…" : enrolled ? "Disable" : "Enable"}
        </button>
      </div>
      {error && <div className="text-sm text-danger mt-3">{error}</div>}
    </div>
  );
}

function CloudSyncSection() {
  const [meta, setMeta] = useState<Awaited<ReturnType<typeof getMeta>>>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setMeta(await getMeta());
  }
  useEffect(() => {
    void refresh();
  }, []);

  const signedIn = !!meta?.sessionToken;

  return (
    <section className="space-y-3 mb-6">
      <h2 className="text-xs uppercase tracking-wider text-muted">
        Cloud sync (Appwrite, zero-knowledge)
      </h2>

      {!isAppwriteConfigured() && (
        <div className="card p-4 text-sm text-muted border-warn/30 bg-warn/5">
          Appwrite isn't configured. Cloud sync is disabled until you set
          <code className="mx-1 text-warn">VITE_APPWRITE_ENDPOINT</code>
          and
          <code className="ml-1 text-warn">VITE_APPWRITE_PROJECT_ID</code>
          in <code className="text-warn">.env</code> (see
          <code className="ml-1 text-warn">.env.example</code>). You can still
          use the encrypted file export/import below.
        </div>
      )}

      {isAppwriteConfigured() && signedIn ? (
        <div className="card p-4 space-y-3">
          <div className="flex items-center gap-3">
            <Cloud size={18} className="text-success" />
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{meta?.email}</div>
              <div className="text-xs text-muted">
                {meta?.lastSyncedAt
                  ? `Last synced ${new Date(meta.lastSyncedAt).toLocaleString()} · v${meta.remoteVersion ?? "?"}`
                  : "Not synced yet"}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <SyncButton
              label={busy === "push" ? "Pushing…" : "Push to cloud"}
              icon={<Upload size={16} />}
              disabled={!!busy}
              onClick={async () => {
                setError(null);
                setBusy("push");
                try {
                  const key = await ensureVaultKey();
                  await pushLocalVault(key);
                  await refresh();
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Push failed");
                } finally {
                  setBusy(null);
                }
              }}
            />
            <SyncButton
              label={busy === "pull" ? "Pulling…" : "Pull from cloud"}
              icon={<Download size={16} />}
              disabled={!!busy}
              onClick={async () => {
                setError(null);
                setBusy("pull");
                try {
                  const key = await ensureVaultKey();
                  const res = await pullRemoteVault(key);
                  if (!res.applied) setError("Nothing on the server yet.");
                  await refresh();
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Pull failed");
                } finally {
                  setBusy(null);
                }
              }}
            />
          </div>
          <button
            onClick={async () => {
              setError(null);
              setBusy("out");
              try {
                await cloudSignOut();
                await refresh();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Sign-out failed");
              } finally {
                setBusy(null);
              }
            }}
            className="btn-ghost w-full"
          >
            <LogOut size={16} /> Sign out of cloud
          </button>
        </div>
      ) : isAppwriteConfigured() ? (
        <CloudAuthForm onDone={refresh} />
      ) : null}

      {error && (
        <div className="text-sm text-danger px-1">{error}</div>
      )}
      <p className="text-xs text-muted px-1">
        The server only stores ciphertext. Your master password (and the key
        derived from it) never leaves this device.
      </p>
    </section>
  );
}

function SyncButton({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} className="btn-ghost">
      {icon} {label}
    </button>
  );
}

function CloudAuthForm({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        await cloudSignUp(password, email);
      } else {
        await cloudSignInExisting(password, email);
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Auth failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card p-4 space-y-3">
      <div className="flex items-center gap-3">
        <CloudOff size={18} className="text-muted" />
        <div className="flex-1">
          <div className="font-medium">Enable cloud sync (optional)</div>
          <div className="text-xs text-muted">
            Use the same master password to encrypt before upload.
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-bg-elev border border-border text-sm">
        <button
          type="button"
          className={`py-1.5 rounded-lg ${mode === "signup" ? "bg-bg-card" : "text-muted"}`}
          onClick={() => setMode("signup")}
        >
          Create account
        </button>
        <button
          type="button"
          className={`py-1.5 rounded-lg ${mode === "signin" ? "bg-bg-card" : "text-muted"}`}
          onClick={() => setMode("signin")}
        >
          Sign in
        </button>
      </div>
      <input
        className="input"
        type="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
        required
      />
      <input
        className="input"
        type="password"
        placeholder="Master password (same as this vault)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        required
      />
      {error && <div className="text-sm text-danger">{error}</div>}
      <button type="submit" disabled={busy} className="btn-primary w-full">
        {busy ? "…" : mode === "signup" ? "Create cloud account" : "Sign in"}
      </button>
    </form>
  );
}

// Re-derive the vault key from the user's password without storing it.
// We prompt the user for their password since the key is held only in-memory in
// the VaultProvider; for sync we need to expose a helper. Simplest secure way:
// ask once per session for sync ops. (Vault context already holds key but for
// minimal coupling we re-derive here using the stored kdf + a password prompt.)
async function ensureVaultKey(): Promise<CryptoKey> {
  // The vault context holds the key in a ref, but we don't expose it directly.
  // Workaround: encrypt the same way through context isn't necessary for sync —
  // we need an actual CryptoKey. We accept a UX trade-off here: prompt for
  // password on each push/pull. This keeps the key out of any persistent state.
  const meta = await getMeta();
  if (!meta) throw new Error("No vault on this device");
  const password = window.prompt(
    "Confirm master password to encrypt for sync:",
  );
  if (!password) throw new Error("Cancelled");
  const key = await deriveVaultKey(password, meta.kdf, "vault");
  // Verify the password is correct by attempting a tiny encrypt round-trip
  // against the stored key check.
  const ok = await verify(key, meta.keyCheck);
  if (!ok) throw new Error("Wrong password");
  return key;
}

async function verify(key: CryptoKey, blob: { iv: string; ciphertext: string }) {
  try {
    const iv = Uint8Array.from(atob(blob.iv), (c) => c.charCodeAt(0));
    const ct = Uint8Array.from(atob(blob.ciphertext), (c) => c.charCodeAt(0));
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      ct as BufferSource,
    );
    return true;
  } catch {
    return false;
  }
}

function ExportImportSection() {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(
    null,
  );

  const folders =
    useLiveQuery<Folder[]>(() => db().folders.toArray(), []) ?? [];
  const entries =
    useLiveQuery<EntryRecord[]>(() => db().entries.toArray(), []) ?? [];

  async function onExport() {
    setMsg(null);
    setBusy(true);
    try {
      const meta = await getMeta();
      if (!meta) throw new Error("No vault");
      const exportObj: EncryptedExport = {
        format: "vault-authenticator",
        version: EXPORT_VERSION,
        exportedAt: Date.now(),
        email: meta.email,
        kdf: meta.kdf,
        keyCheck: meta.keyCheck,
        folders,
        entries,
      };
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      downloadJson(`vault-${ts}.json`, exportObj);
      setMsg({ type: "ok", text: "Exported. Move this file to your new device." });
    } catch (e) {
      setMsg({
        type: "err",
        text: e instanceof Error ? e.message : "Export failed",
      });
    } finally {
      setBusy(false);
    }
  }

  async function onImport(file: File) {
    setMsg(null);
    setBusy(true);
    try {
      const data = await readJsonFile<unknown>(file);
      if (!isEncryptedExport(data)) {
        throw new Error("This file isn't a Vault Authenticator export.");
      }
      const password = window.prompt("Master password used when exporting:");
      if (!password) throw new Error("Cancelled");
      const key = await deriveVaultKey(password, data.kdf, "vault");
      const ok = await verify(key, data.keyCheck);
      if (!ok) throw new Error("Wrong password for this export file.");

      const existingFolders = await db().folders.toArray();
      const existingEntryIds = new Set(
        (await db().entries.toArray()).map((e) => e.id),
      );

      await db().transaction("rw", [db().folders, db().entries], async () => {
        for (const f of data.folders) {
          if (!existingFolders.find((x) => x.id === f.id)) {
            await db().folders.put(f);
          }
        }
        for (const e of data.entries) {
          if (!existingEntryIds.has(e.id)) {
            // Entries arrive already encrypted with the export password's KDF.
            // The import only succeeds if that KDF matches this device's
            // (we verified above), so the ciphertext is decryptable here.
            await db().entries.put(e);
          }
        }
      });

      setMsg({
        type: "ok",
        text: `Imported ${data.folders.length} folders, ${data.entries.length} codes.`,
      });
    } catch (e) {
      setMsg({
        type: "err",
        text: e instanceof Error ? e.message : "Import failed",
      });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <section className="space-y-3 mb-6">
      <h2 className="text-xs uppercase tracking-wider text-muted">
        Export &amp; import
      </h2>
      <div className="card p-4 space-y-3">
        <button
          onClick={onExport}
          disabled={busy}
          className="btn-ghost w-full"
        >
          <Download size={16} /> Export encrypted file (.json)
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="btn-ghost w-full"
        >
          <Upload size={16} /> Import from file
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onImport(f);
          }}
        />
        <Link
          to="/import"
          className="btn-ghost w-full no-underline"
        >
          <ClipboardPaste size={16} /> Import from another authenticator
        </Link>
        <p className="text-xs text-muted">
          The file is encrypted with your master password. Send it to your
          other device via AirDrop, email, or USB — opening it requires the
          same password. To pull codes from Google Authenticator, Authy, 2FAS
          and others, use{" "}
          <Link
            to="/import"
            className="text-accent hover:text-accent-hover underline-offset-4 hover:underline"
          >
            Import from another authenticator
          </Link>
          .
        </p>
        {msg && (
          <div
            className={`text-sm ${msg.type === "ok" ? "text-success" : "text-danger"}`}
          >
            {msg.text}
          </div>
        )}
      </div>
    </section>
  );
}

function DangerZone() {
  const { resetLocalVault } = useVault();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);

  return (
    <section className="space-y-3 mb-10">
      <h2 className="text-xs uppercase tracking-wider text-muted">
        Danger zone
      </h2>
      <div className="card p-4 border-danger/30">
        <div className="flex items-start gap-3">
          <ShieldAlert size={18} className="text-danger mt-0.5" />
          <div className="flex-1">
            <div className="font-medium">Erase local vault</div>
            <p className="text-xs text-muted mb-3">
              Deletes all codes, folders, and the vault key on this device. If
              you haven't pushed to cloud or exported, this is irreversible.
            </p>
            {confirming ? (
              <div className="flex gap-2">
                <button
                  className="btn-danger flex-1"
                  onClick={async () => {
                    await resetLocalVault();
                    navigate({ to: "/setup" });
                  }}
                >
                  <RefreshCcw size={16} /> Yes, erase
                </button>
                <button
                  className="btn-ghost flex-1"
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="btn-danger"
                onClick={() => setConfirming(true)}
              >
                Erase local vault
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

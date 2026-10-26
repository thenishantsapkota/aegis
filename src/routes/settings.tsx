import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowRightLeft,
  ChevronRight,
  Cloud,
  CloudDownload,
  CloudOff,
  CloudUpload,
  Download,
  Fingerprint,
  Lock,
  LogOut,
  Trash2,
  Upload,
  type LucideIcon,
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
import { ToggleSwitch } from "~/components/ui/toggle-switch";
import { FluidTabs } from "~/components/ui/fluid-tabs";
import { cn } from "~/lib/cn";
import {
  cloudSignInExisting,
  cloudSignOut,
  cloudSignUp,
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
      <div className="h-safe-screen" aria-busy="true" />
    );
  }

  return (
    <AppShell>
      <div className="pt-5">
        <h1 className="text-2xl font-semibold tracking-tight mb-6">Settings</h1>

        <Group title="Security">
          <Row
            icon={Lock}
            label="Lock now"
            detail="Stays unlocked for an hour after you unlock, even across reloads."
            onClick={lock}
          />
          <BiometricRow />
        </Group>

        <CloudSyncSection />
        <ExportImportSection />
        <DangerZone />
      </div>
    </AppShell>
  );
}

function BiometricRow() {
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

  return (
    <Row
      icon={Fingerprint}
      label="Biometric unlock"
      detail={
        error ? (
          <span className="text-danger">{error}</span>
        ) : !available ? (
          "Not available in this browser. Needs Face ID, Touch ID, Windows Hello or a fingerprint sensor with a screen lock."
        ) : enrolled ? (
          "On for this device."
        ) : (
          "Unlock with Face ID, Touch ID or your fingerprint."
        )
      }
      trailing={
        <ToggleSwitch
          label="Biometric unlock"
          checked={enrolled}
          disabled={!available || busy || state.status !== "unlocked"}
          onChange={async (next) => {
            setError(null);
            setBusy(true);
            try {
              if (next) await enableBiometric();
              else await disableBiometric();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Failed");
            } finally {
              setBusy(false);
            }
          }}
        />
      }
    />
  );
}

function CloudSyncSection() {
  const { pushNow, pullNow } = useVault();
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

  async function run(kind: string, action: () => Promise<void>, fallback: string) {
    setError(null);
    setBusy(kind);
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : fallback);
    } finally {
      setBusy(null);
    }
  }

  const footer = (
    <>
      {error && <span className="block text-danger mb-1">{error}</span>}
      The server only stores encrypted data. Your master password never leaves
      this device.
    </>
  );

  if (!isAppwriteConfigured()) {
    return (
      <Group title="Cloud sync" footer="Encrypted file export below still works.">
        <Row
          icon={CloudOff}
          label="Not configured"
          detail="Set VITE_APPWRITE_ENDPOINT and VITE_APPWRITE_PROJECT_ID in .env (see .env.example)."
        />
      </Group>
    );
  }

  if (!signedIn) {
    return (
      <Group title="Cloud sync" footer={footer}>
        <CloudAuthForm onDone={refresh} />
      </Group>
    );
  }

  return (
    <Group title="Cloud sync" footer={footer}>
      <Row
        icon={Cloud}
        label={meta?.email ?? "Signed in"}
        detail={
          meta?.lastSyncedAt
            ? `Last synced ${new Date(meta.lastSyncedAt).toLocaleString()}`
            : "Not synced yet"
        }
      />
      <Row
        icon={CloudUpload}
        label={busy === "push" ? "Pushing…" : "Push to cloud"}
        onClick={busy ? undefined : () => run("push", pushNow, "Push failed")}
      />
      <Row
        icon={CloudDownload}
        label={busy === "pull" ? "Pulling…" : "Pull from cloud"}
        onClick={
          busy
            ? undefined
            : () =>
                run(
                  "pull",
                  async () => {
                    if (!(await pullNow())) throw new Error("Nothing on the server yet.");
                  },
                  "Pull failed",
                )
        }
      />
      <Row
        icon={LogOut}
        label={busy === "out" ? "Signing out…" : "Sign out of cloud"}
        tone="danger"
        onClick={busy ? undefined : () => run("out", cloudSignOut, "Sign-out failed")}
      />
    </Group>
  );
}

function CloudAuthForm({ onDone }: { onDone: () => void }) {
  const { unlock } = useVault();
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
        // Sign-in may have just replaced our local KDF/keyCheck with the
        // cloud's. Re-derive the in-memory vault key against the new meta so
        // entries decrypt correctly afterwards.
        await cloudSignInExisting(password, email);
        await unlock(password);
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Auth failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="p-4 space-y-4">
      <p className="text-sm text-zinc-400">
        Optional. Uses this vault's master password to encrypt before upload.
      </p>
      <FluidTabs
        activeIndex={mode === "signup" ? 0 : 1}
        onActiveIndexChange={(i) => setMode(i === 0 ? "signup" : "signin")}
      >
        <FluidTabs.List aria-label="Cloud account">
          <FluidTabs.Tab>Create account</FluidTabs.Tab>
          <FluidTabs.Tab>Sign in</FluidTabs.Tab>
        </FluidTabs.List>
      </FluidTabs>
      <div>
        <label className="label" htmlFor="cloud-email">Email</label>
        <input
          id="cloud-email"
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
      </div>
      <div>
        <label className="label" htmlFor="cloud-pw">Master password</label>
        <input
          id="cloud-pw"
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button type="submit" disabled={busy} className="btn-primary w-full">
        {busy ? "…" : mode === "signup" ? "Create cloud account" : "Sign in"}
      </button>
    </form>
  );
}

// Used by encrypted-file import only — that flow may use a different password
// than the current vault, so we still need to prompt and verify it.
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
    <Group
      title="Backup and import"
      footer={
        msg ? (
          <span className={msg.type === "ok" ? "text-success" : "text-danger"}>
            {msg.text}
          </span>
        ) : (
          "Export files are encrypted with your master password and need it to open."
        )
      }
    >
      <Row
        icon={Download}
        label="Export encrypted file"
        onClick={busy ? undefined : onExport}
      />
      <Row
        icon={Upload}
        label="Import from file"
        onClick={busy ? undefined : () => fileRef.current?.click()}
      />
      <Row
        icon={ArrowRightLeft}
        label="Import from another authenticator"
        detail="Google Authenticator, Authy, 2FAS and others"
        to="/import"
      />
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
    </Group>
  );
}

function DangerZone() {
  const { resetLocalVault } = useVault();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);

  return (
    <Group
      footer="Deletes every code, folder and the vault key on this device. Without a cloud copy or export, it can't be undone."
    >
      {confirming ? (
        <div className="flex items-center gap-2 px-4 py-3">
          <span className="flex-1 text-[15px]">Erase everything?</span>
          <button className="btn-ghost !py-2" onClick={() => setConfirming(false)}>
            Cancel
          </button>
          <button
            className="btn-danger !py-2"
            onClick={async () => {
              await resetLocalVault();
              navigate({ to: "/setup" });
            }}
          >
            Erase
          </button>
        </div>
      ) : (
        <Row
          icon={Trash2}
          label="Erase local vault"
          tone="danger"
          onClick={() => setConfirming(true)}
        />
      )}
    </Group>
  );
}

// A settings section: an optional heading over one rounded container of
// hairline-separated rows, with an optional note underneath.
function Group({
  title,
  footer,
  children,
}: {
  title?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-8">
      {title && (
        <h2 className="px-1 mb-2 text-sm font-medium text-zinc-400">{title}</h2>
      )}
      <div className="rounded-2xl bg-bg-elev divide-y divide-white/[0.06] overflow-hidden">
        {children}
      </div>
      {footer && (
        <p className="px-1 mt-2 text-xs leading-relaxed text-zinc-500">{footer}</p>
      )}
    </section>
  );
}

// One settings row. Pass `onClick` for an action, `to` for a link (gets a
// chevron), or neither for a static row; `trailing` sits on the right.
function Row({
  icon: Icon,
  label,
  detail,
  trailing,
  onClick,
  to,
  tone,
}: {
  icon?: LucideIcon;
  label: ReactNode;
  detail?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  to?: "/import";
  tone?: "danger";
}) {
  const body = (
    <>
      {Icon && (
        <Icon
          size={19}
          strokeWidth={1.75}
          className={cn(
            "shrink-0 self-start mt-px",
            tone === "danger" ? "text-danger" : "text-zinc-400",
          )}
        />
      )}
      <span className="flex-1 min-w-0">
        <span
          className={cn(
            "block text-[15px] truncate",
            tone === "danger" ? "text-danger" : "text-zinc-100",
          )}
        >
          {label}
        </span>
        {detail && (
          <span className="block mt-0.5 text-xs leading-relaxed text-zinc-500">
            {detail}
          </span>
        )}
      </span>
      {to ? <ChevronRight size={16} className="text-zinc-600" /> : trailing}
    </>
  );
  const cls = cn(
    "w-full flex items-center gap-3.5 px-4 py-3.5 text-left min-h-[52px]",
    (onClick || to) && "hover:bg-white/[0.03] active:bg-white/[0.05] transition-colors",
    tone === "danger" && "text-danger",
  );
  if (to) {
    return (
      <Link to={to} className={cls}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cls}>
        {body}
      </button>
    );
  }
  return <div className={cls}>{body}</div>;
}

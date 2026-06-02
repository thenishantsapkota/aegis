import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  ShieldCheck,
  KeyRound,
  AlertTriangle,
  CloudDownload,
} from "lucide-react";
import { useVault } from "~/lib/vault-context";
import { isAppwriteConfigured } from "~/lib/appwrite";

export const Route = createFileRoute("/setup")({
  component: SetupRoute,
});

function SetupRoute() {
  const { state, initialize } = useVault();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.status === "loading") {
    return (
      <div className="h-safe-screen flex items-center justify-center text-muted">
        Loading…
      </div>
    );
  }
  if (state.status !== "uninitialized") {
    // Already have a vault — bounce.
    navigate({ to: "/" });
    return null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      await initialize(password);
      navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create vault");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-safe-screen flex items-center justify-center px-4 pt-safe pb-safe">
      <div className="w-full max-w-md card p-6 animate-fade-in">
        <div className="flex items-center gap-3 mb-5">
          <span className="inline-flex items-center justify-center w-11 h-11 rounded-2xl bg-accent/15 text-accent">
            <ShieldCheck size={22} />
          </span>
          <div>
            <h1 className="text-xl font-semibold">Create your vault</h1>
            <p className="text-sm text-muted">
              Codes are encrypted on this device.
            </p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="label">Master password</label>
            <input
              type="password"
              autoComplete="new-password"
              autoFocus
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </div>
          <div>
            <label className="label">Confirm</label>
            <input
              type="password"
              autoComplete="new-password"
              className="input"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat your password"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-danger">
              <AlertTriangle size={16} className="mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="rounded-xl bg-warn/10 border border-warn/30 p-3 text-xs text-warn flex gap-2">
            <KeyRound size={16} className="mt-0.5 shrink-0" />
            <span>
              If you forget this password, your codes cannot be recovered. We
              never see it. Save it in a password manager.
            </span>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="btn-primary w-full"
          >
            {busy ? "Creating vault…" : "Create vault"}
          </button>
        </form>

        {isAppwriteConfigured() && (
          <>
            <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-[0.08em] text-muted">
              <div className="flex-1 h-px bg-white/[0.08]" />
              or
              <div className="flex-1 h-px bg-white/[0.08]" />
            </div>
            <Link
              to="/restore"
              className="btn-ghost w-full"
              aria-label="Sign in to existing account"
            >
              <CloudDownload size={18} />
              Sign in to existing account
            </Link>
            <p className="text-xs text-muted text-center mt-3">
              Already set up Aegis on another device? Sign in to pull your
              codes here.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

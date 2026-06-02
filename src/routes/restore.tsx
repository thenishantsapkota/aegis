import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, CloudDownload, AlertTriangle } from "lucide-react";
import { useVault } from "~/lib/vault-context";
import { cloudSignInFresh } from "~/lib/sync";
import { isAppwriteConfigured } from "~/lib/appwrite";

// Sign in from a NEW device (no local vault yet) and pull the encrypted vault
// down from Appwrite. Decrypts client-side with the master password.
export const Route = createFileRoute("/restore")({
  component: RestoreRoute,
});

function RestoreRoute() {
  const { state, refresh } = useVault();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isAppwriteConfigured()) {
      setError(
        "Cloud sync isn't configured. Set Appwrite env vars (see .env.example).",
      );
      return;
    }
    setBusy(true);
    try {
      await cloudSignInFresh(password, email);
      await refresh();
      navigate({ to: "/unlock" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-safe-screen flex items-center justify-center px-4 pt-safe pb-safe">
      <div className="w-full max-w-md card p-6 animate-fade-in">
        <div className="flex items-center gap-3 mb-5">
          <span className="inline-flex items-center justify-center w-11 h-11 rounded-2xl bg-accent/15 text-accent">
            <CloudDownload size={22} />
          </span>
          <div className="flex-1">
            <h1 className="text-xl font-semibold">Restore from cloud</h1>
            <p className="text-sm text-muted">
              Use this on a new device after signing up elsewhere.
            </p>
          </div>
          <Link
            to={state.status === "uninitialized" ? "/setup" : "/unlock"}
            className="w-9 h-9 rounded-xl bg-bg-elev border border-border flex items-center justify-center"
            aria-label="Back"
          >
            <ArrowLeft size={16} />
          </Link>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="label">Email</label>
            <input
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>
          <div>
            <label className="label">Master password</label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {error && (
            <div className="flex items-start gap-2 text-sm text-danger">
              <AlertTriangle size={16} className="mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? "Restoring…" : "Restore vault"}
          </button>
        </form>
      </div>
    </div>
  );
}

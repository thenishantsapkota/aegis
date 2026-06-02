import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Cloud,
  KeyRound,
} from "lucide-react";
import { useVault } from "~/lib/vault-context";
import { isAppwriteConfigured } from "~/lib/appwrite";

// Create a cloud account directly on first-time use. No local-vault-first dance.
export const Route = createFileRoute("/signup")({
  component: SignUpRoute,
});

function SignUpRoute() {
  const { state, signUpCloud } = useVault();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
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
    navigate({ to: "/" });
    return null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isAppwriteConfigured()) {
      setError(
        "Cloud sync isn't configured. Set Appwrite env vars (see .env.example).",
      );
      return;
    }
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
      await signUpCloud(password, email.trim());
      navigate({ to: "/" });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create cloud account",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-safe-screen flex items-center justify-center px-4 pt-safe pb-safe">
      <div className="w-full max-w-md card p-6 animate-fade-in">
        <div className="flex items-center gap-3 mb-5">
          <span className="inline-flex items-center justify-center w-11 h-11 rounded-2xl bg-accent/15 text-accent">
            <Cloud size={22} />
          </span>
          <div className="flex-1">
            <h1 className="text-xl font-semibold">Create cloud account</h1>
            <p className="text-sm text-muted">
              Sync across devices from day one.
            </p>
          </div>
          <Link
            to="/setup"
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
              autoFocus
              required
            />
          </div>
          <div>
            <label className="label">Master password</label>
            <input
              type="password"
              autoComplete="new-password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              required
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
              required
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
              Your master password encrypts the vault end-to-end. We never see
              it — if you forget it, your codes can't be recovered.
            </span>
          </div>

          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? "Creating account…" : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}

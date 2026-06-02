import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Lock, AlertTriangle, Fingerprint } from "lucide-react";
import { useVault } from "~/lib/vault-context";
import { isBiometricAvailable } from "~/lib/biometric";

export const Route = createFileRoute("/unlock")({
  component: UnlockRoute,
});

function UnlockRoute() {
  const { state, unlock, unlockWithBiometric } = useVault();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bioOk, setBioOk] = useState(false);

  useEffect(() => {
    void isBiometricAvailable().then(setBioOk);
  }, []);

  if (state.status === "loading") {
    return (
      <div className="h-safe-screen flex items-center justify-center text-muted">
        Loading…
      </div>
    );
  }
  if (state.status === "uninitialized") {
    navigate({ to: "/setup" });
    return null;
  }
  if (state.status === "unlocked") {
    navigate({ to: "/" });
    return null;
  }

  const canUseBiometric = bioOk && state.hasBiometric;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const ok = await unlock(password);
      if (!ok) setError("Wrong password.");
      else navigate({ to: "/" });
    } finally {
      setBusy(false);
    }
  }

  async function onBiometric() {
    setError(null);
    setBioBusy(true);
    try {
      const ok = await unlockWithBiometric();
      if (!ok) setError("Biometric unlock isn't set up on this device.");
      else navigate({ to: "/" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Biometric unlock failed");
    } finally {
      setBioBusy(false);
    }
  }

  return (
    <div className="h-safe-screen flex items-center justify-center px-4 pt-safe pb-safe">
      <div className="w-full max-w-md card p-6 animate-fade-in">
        <div className="flex items-center gap-3 mb-5">
          <span className="inline-flex items-center justify-center w-11 h-11 rounded-2xl bg-accent/15 text-accent">
            <Lock size={22} />
          </span>
          <div>
            <h1 className="text-xl font-semibold">Unlock your vault</h1>
            {state.email ? (
              <p className="text-sm text-muted truncate">{state.email}</p>
            ) : (
              <p className="text-sm text-muted">Enter your master password</p>
            )}
          </div>
        </div>

        {canUseBiometric && (
          <button
            type="button"
            disabled={bioBusy}
            onClick={onBiometric}
            className="btn-ghost w-full mb-4"
          >
            <Fingerprint size={18} />
            {bioBusy ? "Waiting for biometric…" : "Unlock with biometric"}
          </button>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="label">Master password</label>
            <input
              type="password"
              autoComplete="current-password"
              autoFocus
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && (
            <div className="flex items-start gap-2 text-sm text-danger">
              <AlertTriangle size={16} className="mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          <button
            type="submit"
            disabled={busy || !password}
            className="btn-primary w-full"
          >
            {busy ? "Unlocking…" : "Unlock"}
          </button>
          <div className="text-center text-sm text-muted">
            <Link
              to="/restore"
              className="hover:text-white underline-offset-4 hover:underline"
            >
              Restore from cloud account
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}

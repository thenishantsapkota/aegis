import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Fingerprint } from "lucide-react";
import { AuthLayout, FooterLink, FormError } from "~/components/AuthLayout";
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

  // Redirect from an effect, not during render.
  useEffect(() => {
    if (state.status === "uninitialized") navigate({ to: "/setup" });
    else if (state.status === "unlocked") navigate({ to: "/" });
  }, [state.status, navigate]);

  if (state.status === "loading") {
    return (
      <div className="h-safe-screen" aria-busy="true" />
    );
  }
  if (state.status === "uninitialized" || state.status === "unlocked") {
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
    <AuthLayout
      title="Unlock Aegis"
      subtitle={state.email ?? "Enter your master password."}
      footer={
        <FooterLink
          text="On a new device?"
          link="Restore from your cloud account"
          to="/restore"
        />
      }
    >
      <form onSubmit={onSubmit} className="space-y-5">
        <div>
          <label className="label" htmlFor="pw">Master password</label>
          <input
            id="pw"
            type="password"
            autoComplete="current-password"
            autoFocus={!canUseBiometric}
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <FormError>{error}</FormError>}
        <button
          type="submit"
          disabled={busy || !password}
          className="btn-primary w-full"
        >
          {busy ? "Unlocking…" : "Unlock"}
        </button>
        {canUseBiometric && (
          <button
            type="button"
            disabled={bioBusy}
            onClick={onBiometric}
            className="btn-ghost w-full"
          >
            <Fingerprint size={18} />
            {bioBusy ? "Waiting for biometric…" : "Use biometric"}
          </button>
        )}
      </form>
    </AuthLayout>
  );
}

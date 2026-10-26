import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useVault } from "~/lib/vault-context";
import { cloudSignInFresh } from "~/lib/sync";
import { isAppwriteConfigured } from "~/lib/appwrite";
import { AuthLayout, FormError } from "~/components/AuthLayout";

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
    <AuthLayout
      back={state.status === "uninitialized" ? "/setup" : "/unlock"}
      title="Restore from the cloud"
      subtitle="Sign in to download your encrypted vault to this device."
    >
      <form onSubmit={onSubmit} className="space-y-5">
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input
            id="email"
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
          <label className="label" htmlFor="pw">Master password</label>
          <input
            id="pw"
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        {error && <FormError>{error}</FormError>}
        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? "Restoring…" : "Restore vault"}
        </button>
      </form>
    </AuthLayout>
  );
}

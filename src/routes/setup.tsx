import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useVault } from "~/lib/vault-context";
import { isAppwriteConfigured } from "~/lib/appwrite";
import { AuthLayout, FooterLink, FormError } from "~/components/AuthLayout";

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

  // Already have a vault: bounce. Redirect from an effect, not during render.
  const hasVault = state.status !== "loading" && state.status !== "uninitialized";
  useEffect(() => {
    if (hasVault) navigate({ to: "/" });
  }, [hasVault, navigate]);

  if (state.status === "loading") {
    return (
      <div className="h-safe-screen" aria-busy="true" />
    );
  }
  if (hasVault) return null;

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
    <AuthLayout
      title="Create your vault"
      subtitle="Your codes are encrypted on this device with a master password."
      footer={
        isAppwriteConfigured() && (
          <>
            <FooterLink
              text="Already use Aegis on another device?"
              link="Sign in"
              to="/restore"
            />
            <FooterLink
              text="Want sync from the start?"
              link="Create a cloud account"
              to="/signup"
            />
          </>
        )
      }
    >
      <form onSubmit={onSubmit} className="space-y-5">
        <div>
          <label className="label" htmlFor="pw">Master password</label>
          <input
            id="pw"
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
          <label className="label" htmlFor="pw2">Confirm password</label>
          <input
            id="pw2"
            type="password"
            autoComplete="new-password"
            className="input"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>

        <p className="text-sm leading-relaxed text-zinc-400">
          <span className="text-zinc-200">There's no password reset.</span> If
          you forget it, these codes can't be recovered, so keep it in a
          password manager.
        </p>

        {error && <FormError>{error}</FormError>}

        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? "Creating vault…" : "Create vault"}
        </button>
      </form>
    </AuthLayout>
  );
}

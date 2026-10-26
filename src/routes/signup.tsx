import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useVault } from "~/lib/vault-context";
import { isAppwriteConfigured } from "~/lib/appwrite";
import { AuthLayout, FormError } from "~/components/AuthLayout";

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

  // Already have a vault: bounce. Redirect from an effect, not during render.
  const hasVault = state.status !== "loading" && state.status !== "uninitialized";
  useEffect(() => {
    if (hasVault) navigate({ to: "/" });
  }, [hasVault, navigate]);

  if (state.status === "loading" || hasVault) {
    return <div className="h-safe-screen" aria-busy="true" />;
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
    <AuthLayout
      back="/setup"
      title="Create a cloud account"
      subtitle="Your vault syncs across your devices, encrypted before it leaves this one."
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
            autoComplete="new-password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            required
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
            required
          />
        </div>

        <p className="text-sm leading-relaxed text-zinc-400">
          <span className="text-zinc-200">We never see this password.</span>{" "}
          If you forget it, your codes can't be recovered.
        </p>

        {error && <FormError>{error}</FormError>}

        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? "Creating account…" : "Create account"}
        </button>
      </form>
    </AuthLayout>
  );
}

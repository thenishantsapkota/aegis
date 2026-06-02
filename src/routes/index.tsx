import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useVault } from "~/lib/vault-context";
import { AppShell } from "~/components/AppShell";
import { VaultView } from "~/components/VaultView";

export const Route = createFileRoute("/")({
  component: HomeRoute,
});

function HomeRoute() {
  const { state } = useVault();
  const navigate = useNavigate();

  useEffect(() => {
    if (state.status === "uninitialized") {
      navigate({ to: "/setup" });
    } else if (state.status === "locked") {
      navigate({ to: "/unlock" });
    }
  }, [state.status, navigate]);

  if (state.status !== "unlocked") {
    return (
      <div className="h-safe-screen flex items-center justify-center text-muted">
        <div className="animate-pulse">Loading vault…</div>
      </div>
    );
  }

  return (
    <AppShell>
      <VaultView />
    </AppShell>
  );
}

// Used at the bottom of empty states.
export function EmptyHint() {
  return (
    <div className="text-center text-muted py-12">
      <p className="mb-3">Your vault is empty.</p>
      <Link to="/add" className="btn-primary">
        Add your first code
      </Link>
    </div>
  );
}

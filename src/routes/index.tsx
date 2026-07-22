import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";
import { useVault } from "~/lib/vault-context";
import { AppShell } from "~/components/AppShell";
import { VaultView } from "~/components/VaultView";
import { isAppwriteConfigured } from "~/lib/appwrite";

export const Route = createFileRoute("/")({
  component: HomeRoute,
});

function HomeRoute() {
  const { state, pullNow, pushNow, refreshTeams } = useVault();
  const navigate = useNavigate();

  useEffect(() => {
    if (state.status === "uninitialized") {
      navigate({ to: "/setup" });
    } else if (state.status === "locked") {
      navigate({ to: "/unlock" });
    }
  }, [state.status, navigate]);

  const onRefresh = useCallback(async () => {
    if (!isAppwriteConfigured()) return;
    try {
      await pullNow();
    } catch (e) {
      console.warn("[swipe-sync] pull failed:", e);
    }
    try {
      await pushNow();
    } catch (e) {
      console.warn("[swipe-sync] push failed:", e);
    }
    // Also sync shared team vaults (pulls team codes other devices pushed).
    try {
      await refreshTeams();
    } catch (e) {
      console.warn("[swipe-sync] team refresh failed:", e);
    }
  }, [pullNow, pushNow, refreshTeams]);

  if (state.status !== "unlocked") {
    return (
      <div className="h-safe-screen flex items-center justify-center text-muted">
        <div className="animate-pulse">Loading vault…</div>
      </div>
    );
  }

  return (
    <AppShell onRefresh={onRefresh}>
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

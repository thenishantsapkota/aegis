import { Outlet, createRootRoute } from "@tanstack/react-router";
import { VaultProvider } from "~/lib/vault-context";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <VaultProvider>
      <Outlet />
    </VaultProvider>
  );
}

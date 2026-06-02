import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Plus, Settings as SettingsIcon } from "lucide-react";
import { cn } from "~/lib/cn";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col h-safe-screen">
      <div className="flex-1 overflow-y-auto pb-32 pt-safe pl-safe pr-safe">
        <div className="mx-auto w-full max-w-2xl px-4">{children}</div>
      </div>
      <BottomNav />
    </div>
  );
}

function BottomNav() {
  const { location } = useRouterState();
  const items = [
    { to: "/", label: "Codes", icon: Home },
    { to: "/add", label: "Add", icon: Plus, emphasized: true },
    { to: "/settings", label: "Settings", icon: SettingsIcon },
  ];
  return (
    <div
      className="fixed bottom-0 inset-x-0 z-40 pointer-events-none pb-safe"
      style={{ paddingBottom: "max(0.75rem, var(--safe-bottom))" }}
    >
      <nav
        className="pointer-events-auto mx-auto max-w-sm mx-4 grid grid-cols-3 gap-1 p-1.5 rounded-full"
        style={{
          background: "rgb(15 19 32 / 0.7)",
          border: "1px solid rgb(255 255 255 / 0.10)",
          backdropFilter: "blur(28px) saturate(160%)",
          WebkitBackdropFilter: "blur(28px) saturate(160%)",
          boxShadow:
            "0 1px 0 rgb(255 255 255 / 0.06) inset, 0 24px 48px -16px rgb(0 0 0 / 0.6)",
        }}
      >
        {items.map(({ to, label, icon: Icon, emphasized }) => {
          const active =
            to === "/"
              ? location.pathname === "/"
              : location.pathname.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 py-2 px-2 rounded-full text-[11px] font-medium transition-all duration-200",
                emphasized
                  ? ""
                  : active
                    ? "text-white"
                    : "text-muted hover:text-white",
              )}
            >
              {emphasized ? (
                <span
                  className="inline-flex items-center justify-center w-11 h-11 -my-1 rounded-full text-white"
                  style={{
                    background:
                      "linear-gradient(135deg, rgb(124 134 255) 0%, rgb(56 189 248) 100%)",
                    boxShadow:
                      "0 1px 0 rgb(255 255 255 / 0.2) inset, 0 10px 28px -6px rgb(124 134 255 / 0.55)",
                  }}
                >
                  <Icon size={22} />
                </span>
              ) : (
                <>
                  <span
                    className={cn(
                      "inline-flex items-center justify-center w-9 h-9 rounded-full transition-colors",
                      active && "bg-white/10",
                    )}
                  >
                    <Icon size={19} />
                  </span>
                  <span className="leading-none">{label}</span>
                </>
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

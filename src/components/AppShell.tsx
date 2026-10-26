import { Link, useRouterState } from "@tanstack/react-router";
import { KeyRound, Plus, Settings as SettingsIcon, RefreshCcw } from "lucide-react";
import { cn } from "~/lib/cn";
import { useEffect, useRef, useState, type ReactNode } from "react";

const PULL_THRESHOLD = 70; // px past which release triggers refresh
const PULL_MAX = 110; // visual ceiling so the rubber-band doesn't run away

// The whole app uses native document scroll — bullet-proof on iOS/Android.
// Pull-to-refresh attaches to window touch events, gated on document scrollTop.
export function AppShell({
  children,
  onRefresh,
}: {
  children: ReactNode;
  onRefresh?: () => Promise<void>;
}) {
  const startYRef = useRef<number | null>(null);
  const pullRef = useRef(0);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  pullRef.current = pull;

  useEffect(() => {
    if (!onRefresh) return;

    const docScrollTop = () =>
      window.scrollY ||
      document.documentElement.scrollTop ||
      document.body.scrollTop ||
      0;

    const onTouchStart = (e: TouchEvent) => {
      if (refreshing) return;
      if (docScrollTop() > 0) return;
      startYRef.current = e.touches[0].clientY;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (startYRef.current === null || refreshing) return;
      const dy = e.touches[0].clientY - startYRef.current;
      if (dy <= 0) {
        if (pullRef.current !== 0) setPull(0);
        startYRef.current = null; // hand control back to the browser
        return;
      }
      const damped = Math.min(PULL_MAX, dy * 0.55);
      setPull(damped);
      if (e.cancelable) e.preventDefault();
    };
    const onTouchEnd = async () => {
      const dy = pullRef.current;
      startYRef.current = null;
      if (dy >= PULL_THRESHOLD && !refreshing) {
        setRefreshing(true);
        setPull(PULL_THRESHOLD);
        try {
          await onRefresh();
        } catch {
          /* swallow */
        } finally {
          setRefreshing(false);
          setPull(0);
        }
      } else {
        setPull(0);
      }
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [onRefresh, refreshing]);

  const progress = Math.min(1, pull / PULL_THRESHOLD);
  const showIndicator = pull > 0 || refreshing;

  return (
    <div className="pt-safe pl-safe pr-safe pb-24 relative">
      {onRefresh && (
        <div
          className="pointer-events-none fixed left-0 right-0 z-30 flex justify-center"
          style={{
            top: "calc(env(safe-area-inset-top, 0px) + 4px)",
            transform: `translateY(${Math.max(0, pull - 28)}px)`,
            opacity: showIndicator ? 1 : 0,
            transition:
              startYRef.current === null
                ? "transform 200ms ease, opacity 200ms ease"
                : "opacity 120ms ease",
          }}
        >
          <span
            className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-bg-elev border border-border text-muted"
          >
            <RefreshCcw
              size={16}
              className={refreshing ? "animate-spin" : ""}
              style={{
                transform: refreshing
                  ? undefined
                  : `rotate(${progress * 360}deg)`,
                transition: "transform 80ms linear",
              }}
            />
          </span>
        </div>
      )}
      <div
        className="mx-auto w-full max-w-2xl px-4"
        style={
          onRefresh && (pull > 0 || refreshing)
            ? {
                transform: `translateY(${pull}px)`,
                transition:
                  startYRef.current === null && !refreshing
                    ? "transform 200ms ease"
                    : undefined,
              }
            : undefined
        }
      >
        {children}
      </div>
      <BottomNav />
    </div>
  );
}

// A plain docked tab bar: full width, hairline top edge, equal tabs. Add is a
// normal tab rather than a floating action button.
function BottomNav() {
  const { location } = useRouterState();
  const items = [
    { to: "/", label: "Codes", icon: KeyRound },
    { to: "/add", label: "Add", icon: Plus },
    { to: "/settings", label: "Settings", icon: SettingsIcon },
  ];
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 bg-bg/95 backdrop-blur border-t border-white/[0.08]"
      style={{ paddingBottom: "var(--safe-bottom)" }}
    >
      <div className="mx-auto max-w-2xl grid grid-cols-3">
        {items.map(({ to, label, icon: Icon }) => {
          const active =
            to === "/"
              ? location.pathname === "/"
              : location.pathname.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              className={cn(
                "flex flex-col items-center justify-center gap-1 pt-2.5 pb-2 text-[11px] font-medium transition-colors",
                active ? "text-zinc-100" : "text-zinc-500 hover:text-zinc-300",
              )}
            >
              <Icon size={20} strokeWidth={active ? 2.25 : 1.75} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

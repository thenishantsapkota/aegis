import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Plus, Settings as SettingsIcon, RefreshCcw } from "lucide-react";
import { cn } from "~/lib/cn";
import { useEffect, useRef, useState, type ReactNode } from "react";

const PULL_THRESHOLD = 70; // px past which release triggers refresh
const PULL_MAX = 110; // visual ceiling so the rubber-band doesn't run away

export function AppShell({
  children,
  onRefresh,
}: {
  children: ReactNode;
  /** When provided, the scroll container shows a pull-to-refresh affordance. */
  onRefresh?: () => Promise<void>;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const startYRef = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!onRefresh) return;
    const el = scrollRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      if (refreshing) return;
      if (el.scrollTop > 0) return;
      startYRef.current = e.touches[0].clientY;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (startYRef.current === null || refreshing) return;
      const dy = e.touches[0].clientY - startYRef.current;
      if (dy <= 0) {
        // scrolling up — give control back to the browser
        setPull(0);
        return;
      }
      // Apply diminishing-returns curve so the indicator never feels rigid.
      const damped = Math.min(PULL_MAX, dy * 0.55);
      setPull(damped);
      // Prevent native overscroll / iOS pull-to-reload while we're pulling.
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
          /* swallow — surfaced elsewhere */
        } finally {
          setRefreshing(false);
          setPull(0);
        }
      } else {
        setPull(0);
      }
    };

    // touchmove must be non-passive so we can preventDefault when pulling
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [onRefresh, refreshing]);

  // Keep a ref mirror so the touchend handler reads the latest value without
  // having to re-bind every render.
  const pullRef = useRef(0);
  pullRef.current = pull;

  const progress = Math.min(1, pull / PULL_THRESHOLD);
  const showIndicator = pull > 0 || refreshing;

  return (
    <div className="flex flex-col h-safe-screen">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto pb-32 pt-safe pl-safe pr-safe relative"
        style={{ overscrollBehaviorY: onRefresh ? "contain" : undefined }}
      >
        {onRefresh && (
          <div
            className="pointer-events-none absolute left-0 right-0 flex justify-center"
            style={{
              top: 0,
              transform: `translateY(${Math.max(0, pull - 28)}px)`,
              opacity: showIndicator ? 1 : 0,
              transition: refreshing
                ? "opacity 150ms ease"
                : startYRef.current === null
                  ? "transform 200ms ease, opacity 200ms ease"
                  : "opacity 120ms ease",
            }}
          >
            <span
              className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-bg-elev border border-border text-muted"
              style={{
                boxShadow: "0 8px 24px -8px rgb(0 0 0 / 0.5)",
              }}
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
            onRefresh
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

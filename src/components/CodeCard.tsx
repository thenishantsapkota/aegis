import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, MoreHorizontal } from "lucide-react";
import type { EntryRecord, EntrySecret, TeamEntryRecord } from "~/lib/db";
import { generateCode, totpRemainingSeconds } from "~/lib/totp";
import { useVault } from "~/lib/vault-context";
import { cn } from "~/lib/cn";
import { SnapText } from "./ui/snap-text";
import { ServiceIcon } from "./ServiceIcon";

// A card renders either a personal entry or a shared team entry. They share the
// same visible fields; only the decrypt path and the badge differ.
type AnyEntry = EntryRecord | TeamEntryRecord;

type Props = {
  entry: AnyEntry;
  onEdit?: (e: AnyEntry) => void;
};

function isTeamEntry(e: AnyEntry): e is TeamEntryRecord {
  return "teamId" in e;
}

// One shared timer drives every card on screen — avoids N setIntervals per
// vault and keeps the per-second work O(subscribers) instead of O(intervals).
// Ticks are scheduled against the wall-clock second (not a free-running
// interval) so codes roll over on time and timer drift can't accumulate.
const subscribers = new Set<() => void>();
let tickerId: ReturnType<typeof setTimeout> | null = null;
const msToNextSecond = () => 1000 - (Date.now() % 1000);
function scheduleTick() {
  tickerId = setTimeout(() => {
    subscribers.forEach((cb) => cb());
    scheduleTick();
  }, msToNextSecond());
}
function subscribe(fn: () => void) {
  subscribers.add(fn);
  if (tickerId === null) scheduleTick();
  return () => {
    subscribers.delete(fn);
    if (subscribers.size === 0 && tickerId !== null) {
      clearTimeout(tickerId);
      tickerId = null;
    }
  };
}

// Seconds left at which the pie turns red, and at which the next code shows.
const LOW_TIME = 5;
const NEXT_CODE_WINDOW = 10;

const PLACEHOLDER_VIEW = { code: "••• •••", remaining: 30, nextCode: null };

function codeView(secret: EntrySecret, now = Date.now()) {
  if (secret.type === "HOTP") {
    return { code: generateCode(secret), remaining: 0, nextCode: null };
  }
  const remaining = totpRemainingSeconds(secret.period, now);
  return {
    code: generateCode(secret, now),
    remaining,
    nextCode:
      remaining <= NEXT_CODE_WINDOW
        ? generateCode(secret, now + remaining * 1000)
        : null,
  };
}

function formatCode(code: string) {
  if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`;
  if (code.length === 8) return `${code.slice(0, 4)} ${code.slice(4)}`;
  return code;
}

function CodeCardBase({ entry, onEdit }: Props) {
  const { decryptEntry, decryptTeamEntry, peekSecret } = useVault();
  // A secret decrypted earlier this session renders on the first frame, so
  // coming back to this tab doesn't flash placeholders.
  const [secret, setSecret] = useState<EntrySecret | null>(
    () => peekSecret(entry) ?? null,
  );
  const [{ code, remaining, nextCode }, setView] = useState(() =>
    secret ? codeView(secret) : PLACEHOLDER_VIEW,
  );
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const p = isTeamEntry(entry)
      ? decryptTeamEntry(entry)
      : decryptEntry(entry);
    p.then((s) => {
      if (alive) setSecret(s);
    }).catch((e) => {
      if (alive) setError(e instanceof Error ? e.message : "Decrypt failed");
    });
    return () => {
      alive = false;
    };
  }, [entry, decryptEntry, decryptTeamEntry]);

  useEffect(() => {
    if (!secret) return;
    const tick = () => setView(codeView(secret));
    tick();
    if (secret.type === "HOTP") return;
    return subscribe(tick);
  }, [secret]);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code.replace(/\s/g, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard may be denied */
    }
  }

  const isTotp = secret?.type === "TOTP";
  const lowTime = isTotp && remaining <= LOW_TIME;


  return (
    <li className="flex items-center gap-3.5 py-3.5">
      <ServiceIcon issuer={entry.issuer} account={entry.account} />
      <button
        type="button"
        onClick={copyCode}
        className="flex-1 min-w-0 text-left group"
        aria-label={`Copy code for ${entry.issuer || entry.account}`}
      >
        <div className="flex items-center gap-2 min-w-0 text-sm">
          <span className="text-zinc-300 truncate font-medium">
            {entry.issuer || "No issuer"}
          </span>
          {copied && (
            <span className="ml-auto shrink-0 inline-flex items-center gap-1 text-xs text-accent motion-safe:animate-fade-in">
              <Check size={13} /> Copied
            </span>
          )}
        </div>
        <div
          className={cn(
            "font-mono text-[28px] leading-tight font-medium tracking-[0.06em] tabular-nums whitespace-nowrap transition-colors duration-500 group-active:text-accent",
            lowTime && "text-zinc-500",
          )}
        >
          {error ? (
            <span className="text-danger text-sm tracking-normal">{error}</span>
          ) : (
            <SnapText value={formatCode(code)} />
          )}
        </div>
        <div className="flex items-baseline gap-3 min-w-0">
          <span className="text-xs text-zinc-500 truncate">{entry.account}</span>
          {nextCode && !error && (
            <span className="ml-auto shrink-0 text-xs text-zinc-500 motion-safe:animate-fade-in">
              Next{" "}
              <span className="font-mono tabular-nums text-zinc-300">
                {formatCode(nextCode)}
              </span>
            </span>
          )}
        </div>
      </button>

      {isTotp && secret && (
        <span role="timer" aria-label={`${remaining} seconds left`} className="px-1">
          <TotpPie period={secret.period} low={lowTime} />
        </span>
      )}
      {onEdit && (
        <button
          type="button"
          onClick={() => onEdit(entry)}
          className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.06] transition-colors"
          aria-label="More"
        >
          <MoreHorizontal size={18} />
        </button>
      )}
    </li>
  );
}

// Briefly eases the pie back to full at each rollover instead of snapping.
const REFILL_MS = 600;

// A small solid wedge that shrinks like a clock hand over each period and
// turns red near the end. Driven by one Web Animation per period whose
// currentTime is set from the wall clock: smooth, and it can't drift from the
// code. The wedge is a circle stroked as wide as its diameter.
function TotpPie({ period, low }: { period: number; low: boolean }) {
  const wedgeRef = useRef<SVGCircleElement>(null);
  const step = Math.floor(Date.now() / 1000 / period);

  useLayoutEffect(() => {
    const el = wedgeRef.current;
    if (!el) return;
    const total = period * 1000;
    const f = Math.min(0.5, REFILL_MS / total);
    const anim = el.animate(
      [
        { offset: 0, strokeDashoffset: 100, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
        { offset: f, strokeDashoffset: f * 100, easing: "linear" },
        { offset: 1, strokeDashoffset: 100 },
      ],
      { duration: total, fill: "both" },
    );
    anim.currentTime = Date.now() % total;
    return () => anim.cancel();
  }, [step, period]);

  return (
    <svg
      viewBox="0 0 20 20"
      className={cn("totp-pie w-[18px] h-[18px] shrink-0", low && "is-low")}
      aria-hidden
    >
      <circle cx="10" cy="10" r="9" className="totp-pie-track" />
      <circle
        ref={wedgeRef}
        cx="10"
        cy="10"
        r="4.5"
        pathLength={100}
        className="totp-pie-wedge"
      />
    </svg>
  );
}

// Skip re-renders when the parent VaultView updates for unrelated reasons.
// `onEdit` is a stable setState updater from useState, so it's safe to compare
// by reference; `entry` is a Dexie record — compare the fields that affect the
// rendered output (everything else is stable per id).
export const CodeCard = memo(CodeCardBase, (a, b) => {
  if (a.onEdit !== b.onEdit) return false;
  const ae = a.entry;
  const be = b.entry;
  return (
    ae.id === be.id &&
    ae.issuer === be.issuer &&
    ae.account === be.account &&
    ae.updatedAt === be.updatedAt &&
    ("folderId" in ae ? ae.folderId : null) ===
      ("folderId" in be ? be.folderId : null)
  );
});

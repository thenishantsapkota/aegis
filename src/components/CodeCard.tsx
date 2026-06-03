import { memo, useEffect, useMemo, useState } from "react";
import { Copy, Check, MoreHorizontal } from "lucide-react";
import type { EntryRecord, EntrySecret } from "~/lib/db";
import { generateCode, totpRemainingSeconds } from "~/lib/totp";
import { useVault } from "~/lib/vault-context";
import { cn } from "~/lib/cn";

type Props = {
  entry: EntryRecord;
  onEdit?: (e: EntryRecord) => void;
};

// One shared timer drives every card on screen — avoids N setIntervals per
// vault and keeps the per-second work O(subscribers) instead of O(intervals).
const subscribers = new Set<() => void>();
let tickerId: ReturnType<typeof setInterval> | null = null;
function subscribe(fn: () => void) {
  subscribers.add(fn);
  if (tickerId === null) {
    tickerId = setInterval(() => {
      subscribers.forEach((cb) => cb());
    }, 1000);
  }
  return () => {
    subscribers.delete(fn);
    if (subscribers.size === 0 && tickerId !== null) {
      clearInterval(tickerId);
      tickerId = null;
    }
  };
}

function CodeCardBase({ entry, onEdit }: Props) {
  const { decryptEntry } = useVault();
  const [secret, setSecret] = useState<EntrySecret | null>(null);
  const [code, setCode] = useState<string>("••• •••");
  const [remaining, setRemaining] = useState<number>(30);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    decryptEntry(entry)
      .then((s) => {
        if (alive) setSecret(s);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "Decrypt failed");
      });
    return () => {
      alive = false;
    };
  }, [entry, decryptEntry]);

  useEffect(() => {
    if (!secret) return;
    if (secret.type === "HOTP") {
      setCode(generateCode(secret));
      return;
    }
    const tick = () => {
      setCode(generateCode(secret));
      setRemaining(totpRemainingSeconds(secret.period));
    };
    tick();
    return subscribe(tick);
  }, [secret]);

  const ringProps = useMemo(() => {
    if (!secret || secret.type !== "TOTP") return null;
    const radius = 16;
    const circumference = 2 * Math.PI * radius;
    const progress = remaining / secret.period;
    return {
      radius,
      circumference,
      offset: circumference * (1 - progress),
      lowTime: remaining <= 5,
    };
  }, [secret, remaining]);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code.replace(/\s/g, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard may be denied */
    }
  }

  const formattedCode =
    code.length === 6
      ? `${code.slice(0, 3)} ${code.slice(3)}`
      : code.length === 8
        ? `${code.slice(0, 4)} ${code.slice(4)}`
        : code;

  const initial =
    (entry.issuer || entry.account || "?").trim().charAt(0).toUpperCase() ||
    "?";

  return (
    <div className="card p-3 sm:p-4 flex items-center gap-3 sm:gap-4 transition-colors duration-200 hover:[border-color:rgb(255_255_255/0.14)]">
      <div className="code-avatar">
        <span className="drop-shadow-sm">{initial}</span>
      </div>

      <button
        type="button"
        onClick={copyCode}
        className="flex-1 min-w-0 text-left group"
        aria-label={`Copy code for ${entry.issuer || entry.account}`}
      >
        <div className="text-[11px] text-muted truncate font-semibold uppercase tracking-[0.08em]">
          {entry.issuer || "—"}
        </div>
        <div className="font-mono text-2xl sm:text-[28px] leading-tight font-semibold tracking-[0.04em] tabular-nums mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis group-active:text-gradient transition">
          {error ? (
            <span className="text-danger text-sm">{error}</span>
          ) : (
            formattedCode
          )}
        </div>
        <div className="text-xs text-muted truncate mt-0.5">
          {entry.account}
        </div>
      </button>

      <div className="flex items-center gap-1.5 sm:gap-2">
        {ringProps && (
          <svg
            width="36"
            height="36"
            viewBox="0 0 40 40"
            className="shrink-0 sm:w-10 sm:h-10"
          >
            <circle
              cx="20"
              cy="20"
              r={ringProps.radius}
              fill="none"
              stroke="rgb(255 255 255 / 0.08)"
              strokeWidth="3"
            />
            <circle
              cx="20"
              cy="20"
              r={ringProps.radius}
              fill="none"
              stroke={
                ringProps.lowTime ? "rgb(248 113 113)" : "rgb(124 134 255)"
              }
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={ringProps.circumference}
              strokeDashoffset={ringProps.offset}
              className="ring-progress"
            />
            <text
              x="20"
              y="24"
              textAnchor="middle"
              fontSize="11"
              fontWeight="600"
              fontFamily="ui-monospace, monospace"
              fill={
                ringProps.lowTime ? "rgb(248 113 113)" : "rgb(186 195 255)"
              }
            >
              {remaining}
            </text>
          </svg>
        )}
        <button
          type="button"
          onClick={copyCode}
          className={cn(
            "w-9 h-9 sm:w-10 sm:h-10 rounded-2xl flex items-center justify-center transition-colors duration-150",
            copied
              ? "bg-success/15 text-success border border-success/30"
              : "bg-white/[0.04] text-muted border border-white/[0.08] hover:bg-white/[0.08] hover:text-white",
          )}
          aria-label="Copy"
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
        {onEdit && (
          <button
            type="button"
            onClick={() => onEdit(entry)}
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-muted hover:text-white hover:bg-white/[0.08] transition-colors"
            aria-label="More"
          >
            <MoreHorizontal size={16} />
          </button>
        )}
      </div>
    </div>
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
    ae.folderId === be.folderId
  );
});

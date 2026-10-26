import { cn } from "~/lib/cn";

// Adapted from Animata's Toggle Switch (https://animata.design/docs/button/toggle-switch):
// a pill track with a sliding thumb. Changes from the original: controlled
// (the parent owns the state, so it can stay off if enabling fails), a
// role="switch" button instead of a hidden checkbox, and the app's colors.
export function ToggleSwitch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50",
        checked ? "bg-accent" : "bg-white/[0.12]",
      )}
    >
      <span
        className={cn(
          "absolute left-1 top-1 h-5 w-5 rounded-full transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
          checked ? "translate-x-5 bg-bg" : "bg-zinc-300",
        )}
      />
    </button>
  );
}

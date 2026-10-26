import { useEffect, useState } from "react";
import type { ServiceLogo } from "~/lib/service-logos";

// The logo table is its own chunk. Start fetching it as soon as this module
// loads (with the code list), so it is normally ready before the vault is.
type LogoModule = typeof import("~/lib/service-logos");
let logos: LogoModule | null = null;
const logosReady = import("~/lib/service-logos").then((m) => (logos = m));

// Brand colors that are near-black (GitHub, X, ...) would vanish on the dark
// tile, so those draw in light grey instead.
function logoColor(hex: string) {
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance < 0.06 ? "rgb(228 228 231)" : `#${hex}`;
}

export function ServiceIcon({ issuer, account }: { issuer: string; account: string }) {
  const [, setLoaded] = useState(!!logos);
  useEffect(() => {
    if (!logos) void logosReady.then(() => setLoaded(true));
  }, []);

  const logo: ServiceLogo | undefined = logos?.findServiceLogo(issuer, account);
  const initial = (issuer || account).trim().charAt(0).toUpperCase() || "?";

  return (
    <span
      className="w-10 h-10 shrink-0 rounded-xl bg-white/[0.06] flex items-center justify-center"
      aria-hidden
    >
      {logo && "Mark" in logo ? (
        <svg viewBox="0 0 24 24" className="w-5 h-5">
          <logo.Mark />
        </svg>
      ) : logo ? (
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill={logoColor(logo.hex)}>
          <path d={logo.path} />
        </svg>
      ) : (
        <span className="text-[15px] font-semibold text-zinc-400">{initial}</span>
      )}
    </span>
  );
}

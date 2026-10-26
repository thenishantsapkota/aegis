import { motion, useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "~/lib/cn";

// Text that "snaps" away when its value changes: the old characters break
// into dust that drifts off up and to the right, left to right, while the new
// characters resolve in. The dust is drawn on a canvas sampled from the old
// glyphs at their exact on-screen positions; the entry uses the timing and
// values of Animata's Focus Blur Resolve
// (https://animata.design/docs/text/focus-blur-resolve).

// Focus Blur Resolve's enter phase, scaled by its default speed (0.72) and
// y-travel (0.58) so it suits a single line of digits.
const RESOLVE = {
  from: { opacity: 0, y: 8, filter: "blur(10px)", scale: 1.01 },
  to: { opacity: 1, y: 0, filter: "blur(0px)", scale: 1 },
  duration: 0.55,
  ease: [0.22, 1, 0.36, 1] as const,
};

const DUST = {
  // Room around the text the dust can drift into before the canvas clips it.
  padX: 56,
  padY: 28,
  // Device pixels between sampled grains; larger is cheaper and coarser.
  grain: 2,
  // How long the left-to-right sweep takes, and how long each grain lives.
  sweepMs: 420,
  lifeMs: 700,
};

type Grain = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  delay: number;
  life: number;
  size: number;
};

// Sample the glyph pixels of `chars` into grains, then animate them on
// `canvas`. Returns a cancel function.
function snapToDust(
  canvas: HTMLCanvasElement,
  container: HTMLElement,
  chars: HTMLElement[],
): () => void {
  const box = container.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = box.width + DUST.padX * 2;
  const height = box.height + DUST.padY * 2;
  canvas.width = Math.ceil(width * dpr);
  canvas.height = Math.ceil(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const style = getComputedStyle(container);
  const color = style.color;

  // Draw the old glyphs offscreen at their measured positions.
  const glyphs = document.createElement("canvas");
  glyphs.width = canvas.width;
  glyphs.height = canvas.height;
  const g = glyphs.getContext("2d", { willReadFrequently: true });
  const ctx = canvas.getContext("2d");
  if (!g || !ctx) return () => {};
  g.scale(dpr, dpr);
  g.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  g.fillStyle = color;
  g.textBaseline = "middle";
  for (const el of chars) {
    const r = el.getBoundingClientRect();
    if (!el.textContent?.trim()) continue;
    g.fillText(
      el.textContent,
      r.left - box.left + DUST.padX,
      r.top - box.top + r.height / 2 + DUST.padY,
    );
  }

  const { data } = g.getImageData(0, 0, glyphs.width, glyphs.height);
  const grains: Grain[] = [];
  const step = Math.max(1, Math.round(DUST.grain * dpr));
  for (let py = 0; py < glyphs.height; py += step) {
    for (let px = 0; px < glyphs.width; px += step) {
      if (data[(py * glyphs.width + px) * 4 + 3] < 110) continue;
      const x = px / dpr;
      const y = py / dpr;
      const progress = (x - DUST.padX) / Math.max(1, box.width);
      grains.push({
        x,
        y,
        // Mostly up and to the right, with some scatter.
        vx: 18 + Math.random() * 46,
        vy: -(8 + Math.random() * 30),
        delay: progress * DUST.sweepMs + Math.random() * 160,
        life: DUST.lifeMs * (0.6 + Math.random() * 0.4),
        size: step / dpr,
      });
    }
  }

  let raf = 0;
  const start = performance.now();
  const end = DUST.sweepMs + 160 + DUST.lifeMs;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = color;

  const frame = (now: number) => {
    const t = now - start;
    ctx.clearRect(0, 0, width, height);
    for (const p of grains) {
      const age = t - p.delay;
      if (age < 0) {
        // Not reached by the sweep yet: still part of the intact glyph.
        ctx.globalAlpha = 1;
        ctx.fillRect(p.x, p.y, p.size, p.size);
        continue;
      }
      if (age > p.life) continue;
      const k = age / p.life;
      const ease = 1 - (1 - k) * (1 - k);
      ctx.globalAlpha = (1 - k) * (1 - k);
      ctx.fillRect(
        p.x + p.vx * ease + Math.sin((p.y + age) / 40) * 2,
        p.y + p.vy * ease,
        p.size,
        p.size,
      );
    }
    if (t < end) raf = requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, width, height);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    ctx.clearRect(0, 0, width, height);
  };
}

export function SnapText({
  value,
  stagger = 40,
  className,
}: {
  value: string;
  /** Delay in ms per character for the incoming resolve. */
  stagger?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  // `shown` lags `value` by one layout pass so the old glyphs are still in the
  // DOM to be measured and sampled before they are replaced.
  const [shown, setShown] = useState(value);
  const [gen, setGen] = useState(0);
  const [snapped, setSnapped] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const charRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const cancelRef = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    if (value === shown) return;
    cancelRef.current();
    // Only real digits dissolve; the placeholder just gives way.
    const dissolve = !reduce && /\d/.test(shown);
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (dissolve && container && canvas) {
      const chars = charRefs.current.filter((c): c is HTMLSpanElement => !!c);
      cancelRef.current = snapToDust(canvas, container, chars);
    }
    setSnapped(dissolve);
    setShown(value);
    setGen((n) => n + 1);
  }, [value, shown, reduce]);

  useLayoutEffect(() => () => cancelRef.current(), []);

  return (
    <span
      ref={containerRef}
      className={cn("relative inline-block whitespace-pre", className)}
      aria-label={shown}
      role="text"
    >
      <canvas
        ref={canvasRef}
        aria-hidden
        className="pointer-events-none absolute"
        style={{ left: -DUST.padX, top: -DUST.padY }}
      />
      {shown.split("").map((ch, i) => (
        <motion.span
          key={`${gen}-${i}`}
          ref={(el) => {
            charRefs.current[i] = el;
          }}
          aria-hidden
          className="inline-block"
          initial={gen === 0 || reduce ? false : RESOLVE.from}
          animate={RESOLVE.to}
          transition={{
            duration: RESOLVE.duration,
            ease: RESOLVE.ease,
            // Let the dust clear the way before the new digits land.
            delay: (snapped ? 0.28 : 0) + i * (stagger / 1000),
          }}
        >
          {ch}
        </motion.span>
      ))}
    </span>
  );
}

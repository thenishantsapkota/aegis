/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SF Mono",
          "Menlo",
          "Monaco",
          "Cascadia Mono",
          "Roboto Mono",
          "monospace",
        ],
      },
      colors: {
        bg: {
          DEFAULT: "rgb(7 9 19)",
          elev: "rgb(15 19 32)",
          card: "rgb(20 25 41)",
        },
        border: {
          DEFAULT: "rgb(255 255 255 / 0.08)",
          strong: "rgb(255 255 255 / 0.14)",
        },
        accent: {
          DEFAULT: "rgb(124 134 255)", // indigo-violet
          hover: "rgb(148 156 255)",
          glow: "rgb(124 134 255 / 0.35)",
        },
        cyan: {
          accent: "rgb(34 211 238)",
        },
        danger: "rgb(248 113 113)",
        success: "rgb(74 222 128)",
        warn: "rgb(251 191 36)",
        muted: "rgb(148 163 184)",
      },
      backgroundImage: {
        "gradient-primary":
          "linear-gradient(135deg, rgb(124 134 255) 0%, rgb(56 189 248) 100%)",
        "gradient-primary-soft":
          "linear-gradient(135deg, rgb(124 134 255 / 0.16) 0%, rgb(56 189 248 / 0.16) 100%)",
        "gradient-card":
          "linear-gradient(180deg, rgb(255 255 255 / 0.04) 0%, rgb(255 255 255 / 0.01) 100%)",
        mesh: `
          radial-gradient(at 8% 0%, rgb(124 134 255 / 0.18) 0px, transparent 50%),
          radial-gradient(at 92% 12%, rgb(56 189 248 / 0.14) 0px, transparent 50%),
          radial-gradient(at 50% 100%, rgb(168 85 247 / 0.10) 0px, transparent 55%),
          linear-gradient(180deg, rgb(7 9 19) 0%, rgb(4 6 14) 100%)
        `,
      },
      boxShadow: {
        glow: "0 0 0 1px rgb(124 134 255 / 0.25), 0 8px 32px -8px rgb(124 134 255 / 0.45)",
        card: "0 1px 0 rgb(255 255 255 / 0.04) inset, 0 8px 24px -12px rgb(0 0 0 / 0.6)",
        soft: "0 1px 2px rgb(0 0 0 / 0.2), 0 12px 32px -16px rgb(0 0 0 / 0.5)",
        ring: "0 0 0 4px rgb(124 134 255 / 0.18)",
      },
      borderRadius: {
        "2.5xl": "1.25rem",
      },
      animation: {
        "fade-in": "fadeIn 240ms cubic-bezier(0.22, 1, 0.36, 1)",
        "scale-in": "scaleIn 200ms cubic-bezier(0.22, 1, 0.36, 1)",
        shimmer: "shimmer 2.5s linear infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        scaleIn: {
          "0%": { opacity: "0", transform: "scale(0.96)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
      },
    },
  },
  plugins: [],
};

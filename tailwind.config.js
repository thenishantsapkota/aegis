/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Geist Variable",
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
          "Geist Mono Variable",
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
        // Neutral zinc base; the only hue is the brand blue from the favicon.
        bg: {
          DEFAULT: "rgb(12 12 14)",
          elev: "rgb(22 22 25)",
          card: "rgb(27 27 31)",
        },
        border: {
          DEFAULT: "rgb(255 255 255 / 0.08)",
          strong: "rgb(255 255 255 / 0.14)",
        },
        accent: {
          DEFAULT: "rgb(99 167 255)",
          hover: "rgb(130 186 255)",
        },
        danger: "rgb(248 113 113)",
        success: "rgb(74 222 128)",
        warn: "rgb(251 191 36)",
        muted: "rgb(161 161 170)",
      },
      boxShadow: {
        soft: "0 1px 2px rgb(0 0 0 / 0.3)",
      },
      borderRadius: {
        "2.5xl": "1rem",
      },
      animation: {
        "fade-in": "fadeIn 240ms cubic-bezier(0.22, 1, 0.36, 1)",
        "scale-in": "scaleIn 200ms cubic-bezier(0.22, 1, 0.36, 1)",
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
      },
    },
  },
  plugins: [],
};

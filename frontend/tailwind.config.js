/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  // The theme toggle pins light/dark by class; tokens live in index.css.
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        serif: ['"Iowan Old Style"', '"Palatino Linotype"', "Palatino", "Georgia", "serif"],
        mono: ["ui-monospace", '"SF Mono"', "Menlo", "Consolas", "monospace"],
      },
      colors: {
        paper: "var(--paper)", card: "var(--card)", rule: "var(--rule)",
        ink: { DEFAULT: "var(--ink)", soft: "var(--ink-soft)" },
        accent: { DEFAULT: "var(--red)", soft: "var(--red-soft)" },
        blue: { DEFAULT: "var(--blue)", soft: "var(--blue-soft)" },
        green: { DEFAULT: "var(--green)", soft: "var(--green-soft)" },
      },
      keyframes: {
        "fade-up": { "0%": { opacity: "0", transform: "translateY(8px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        "fade-in": { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        "slide-in-right": { "0%": { transform: "translateX(100%)" }, "100%": { transform: "translateX(0)" } },
        pulseDot: { "0%,100%": { opacity: "1", transform: "scale(1)" }, "50%": { opacity: "0.4", transform: "scale(0.7)" } },
      },
      animation: {
        "fade-up": "fade-up 0.3s ease both",
        "fade-in": "fade-in 320ms ease both",
        "slide-in-right": "slide-in-right 480ms cubic-bezier(0.16,1,0.3,1) both",
        pulseDot: "pulseDot 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

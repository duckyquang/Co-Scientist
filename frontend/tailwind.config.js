/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        // Pure zinc-based dark surfaces (resend-style)
        ink: {
          950: "#09090b",  // zinc-950
          900: "#111115",
          850: "#18181b",  // zinc-900
          800: "#202024",
          700: "#27272a",  // zinc-800
          600: "#3f3f46",  // zinc-700
          500: "#52525b",  // zinc-600
        },
        // Blue brand (replaces indigo)
        brand: {
          50:  "#eff6ff",  // blue-50
          300: "#93c5fd",  // blue-300
          400: "#60a5fa",  // blue-400
          500: "#3b82f6",  // blue-500
          600: "#2563eb",  // blue-600
          700: "#1d4ed8",  // blue-700
        },
        // Cyan accent (kept)
        cyber: { 400: "#22d3ee", 500: "#06b6d4" },
        // Soft purple accent (kept as secondary)
        flux:  { 300: "#d8b4fe", 400: "#c084fc", 500: "#a855f7" },
      },
      boxShadow: {
        // Blue glow
        glow: "0 0 0 1px rgba(59,130,246,0.20), 0 8px 32px -8px rgba(59,130,246,0.40)",
        card: "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 4px 24px -8px rgba(0,0,0,0.6)",
        // Sidebar right edge
        sidebar: "1px 0 0 0 rgba(255,255,255,0.05)",
      },
      keyframes: {
        "fade-up": {
          "0%":   { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%":   { opacity: "0" },
          "100%": { opacity: "1" },
        },
        pulseDot: {
          "0%,100%": { opacity: "1",  transform: "scale(1)"   },
          "50%":     { opacity: "0.4", transform: "scale(0.7)" },
        },
        shimmer: { "100%": { transform: "translateX(100%)" } },
      },
      animation: {
        "fade-up": "fade-up 0.3s ease both",
        "fade-in": "fade-in 0.2s ease both",
        pulseDot:  "pulseDot 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        space: "#020617",
        "space-light": "#0b1120",
        "space-veil": "#111827",
        neon: {
          100: "#e6f9ff",
          300: "#67e8f9",
          400: "#22d3ee",
          500: "#0ff4c6",
          600: "#0ea5e9",
        },
        magno: "#6366f1",
        plasma: "#db2777",
      },
      fontFamily: {
        sans: ["var(--font-exo)", ...defaultTheme.fontFamily.sans],
      },
      boxShadow: {
        oracle: "0 0 45px rgba(34, 211, 238, 0.4)",
        "oracle-strong": "0 0 60px rgba(14, 165, 233, 0.45)",
      },
      animation: {
        "pulse-slow": "pulseSlow 6s ease-in-out infinite",
        "float-slow": "floatSlow 8s ease-in-out infinite",
        "glitch-scan": "glitchScan 5s linear infinite",
        "glitch-shift": "glitchShift 4s ease-in-out infinite",
        "orb-breathe": "orbBreathe 7s ease-in-out infinite",
        "eye-blink": "eyeBlink 7s linear infinite",
        "mouth-sync": "mouthSync 2.6s ease-in-out infinite",
        "time-warp": "timeWarp 12s ease-in-out infinite",
      },
      keyframes: {
        pulseSlow: {
          "0%, 100%": { opacity: "0.7" },
          "50%": { opacity: "1" },
        },
        floatSlow: {
          "0%, 100%": { transform: "translateY(-4px)" },
          "50%": { transform: "translateY(6px)" },
        },
        glitchScan: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" },
        },
        glitchShift: {
          "0%, 100%": { transform: "translate3d(0, 0, 0)" },
          "20%": { transform: "translate3d(-2px, -2px, 0)" },
          "40%": { transform: "translate3d(2px, 1px, 0)" },
          "60%": { transform: "translate3d(-1px, 2px, 0)" },
          "80%": { transform: "translate3d(3px, -1px, 0)" },
        },
        orbBreathe: {
          "0%, 100%": {
            filter: "drop-shadow(0 0 12px rgba(103, 232, 249, 0.45))",
            transform: "scale(0.98)",
          },
          "50%": {
            filter: "drop-shadow(0 0 30px rgba(34, 211, 238, 0.65))",
            transform: "scale(1.02)",
          },
        },
        eyeBlink: {
          "0%, 12%, 100%": { transform: "scaleY(1)" },
          "8%": { transform: "scaleY(0.2)" },
        },
        mouthSync: {
          "0%, 100%": { transform: "scaleY(0.6)" },
          "40%": { transform: "scaleY(1.1)" },
          "70%": { transform: "scaleY(0.4)" },
        },
        timeWarp: {
          "0%, 100%": { transform: "scale(1) rotate(0deg)" },
          "50%": { transform: "scale(1.05) rotate(1.5deg)" },
        },
      },
      backgroundImage: {
        "oracle-grid": "radial-gradient(circle at 20% 20%, rgba(103, 232, 249, 0.16), transparent 45%), radial-gradient(circle at 80% 30%, rgba(14, 165, 233, 0.18), transparent 50%), linear-gradient(140deg, rgba(2, 6, 23, 0.92), rgba(17, 24, 39, 0.94))",
        "oracle-noise": "repeating-linear-gradient(0deg, rgba(148, 163, 184, 0.05), rgba(148, 163, 184, 0.05) 1px, transparent 1px, transparent 3px)",
      },
    },
  },
  plugins: [],
};

export default config;

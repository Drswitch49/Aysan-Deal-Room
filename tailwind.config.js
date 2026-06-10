/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        acp: {
          ink: "#0A0A0B",
          navy: "#0D0D0E",
          bronze: "#C5A059",
          "bronze-dark": "#A8873F",
          "bronze-light": "#D4B876",
          mist: "rgba(197, 160, 89, 0.05)",
          line: "rgba(255, 255, 255, 0.06)",
          paper: "#0D0D0E",
          platinum: "#1e293b",
          emerald: "#10b981",
          card: "rgba(13, 13, 14, 0.65)",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Cormorant Garamond", "Georgia", "ui-serif", "serif"],
        heading: ["Inter", "sans-serif"],
      },
      boxShadow: {
        soft: "0 12px 34px rgba(0, 0, 0, 0.5)",
        panel: "0 1px 3px rgba(0, 0, 0, 0.4), 0 16px 48px rgba(0, 0, 0, 0.6)",
        inset: "inset 0 1px 0 rgba(255, 255, 255, 0.05)",
        "premium-card": "0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.05)",
        "glow-bronze": "0 0 20px rgba(197, 160, 89, 0.25)",
        "glow-bronze-lg": "0 0 25px rgba(197, 160, 89, 0.25)",
        "glow-bronze-card": "0 8px 30px rgba(197, 160, 89, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.05)",
        "glow-teal-card": "0 8px 30px rgba(16, 185, 129, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.05)",
        "ring-bronze": "0 0 0 2px rgba(197, 160, 89, 0.5)",
      },
      animation: {
        "pulse-glow": "pulseGlow 2.5s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "shimmer": "shimmer 2.5s infinite linear",
        "shimmer-fast": "shimmer 1.6s infinite linear",
        "fade-in-up": "fadeInUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "fade-in": "fadeIn 0.4s ease forwards",
        "scale-in": "scaleIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "slide-up-fade": "slideUpFade 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards",
      },
      keyframes: {
        pulseGlow: {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: ".4", transform: "scale(0.92)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        fadeInUp: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        scaleIn: {
          "0%": { opacity: "0", transform: "scale(0.95)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        slideUpFade: {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};

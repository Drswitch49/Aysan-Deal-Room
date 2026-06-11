/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        acp: {
          ink: "#0F1115",          // Evolved Primary Background
          navy: "#101317",
          bronze: "#C6A66B",       // Champagne Gold
          "bronze-dark": "#B8924F",
          "bronze-light": "#D4B06A",
          mist: "rgba(198, 166, 107, 0.03)",
          line: "rgba(255, 255, 255, 0.02)", // Softened borders
          paper: "#161B22",        // Secondary Surface
          platinum: "#1A1F27",     // Elevated Surface
          emerald: "#10b981",
          card: "#161B22",         // Card background
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Cormorant Garamond", "Georgia", "ui-serif", "serif"],
        heading: ["Inter", "sans-serif"],
      },
      boxShadow: {
        soft: "0 8px 24px rgba(0, 0, 0, 0.4)",
        panel: "0 1px 3px rgba(0, 0, 0, 0.4), 0 16px 48px rgba(0, 0, 0, 0.6)",
        inset: "inset 0 1px 0 rgba(255, 255, 255, 0.02)",
        "premium-card": "0 4px 16px rgba(0, 0, 0, 0.2)",
        "ring-bronze": "0 0 0 2px rgba(198, 166, 107, 0.4)",
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

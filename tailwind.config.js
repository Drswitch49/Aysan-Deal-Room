import defaultColors from "tailwindcss/colors";
import plugin from "tailwindcss/plugin";

/*
 * ─── Theming ─────────────────────────────────────────────────────────────────
 * The app was designed dark-first, with `text-white`, `bg-white/5`,
 * `text-slate-400` and friends everywhere. Rather than annotate thousands of
 * classes with `dark:` variants, every colour below resolves to a CSS variable
 * holding an "r g b" triplet, and `html.light` swaps the variables:
 *
 *   - `white` becomes ink, so white text and white/5 overlays read correctly
 *     on a light page.
 *   - the slate scale inverts (300 <-> 700, ...), keeping muted text muted.
 *   - the light tints of the status hues (100-400) darken, so emerald/rose/amber
 *     labels keep their contrast on white.
 *   - `acp-*` surfaces and golds get light-mode values.
 *
 * Dark values are the exact original colours, so the dark theme is unchanged.
 * `acp-on-accent` and `snow` never flip: they are for text on solid gold or
 * solid status-colour fills, which look the same in both themes.
 */

const hex = (h) => {
  const n = parseInt(h.replace("#", ""), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
};

const SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];
const HUES = [
  "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan",
  "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose",
];
const HUE_LIGHT = { 100: "800", 200: "800", 300: "700", 400: "600" };

const brand = {
  //                  dark       light
  "ink":            ["#0F1115", "#F4F2ED"], // page background
  "navy":           ["#101317", "#EFECE6"],
  "deep":           ["#0B0B0C", "#E9E6DF"], // sunken wells, inputs
  "paper":          ["#161B22", "#FFFFFF"],
  "card":           ["#161B22", "#FFFFFF"],
  "platinum":       ["#1A1F27", "#F8F6F2"], // raised / hover surface
  "bronze":         ["#C6A66B", "#9A7A3E"],
  "bronze-dark":    ["#B8924F", "#806330"],
  "bronze-light":   ["#D4B06A", "#AE8C4C"],
  "emerald":        ["#10B981", "#059669"],
  // Investor portal keeps its navy-tinted dark palette.
  "portal-bg":      ["#0E1420", "#F3F4F7"],
  "portal-card":    ["#161D2C", "#FFFFFF"],
  "portal-sunken":  ["#0A0F18", "#ECEEF3"],
  "portal-gold":    ["#C9A257", "#957534"],
};

const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

const colors = {
  white: v("white"),
  snow: "#FFFFFF",
  slate: Object.fromEntries(SHADES.map((s) => [s, v(`slate-${s}`)])),
  acp: {
    ...Object.fromEntries(Object.keys(brand).map((k) => [k, v(`acp-${k}`)])),
    "on-accent": "#0F1115",
    mist: "rgba(198, 166, 107, 0.03)",
    line: "rgb(var(--c-white) / 0.02)",
  },
};
for (const hue of HUES) {
  colors[hue] = Object.fromEntries(SHADES.map((s) => [s, v(`${hue}-${s}`)]));
}

const themeVariables = plugin(({ addBase }) => {
  const dark = { "--c-white": "255 255 255" };
  const light = { "--c-white": hex("#0F1115") };

  SHADES.forEach((s, i) => {
    dark[`--c-slate-${s}`] = hex(defaultColors.slate[s]);
    light[`--c-slate-${s}`] = hex(defaultColors.slate[SHADES[SHADES.length - 1 - i]]);
  });
  for (const hue of HUES) {
    for (const s of SHADES) {
      dark[`--c-${hue}-${s}`] = hex(defaultColors[hue][s]);
      light[`--c-${hue}-${s}`] = hex(defaultColors[hue][HUE_LIGHT[s] ?? s]);
    }
  }
  for (const [k, [d, l]] of Object.entries(brand)) {
    dark[`--c-acp-${k}`] = hex(d);
    light[`--c-acp-${k}`] = hex(l);
  }

  addBase({ ":root": dark, "html.light": light });

  // The dark theme draws structure with near-invisible white hairlines
  // (border-white/[0.02] is the most common border in the app). Mirrored as
  // 2% ink they vanish on a light page, so light mode raises those alphas.
  const hairlines = {
    "[0.01]": 0.08, "[0.015]": 0.08, "[0.02]": 0.08, "[0.03]": 0.09,
    "[0.04]": 0.1, "[0.05]": 0.1, "5": 0.1, "[0.06]": 0.11, "[0.07]": 0.12, "[0.08]": 0.12,
    "10": 0.14, "[0.1]": 0.14, "12": 0.15, "[0.12]": 0.15,
  };
  const sides = { "": "border-color", "-t": "border-top-color", "-b": "border-bottom-color",
    "-l": "border-left-color", "-r": "border-right-color" };
  const rules = {};
  for (const [alpha, lightAlpha] of Object.entries(hairlines)) {
    const color = `rgb(var(--c-white) / ${lightAlpha})`;
    for (const [side, prop] of Object.entries(sides)) {
      rules[`html.light [class~="border${side}-white/${alpha}"]`] = { [prop]: color };
    }
    rules[`html.light [class~="divide-white/${alpha}"] > :not([hidden]) ~ :not([hidden])`] = { borderColor: color };
  }
  addBase(rules);
});

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["class", "html.dark"],
  theme: {
    extend: {
      colors,
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Cormorant Garamond", "Georgia", "ui-serif", "serif"],
        heading: ["Inter", "sans-serif"],
      },
      boxShadow: {
        soft: "0 8px 24px rgb(0 0 0 / calc(0.4 * var(--shadow-k)))",
        panel: "0 1px 3px rgb(0 0 0 / calc(0.4 * var(--shadow-k))), 0 16px 48px rgb(0 0 0 / calc(0.6 * var(--shadow-k)))",
        inset: "inset 0 1px 0 rgba(255, 255, 255, 0.02)",
        "premium-card": "0 4px 16px rgb(0 0 0 / calc(0.2 * var(--shadow-k)))",
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
  plugins: [themeVariables],
};

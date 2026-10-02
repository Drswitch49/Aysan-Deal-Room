import { cx } from "../../utils/cx";

/*
 * The Aysan "A" as a loading mark.
 *
 * Same artwork as public/brand/aysan-mark.svg, inlined so its outline can be
 * animated: the stroke traces the letter in bronze, the fill rises behind it,
 * then the whole thing breathes out and starts again, while a thin arc orbits
 * the mark. The keyframes live in styles.css (`.logo-loader*`) and switch off
 * under prefers-reduced-motion, where the mark simply pulses.
 */
const MARK_PATH =
  "M121.713 144.534C119.131 144.534 116.283 144.178 113.168 143.466C110.141 142.665 107.159 141.063 104.222 138.659C101.374 136.167 98.9258 132.34 96.8785 127.177L93.6741 119.299H57.3573L46.5424 144H40L78.5866 55.8784H83.6603L113.435 127.177C115.215 131.538 117.173 134.832 119.309 137.057C121.535 139.193 124.294 140.44 127.588 140.796V143.867C126.875 144.045 125.941 144.178 124.784 144.267C123.716 144.445 122.692 144.534 121.713 144.534ZM59.8941 113.558H91.0037L75.7827 77.1077L59.8941 113.558Z";

export function LogoLoader({
  size = 72,
  label,
  className,
}: {
  /** Diameter of the orbit ring, in px; the letter scales with it. */
  size?: number;
  /** Optional caption under the mark (e.g. "Loading deals"). */
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label ?? "Loading"}
      className={cx("flex flex-col items-center gap-4", className)}
    >
      <div className="logo-loader relative" style={{ width: size, height: size }}>
        {/* Soft bronze halo */}
        <div className="logo-loader-halo absolute inset-0 rounded-full bg-acp-bronze/20 blur-xl" />

        {/* Orbiting arc */}
        <svg className="logo-loader-orbit absolute inset-0" viewBox="0 0 100 100" fill="none" aria-hidden="true">
          <circle cx="50" cy="50" r="47" stroke="rgb(var(--c-white) / 0.06)" strokeWidth="1.5" />
          <circle
            cx="50"
            cy="50"
            r="47"
            stroke="rgb(var(--c-acp-bronze))"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="60 236"
          />
        </svg>

        {/* The letter */}
        <svg
          className="absolute inset-[18%]"
          viewBox="33.8 50.2 100 100"
          fill="none"
          aria-hidden="true"
        >
          <path className="logo-loader-fill" d={MARK_PATH} fill="rgb(var(--c-acp-bronze))" />
          <path
            className="logo-loader-trace"
            d={MARK_PATH}
            pathLength={1}
            stroke="rgb(var(--c-acp-bronze-light))"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      {label && (
        <p className="logo-loader-label text-[10px] font-extrabold uppercase tracking-[0.22em] text-slate-500">
          {label}
        </p>
      )}
    </div>
  );
}

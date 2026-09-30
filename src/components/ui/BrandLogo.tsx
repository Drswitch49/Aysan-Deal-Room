import type { CSSProperties } from "react";
import { cx } from "../../utils/cx";

/*
 * The Aysan Capital Partners artwork lives once, in public/brand/. It is drawn
 * as a CSS mask filled with currentColor, so the logo takes the text colour of
 * wherever it sits: white on the dark theme, ink on the light one. Size it with
 * a height class (h-6, h-8, ...); the width follows the artwork's proportions.
 */
function maskStyle(src: string, ratio: string): CSSProperties {
  const mask = `url(${src}) center / contain no-repeat`;
  return { aspectRatio: ratio, backgroundColor: "currentColor", mask, WebkitMask: mask };
}

/** Full wordmark: "AYSAN" with "Capital Partners". */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Aysan Capital Partners"
      className={cx("inline-block shrink-0", className)}
      style={maskStyle("/brand/aysan-logo.svg", "608 / 97")}
    />
  );
}

/** Square "A" monogram cut from the wordmark, for tight spots and the favicon. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Aysan Capital Partners"
      className={cx("inline-block shrink-0", className)}
      style={maskStyle("/brand/aysan-mark.svg", "1 / 1")}
    />
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

/**
 * Drives the phone shell's page-switch loader.
 *
 * Two triggers, because neither alone covers every navigation:
 *   - a tap on an in-app link starts the loader *before* the route changes, so
 *     a page whose code is still downloading shows the logo rather than a
 *     frozen screen (the router keeps the old page up until the new one is
 *     ready);
 *   - a pathname change starts it for navigations that never went through a
 *     link — rows that call navigate(), redirects, the back button.
 *
 * Either way it stays up for at least MIN_VISIBLE_MS, so it reads as a
 * deliberate transition rather than a flicker, then fades and the new page
 * animates in (`revealKey` changes at that moment — key the page on it).
 *
 * Desktop is untouched: nothing here fires above the lg breakpoint.
 */
const MIN_VISIBLE_MS = 520;
const FADE_MS = 220;
/** A tapped link that never changes the route (its handler cancelled it). */
const ABANDON_MS = 1400;

export const PHONE_QUERY = "(max-width: 1023.98px)";

/**
 * On phones the page itself never scrolls: the shell is a full-height column
 * (app bar, this scroll area, tab bar), so the bars sit outside anything that
 * moves and mobile browsers can't drag them off-screen. Anything that needs
 * the phone's scroll position reads this element rather than `window`.
 */
export const APP_SCROLL_ID = "app-scroll";

export function phoneScroller(): HTMLElement | null {
  return document.getElementById(APP_SCROLL_ID);
}

export type LoaderPhase = "idle" | "shown" | "leaving";

function isPhone() {
  return typeof window !== "undefined" && window.matchMedia(PHONE_QUERY).matches;
}

export function useRouteTransition() {
  const { pathname } = useLocation();
  const [phase, setPhase] = useState<LoaderPhase>("idle");
  const [revealKey, setRevealKey] = useState(pathname);
  const startedAt = useRef(0);
  const timers = useRef<number[]>([]);
  const firstRender = useRef(true);
  const lastPath = useRef(pathname);

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  const finish = useCallback((nextKey: string | null) => {
    clearTimers();
    const wait = Math.max(0, MIN_VISIBLE_MS - (Date.now() - startedAt.current));
    timers.current.push(
      window.setTimeout(() => {
        setPhase("leaving");
        if (nextKey !== null) {
          setRevealKey(nextKey);
          // A new screen starts at the top, like any native app.
          phoneScroller()?.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
        }
        timers.current.push(window.setTimeout(() => setPhase("idle"), FADE_MS));
      }, wait),
    );
  }, []);

  const start = useCallback(() => {
    clearTimers();
    startedAt.current = Date.now();
    setPhase("shown");
    // Safety net: if the route never changes, don't leave the logo up.
    timers.current.push(window.setTimeout(() => finish(null), ABANDON_MS));
  }, [finish]);

  // Tap on an in-app link → show immediately.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!isPhone() || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.hasAttribute("download")) return;
      if (anchor.target && anchor.target !== "_self") return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname.startsWith("/api/")) return;
      if (url.pathname === window.location.pathname) return;
      start();
    };
    // Bubble phase on document: a handler that stopped propagation (an icon
    // button inside a card link, say) never reaches here, so it can't start a
    // loader for a navigation that isn't going to happen.
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [start]);

  // Route changed → hold for the minimum, then reveal.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (pathname === lastPath.current) return;
    lastPath.current = pathname;

    if (!isPhone()) {
      setRevealKey(pathname);
      return;
    }
    if (phase === "idle" || phase === "leaving") {
      startedAt.current = Date.now();
      setPhase("shown");
    }
    finish(pathname);
    // `phase` is read, not reacted to: only a pathname change should run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, finish]);

  useEffect(() => clearTimers, []);

  return { phase, revealKey };
}

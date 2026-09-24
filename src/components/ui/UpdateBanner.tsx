/**
 * Tells an open tab that a newer version of the app has been deployed.
 *
 * The app is a single-page bundle: a tab opened before a deploy keeps running
 * the old code until it is reloaded, so a newly shipped button simply is not
 * there and nothing says why. This compares the entry script the tab booted
 * with against the one index.html names now — checked when the tab regains
 * focus and every few minutes — and offers a reload when they differ.
 *
 * It also recovers from the other half of the same problem: after a deploy
 * the old build's lazy-loaded page chunks no longer exist, so opening a page
 * the tab had not visited yet fails. Vite reports that as `vite:preloadError`,
 * and a reload onto the new build is the fix.
 */
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

const CHECK_EVERY_MS = 5 * 60 * 1000;
const ENTRY = /\/assets\/index-[\w-]+\.js/;

function bootedEntry(): string | null {
  for (const s of Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]"))) {
    const m = s.src.match(ENTRY);
    if (m) return m[0];
  }
  return null;
}

async function liveEntry(): Promise<string | null> {
  const res = await fetch("/", { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.text()).match(ENTRY)?.[0] ?? null;
}

export function UpdateBanner() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    // In dev there is no hashed entry script, so there is nothing to compare.
    const booted = bootedEntry();
    if (!booted) return;

    let stopped = false;
    const check = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        const live = await liveEntry();
        if (live && live !== booted) setStale(true);
      } catch {
        // Offline or a blip; try again on the next tick.
      }
    };

    const onVisible = () => void check();
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  useEffect(() => {
    // A missing chunk means this tab is on a build that no longer exists.
    // Reload once; the guard stops a loop if the chunk is genuinely broken.
    const onPreloadError = (event: Event) => {
      const key = "acp:reloaded-for-chunk";
      try {
        if (sessionStorage.getItem(key)) return;
        sessionStorage.setItem(key, "1");
      } catch {
        return;
      }
      event.preventDefault();
      window.location.reload();
    };
    window.addEventListener("vite:preloadError", onPreloadError);
    // A successful boot clears the guard for the next deploy.
    try {
      sessionStorage.removeItem("acp:reloaded-for-chunk");
    } catch {
      // Storage blocked; the guard simply does not apply.
    }
    return () => window.removeEventListener("vite:preloadError", onPreloadError);
  }, []);

  if (!stale) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center justify-between gap-3 rounded-lg border border-[#C6A66B]/40 bg-[#161B22] px-4 py-3 shadow-2xl">
      <p className="text-xs text-slate-300">A new version of the Deal Room is available.</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="flex shrink-0 items-center gap-1.5 rounded bg-[#C6A66B] px-3 py-1.5 text-xs font-bold text-[#0F1115] transition hover:brightness-110"
      >
        <RefreshCw className="h-3.5 w-3.5" /> Reload
      </button>
    </div>
  );
}

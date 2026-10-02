/*
 * The deal room's phone shell: app bar, bottom tabs, the "More" sheet and the
 * page-switch loader. Everything here is `lg:hidden` — the desktop sidebar
 * layout in AppLayout is untouched above the lg breakpoint.
 */
import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronLeft, ChevronRight, KeyRound, LogOut, Moon, MoreHorizontal, Sun } from "lucide-react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { cx } from "../../utils/cx";
import { useTheme } from "../../hooks/useTheme";
import { phoneScroller, type LoaderPhase } from "../../hooks/useRouteTransition";
import { BrandLogo, BrandMark } from "../ui/BrandLogo";
import { LogoLoader } from "../ui/LogoLoader";

export interface ShellNavItem {
  to: string;
  icon: LucideIcon;
  label: string;
  /** Shorter label for the tab bar ("Active Deals" → "Deals"). */
  tabLabel?: string;
  end?: boolean;
}

/** Light tap feedback on phones that support it (Android); a no-op elsewhere. */
function haptic() {
  try {
    navigator.vibrate?.(6);
  } catch {
    /* unsupported */
  }
}

function isItemActive(item: ShellNavItem, pathname: string) {
  if (item.end) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

/* ─── App bar ─────────────────────────────────────────────────────────────── */

/** Routes deep enough to deserve a back arrow, and where "back" goes if there is no history. */
function parentOf(pathname: string): string | null {
  if (/^\/deals\/[^/]+\/edit$/.test(pathname)) return "/deals";
  if (pathname === "/deals/create") return "/deals";
  if (/^\/deals\/[^/]+$/.test(pathname)) return "/deals";
  return null;
}

export function MobileTopBar({
  title,
  subtitle,
  initials,
  onOpenAccount,
}: {
  title: string;
  subtitle?: string;
  initials: string;
  onOpenAccount: () => void;
}) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const parent = parentOf(pathname);

  // Top-level screens open with their own large page heading, so the bar
  // shows the Aysan wordmark until that heading scrolls away and the compact
  // title takes its place — the iOS large-title pattern. Sub-pages (a deal)
  // always show their title next to the back arrow.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const scroller = phoneScroller();
    if (!scroller) return;
    const onScroll = () => setScrolled(scroller.scrollTop > 64);
    onScroll();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [pathname]);
  const showTitle = Boolean(parent) || scrolled;

  const goBack = () => {
    haptic();
    // React Router stamps an index on history entries; idx > 0 means there is
    // an in-app page to go back to, rather than a link from outside.
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(parent ?? "/");
  };

  return (
    <header className="app-chrome lg:hidden relative shrink-0 z-30 pt-safe border-b border-white/[0.04] bg-acp-ink/80 backdrop-blur-xl">
      <div className="flex h-14 items-center gap-2 px-3">
        {parent ? (
          <button
            type="button"
            onClick={goBack}
            className="-ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white active:bg-white/[0.08] transition"
            aria-label="Back"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        ) : (
          <Link
            to="/"
            className={cx(
              "flex h-10 shrink-0 items-center justify-center text-acp-bronze transition-all duration-300",
              showTitle ? "w-10 opacity-100" : "w-0 -mr-2 opacity-0",
            )}
            aria-label="Home"
            tabIndex={showTitle ? 0 : -1}
          >
            <BrandMark className="h-7" />
          </Link>
        )}

        <div className="relative h-10 min-w-0 flex-1">
          <div
            className={cx(
              "absolute inset-0 flex items-center transition-all duration-300",
              showTitle ? "pointer-events-none -translate-y-2 opacity-0" : "opacity-100",
            )}
            aria-hidden={showTitle}
          >
            <BrandLogo className="h-[18px] text-white" />
          </div>
          <div
            className={cx(
              "absolute inset-0 flex flex-col justify-center transition-all duration-300",
              showTitle ? "opacity-100" : "pointer-events-none translate-y-2 opacity-0",
            )}
          >
            <h1 className="truncate text-[17px] font-semibold leading-tight tracking-tight text-white">{title}</h1>
            {subtitle && (
              <p className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-acp-bronze/90">{subtitle}</p>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenAccount}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-acp-bronze to-acp-bronze-dark text-[11px] font-black text-acp-on-accent shadow-[0_0_12px_rgba(198,166,107,0.25)] active:scale-95 transition"
          aria-label="Account and more"
        >
          {initials}
        </button>
      </div>
    </header>
  );
}

/* ─── Bottom tab bar ──────────────────────────────────────────────────────── */

export function MobileTabBar({
  tabs,
  moreItems,
  unreadMessages,
  isMoreOpen,
  onOpenMore,
}: {
  tabs: ShellNavItem[];
  moreItems: ShellNavItem[];
  unreadMessages: number;
  isMoreOpen: boolean;
  onOpenMore: () => void;
}) {
  const { pathname } = useLocation();
  const moreActive = isMoreOpen || moreItems.some((item) => isItemActive(item, pathname));

  return (
    <nav
      // Not position:fixed — it is the last row of the shell's full-height
      // column, below the scroll area, so nothing can scroll it away.
      className="app-chrome lg:hidden relative shrink-0 z-40 pb-safe border-t border-white/[0.05] bg-acp-navy/90 backdrop-blur-xl shadow-[0_-8px_24px_rgb(0_0_0/calc(0.25*var(--shadow-k)))]"
      aria-label="Main"
    >
      <div className="mx-auto flex h-[60px] max-w-xl items-stretch">
        {tabs.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={haptic}
            className="flex flex-1 flex-col items-center justify-center gap-1"
          >
            {({ isActive }) => (
              <TabGlyph
                icon={item.icon}
                label={item.tabLabel ?? item.label}
                active={isActive}
                badge={item.to === "/admin/messages" ? unreadMessages : 0}
              />
            )}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => {
            haptic();
            onOpenMore();
          }}
          className="flex flex-1 flex-col items-center justify-center gap-1"
          aria-haspopup="dialog"
          aria-expanded={isMoreOpen}
        >
          <TabGlyph icon={MoreHorizontal} label="More" active={moreActive} />
        </button>
      </div>
    </nav>
  );
}

function TabGlyph({
  icon: Icon,
  label,
  active,
  badge = 0,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  badge?: number;
}) {
  return (
    <>
      <span
        className={cx(
          "relative flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-200",
          active ? "bg-acp-bronze/15 text-acp-bronze" : "text-slate-400",
        )}
      >
        {active && <span className="absolute inset-0 rounded-full bg-acp-bronze/10 animate-tab-pop" />}
        <Icon className="relative h-[21px] w-[21px]" strokeWidth={active ? 2.2 : 1.8} />
        {badge > 0 && (
          <span className="absolute right-2 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-acp-bronze px-1 text-[9px] font-black text-acp-on-accent ring-2 ring-acp-navy">
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </span>
      <span
        className={cx(
          "text-[10.5px] leading-none tracking-wide transition-colors",
          active ? "font-bold text-acp-bronze" : "font-medium text-slate-400",
        )}
      >
        {label}
      </span>
    </>
  );
}

/* ─── "More" bottom sheet ─────────────────────────────────────────────────── */

export function MoreSheet({
  isOpen,
  onClose,
  items,
  name,
  role,
  initials,
  onChangePassword,
  onLogout,
}: {
  isOpen: boolean;
  onClose: () => void;
  items: ShellNavItem[];
  name: string;
  role: string;
  initials: string;
  onChangePassword: () => void;
  onLogout: () => void;
}) {
  const { pathname } = useLocation();
  const { theme, toggleTheme } = useTheme();
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  // The slide-up animation owns `transform` while it runs (an animation beats
  // an inline style), so the drag only takes over once it has finished.
  const [settled, setSettled] = useState(false);
  const dragStart = useRef<number | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setDragY(0);
      setSettled(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Pull the sheet down by its handle to dismiss it, as on iOS / Android.
  const onTouchStart = (e: React.TouchEvent) => {
    dragStart.current = e.touches[0].clientY;
    setDragging(true);
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (dragStart.current === null) return;
    setDragY(Math.max(0, e.touches[0].clientY - dragStart.current));
  };
  const onTouchEnd = () => {
    if (dragY > 90) onClose();
    else setDragY(0);
    setDragging(false);
    dragStart.current = null;
  };

  return (
    <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="More">
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm animate-fade-in" onClick={onClose} aria-hidden="true" />

      <div
        className={cx(
          "app-chrome absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-[28px] border-t border-white/[0.06] bg-acp-card pb-safe shadow-[0_-16px_48px_rgb(0_0_0/calc(0.5*var(--shadow-k)))]",
          !settled && "animate-sheet-up",
        )}
        onAnimationEnd={(e) => e.target === e.currentTarget && setSettled(true)}
        style={settled ? { transform: `translateY(${dragY}px)`, transition: dragging ? "none" : "transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)" } : undefined}
      >
        {/* Grab handle + account header (the drag target) */}
        <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} className="touch-none">
          <div className="flex justify-center pt-3 pb-2">
            <span className="h-1.5 w-10 rounded-full bg-white/[0.15]" />
          </div>
          <div className="flex items-center gap-3 px-5 pt-2 pb-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-acp-bronze to-acp-bronze-dark text-sm font-black text-acp-on-accent shadow-[0_0_16px_rgba(198,166,107,0.3)]">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-white">{name}</p>
              <p className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-acp-bronze/90">
                {role.replace(/_/g, " ")}
              </p>
            </div>
            <BrandLogo className="h-3.5 text-slate-500" />
          </div>
        </div>

        {items.length > 0 && (
          <div className="px-4">
            <p className="px-1 pb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Sections</p>
            <div className="grid grid-cols-3 gap-2.5">
              {items.map((item) => {
                const active = isItemActive(item, pathname);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => {
                      haptic();
                      onClose();
                    }}
                    className={cx(
                      "flex flex-col items-center justify-center gap-2 rounded-2xl border px-2 py-4 text-center transition active:scale-[0.97]",
                      active
                        ? "border-acp-bronze/30 bg-acp-bronze/10 text-acp-bronze"
                        : "border-white/[0.05] bg-white/[0.02] text-slate-300",
                    )}
                  >
                    <item.icon className="h-6 w-6" strokeWidth={1.8} />
                    <span className="text-[11px] font-semibold leading-tight">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-5 px-4 pb-5">
          <p className="px-1 pb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Account</p>
          <div className="overflow-hidden rounded-2xl border border-white/[0.05] bg-white/[0.02] divide-y divide-white/[0.05]">
            <SheetRow
              icon={theme === "light" ? Moon : Sun}
              label={theme === "light" ? "Dark mode" : "Light mode"}
              onClick={() => {
                haptic();
                toggleTheme();
              }}
            />
            <SheetRow
              icon={KeyRound}
              label="Change passcode"
              onClick={() => {
                onClose();
                onChangePassword();
              }}
            />
            <SheetRow icon={LogOut} label="Log out" danger onClick={onLogout} />
          </div>
        </div>
      </div>
    </div>
  );
}

function SheetRow({
  icon: Icon,
  label,
  onClick,
  danger = false,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex h-14 w-full items-center gap-3 px-4 text-left text-sm font-medium transition active:bg-white/[0.05]",
        danger ? "text-rose-400" : "text-slate-200",
      )}
    >
      <Icon className={cx("h-5 w-5", danger ? "text-rose-400" : "text-slate-400")} />
      <span className="flex-1">{label}</span>
      {!danger && <ChevronRight className="h-4 w-4 text-slate-600" />}
    </button>
  );
}

/* ─── Page-switch loader ──────────────────────────────────────────────────── */

/**
 * Covers the content area — not the app bar or tabs, which stay put as they
 * would in a native app — while the next page comes in.
 */
export function RouteLoaderOverlay({ phase }: { phase: LoaderPhase }) {
  if (phase === "idle") return null;
  return (
    <div
      className={cx(
        "lg:hidden fixed inset-0 z-20 flex items-center justify-center bg-acp-ink",
        phase === "leaving" && "animate-loader-out",
      )}
      aria-busy="true"
    >
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-acp-bronze/[0.06] blur-[90px]" />
      <LogoLoader size={84} />
    </div>
  );
}

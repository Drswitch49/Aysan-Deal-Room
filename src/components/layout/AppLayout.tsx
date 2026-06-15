import { useState, useEffect, useCallback } from "react";
import type { ReactNode } from "react";
import {
  Building2, LogOut, Menu, X,
  LayoutDashboard, Kanban, Users, Settings, KeyRound, Activity,
  ChevronLeft, ChevronRight, Inbox
} from "lucide-react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { cx } from "../../utils/cx";
import { changeAdminPassword, fetchAdminLenders } from "../../api/admin";
import { fetchRecentAdminChat } from "../../api/chat";
import { ChatNotificationWatcher } from "../ui/ChatNotificationWatcher";
import { Modal } from "../ui/Modal";
import { FormField, inputClass } from "../ui/FormField";

// ─── Navigation items data ──────────────────────────────────────────────────
const NAV_SECTIONS = [
  {
    group: "Operations",
    items: [
      { to: "/", icon: <LayoutDashboard className="h-4 w-4" />, label: "Dashboard", end: true },
      { to: "/admin/messages", icon: <Inbox className="h-4 w-4" />, label: "Inbox" },
      { to: "/deals", icon: <Kanban className="h-4 w-4" />, label: "Deal Pipeline", end: true },
      { to: "/admin/portco", icon: <Activity className="h-4 w-4" />, label: "Portfolio Monitor" },
    ],
  },
  {
    group: "Relations & Intelligence",
    items: [
      { to: "/admin/lenders", icon: <Building2 className="h-4 w-4" />, label: "Lender Intel" },
      { to: "/admin/hr", icon: <Users className="h-4 w-4" />, label: "HR & Stakeholders" },
      { to: "/admin/settings", icon: <Settings className="h-4 w-4" />, label: "Settings" },
    ],
  },
];

export function AppLayout() {
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState<number>(0);
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("acp_sidebar_collapsed");
      return saved === "true";
    }
    return false;
  });

  const toggleCollapse = useCallback(() => {
    setIsCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("acp_sidebar_collapsed", String(next));
      return next;
    });
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  // Close mobile menu on Escape key
  useEffect(() => {
    if (!isMobileMenuOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsMobileMenuOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isMobileMenuOpen]);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    document.body.style.overflow = isMobileMenuOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [isMobileMenuOpen]);

  useEffect(() => {
    const calculateAdminUnread = async () => {
      try {
        const [lenders, messages] = await Promise.all([
          fetchAdminLenders().catch(() => []),
          fetchRecentAdminChat().catch(() => []),
        ]);

        let unread = 0;
        lenders.forEach((l: any) => {
          const msgs = messages.filter((m: any) => m.lenderId === l.id && m.sender !== "Admin");
          if (msgs.length === 0) return;

          const msgsByDeal: Record<string, any[]> = {};
          msgs.forEach((m: any) => {
            if (!msgsByDeal[m.dealId]) msgsByDeal[m.dealId] = [];
            msgsByDeal[m.dealId].push(m);
          });

          const hasAnyUnreadDeal = Object.entries(msgsByDeal).some(([dealId, dealMsgs]) => {
            const lastReadTimeStr =
              localStorage.getItem(`admin_last_read_${l.id}_${dealId}`) ||
              localStorage.getItem(`admin_last_read_${l.id}`);
            const lastReadTime = lastReadTimeStr ? new Date(lastReadTimeStr).getTime() : 0;
            return dealMsgs.some((m) => new Date(m.timestamp).getTime() > lastReadTime);
          });

          if (hasAnyUnreadDeal) unread++;
        });

        setUnreadMessages(unread);
      } catch (err) {
        console.error("Failed to load layout unread count:", err);
      }
    };

    calculateAdminUnread();
    const interval = setInterval(calculateAdminUnread, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (err) {
      console.error("Logout request failed:", err);
    }
    sessionStorage.removeItem("admin_authenticated");
    window.location.reload();
  }, []);

  return (
    <div className="min-h-screen text-slate-100 lg:grid lg:grid-cols-[auto_minmax(0,1fr)] bg-acp-ink">
      {/* ── Desktop Sidebar ───────────────────────────────────────────── */}
      <aside className={cx(
        "hidden h-screen sticky top-0 border-r border-white/[0.03] bg-gradient-to-b from-[#111419] via-[#0D1013] to-[#08090C] text-white lg:flex flex-col relative overflow-hidden transition-all duration-300 ease-in-out shrink-0",
        isCollapsed ? "w-[68px]" : "w-[260px]"
      )}>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(198,166,107,0.04),transparent_45%)] pointer-events-none" />
        <div className={cx(
          "flex flex-col h-full py-7 z-10 relative transition-all duration-300 ease-in-out",
          isCollapsed ? "px-2" : "px-5"
        )}>
          {!isCollapsed ? (
            <div className="flex items-center justify-between mb-5">
              <BrandBlock isCollapsed={isCollapsed} />
              <button
                onClick={toggleCollapse}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.02] text-slate-400 hover:text-white hover:bg-white/[0.06] hover:border-white/[0.15] transition cursor-pointer select-none"
                title="Collapse Sidebar"
                type="button"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 mb-5">
              <BrandBlock isCollapsed={isCollapsed} />
              <button
                onClick={toggleCollapse}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.02] text-slate-400 hover:text-white hover:bg-white/[0.06] hover:border-white/[0.15] transition cursor-pointer select-none"
                title="Expand Sidebar"
                type="button"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
          <NavContent
            unreadMessages={unreadMessages}
            className="mt-6 flex-1 overflow-y-auto"
            isCollapsed={isCollapsed}
          />
          <UserFooter
            onLogout={handleLogout}
            onChangePassword={() => setIsChangePasswordOpen(true)}
            isCollapsed={isCollapsed}
          />
        </div>
      </aside>

      {/* ── Mobile Drawer ─────────────────────────────────────────────── */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex" role="dialog" aria-modal="true" aria-label="Navigation menu">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm animate-fade-in"
            onClick={() => setIsMobileMenuOpen(false)}
            aria-hidden="true"
          />

          {/* Drawer */}
          <aside className="relative flex w-[260px] max-w-[88vw] flex-col border-r border-white/[0.03] bg-gradient-to-b from-[#111419] via-[#0D1013] to-[#08090C] text-white h-full px-5 py-7 shadow-2xl animate-slide-in-left overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(198,166,107,0.05),transparent_45%)] pointer-events-none" />
            <div className="flex flex-col h-full z-10 relative">
              <div className="flex items-center justify-between mb-6">
                <BrandBlock />
                <button
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-slate-400 hover:text-white transition cursor-pointer"
                  aria-label="Close menu"
                  type="button"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <NavContent
                unreadMessages={unreadMessages}
                className="flex-1 overflow-y-auto"
                onNavigate={() => setIsMobileMenuOpen(false)}
              />
              <UserFooter onLogout={handleLogout} onChangePassword={() => setIsChangePasswordOpen(true)} />
            </div>
          </aside>
        </div>
      )}

      {/* ── Main Content Area ─────────────────────────────────────────── */}
      <div className="min-w-0 flex flex-col min-h-screen relative z-10">
        {/* Top Header */}
        <header className="sticky top-0 z-20 border-b border-white/[0.02] bg-[#0F1115]/60 backdrop-blur-xl">
          <div className="flex items-center justify-between gap-4 px-5 py-3.5 sm:px-8">
            {/* Mobile: Hamburger + Brand */}
            <div className="lg:hidden flex shrink-0 items-center gap-3 min-w-0">
              <button
                onClick={() => setIsMobileMenuOpen(true)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] border border-white/[0.1] text-white hover:bg-white/[0.1] transition cursor-pointer"
                aria-label="Open navigation menu"
                type="button"
              >
                <Menu className="h-4 w-4" />
              </button>
              <BrandBlock compact />
            </div>

            {/* Desktop: Breadcrumb / Context */}
            <div className="hidden lg:flex items-center gap-2 min-w-0">
              <span className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-slate-500">
                ACP Deal OS
              </span>
              <span className="text-slate-600 text-[10px]">/</span>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                {getBreadcrumb(location.pathname)}
              </span>
            </div>

            {/* Right side: Status pill */}
            <div className="flex items-center gap-2.5">
              <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-1">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                </span>
                <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-400/80">
                  Live
                </span>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-8 sm:py-8">
          <div className="mx-auto max-w-[1320px]">
            <Outlet />
          </div>
        </main>

        <ChangePasswordModal
          isOpen={isChangePasswordOpen}
          onClose={() => setIsChangePasswordOpen(false)}
        />
        <ChatNotificationWatcher mode="admin" />
      </div>
    </div>
  );
}

// ─── Breadcrumb helper ──────────────────────────────────────────────────────
function getBreadcrumb(pathname: string): string {
  if (pathname === "/" || pathname === "") return "Command Centre";
  if (pathname === "/deals") return "Deal Pipeline";
  if (pathname.startsWith("/deals/")) return "Deal Detail";
  if (pathname === "/admin/lenders") return "Lender Intelligence";
  if (pathname === "/admin/hr") return "HR & Stakeholders";
  if (pathname === "/admin/settings") return "Settings";
  if (pathname === "/admin/messages") return "Messages";
  if (pathname === "/admin/portco") return "Portfolio Monitor";
  return "Dashboard";
}

// ─── Brand Block ─────────────────────────────────────────────────────────────
function BrandBlock({ compact = false, isCollapsed = false }: { compact?: boolean; isCollapsed?: boolean }) {
  if (isCollapsed) {
    return (
      <Link to="/" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#D4AF37]/10 to-[#996515]/5 border border-[#C6A66B]/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_0_8px_rgba(198,166,107,0.15)] mx-auto hover:opacity-90 transition">
        <Building2 className="h-4.5 w-4.5 text-[#C6A66B]" aria-hidden="true" />
      </Link>
    );
  }

  if (compact) {
    return (
      <Link to="/" className="flex min-w-0 items-center gap-2.5 hover:opacity-85 transition">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#D4AF37]/10 to-[#996515]/5 border border-[#C6A66B]/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_0_8px_rgba(198,166,107,0.15)]">
          <Building2 className="h-4 w-4 text-[#C6A66B]" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="truncate font-heading text-xs font-semibold tracking-tight text-white uppercase leading-none">
            Aysan Capital
          </p>
          <p className="truncate text-[8px] font-bold uppercase tracking-widest text-[#C6A66B]/90 leading-none mt-0.5">
            Deal OS
          </p>
        </div>
      </Link>
    );
  }

  return (
    <Link to="/" className="block hover:opacity-85 transition select-none group">
      <p className="text-[8.5px] font-bold uppercase tracking-[0.22em] text-slate-405 leading-none transition-colors duration-300 group-hover:text-slate-300">
        Aysan Capital Partners
      </p>
      <h1 className="font-heading text-[16px] font-black leading-none uppercase tracking-tight mt-2 bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-100 to-slate-350">
        ACP DEAL OS
      </h1>
      <p className="text-[8px] font-extrabold tracking-[0.18em] bg-gradient-to-r from-[#C6A66B] via-[#E2C999] to-[#C6A66B] bg-clip-text text-transparent uppercase mt-1">
        Operational Intelligence
      </p>
      <div className="h-px w-full bg-gradient-to-r from-white/[0.06] via-white/[0.015] to-transparent mt-5" />
    </Link>
  );
}

// ─── Shared Nav Content (used in both desktop and mobile) ───────────────────
function NavContent({
  unreadMessages,
  className = "",
  onNavigate,
  isCollapsed = false,
}: {
  unreadMessages: number;
  className?: string;
  onNavigate?: () => void;
  isCollapsed?: boolean;
}) {
  return (
    <nav className={cx("space-y-5 pr-1 select-none", className)}>
      {NAV_SECTIONS.map((section) => (
        <div key={section.group} className="space-y-1">
          {!isCollapsed ? (
            <div className="flex items-center px-3.5 mb-2">
              <p className="text-[8px] font-bold uppercase tracking-[0.15em] text-slate-500">
                {section.group}
              </p>
            </div>
          ) : (
            <div className="h-px bg-white/[0.03] my-4 mx-2" />
          )}
          {section.items.map((item) => {
            const badge =
              item.to === "/admin/messages" && unreadMessages > 0 ? (
                isCollapsed ? (
                  <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-[#C6A66B] shadow-[0_0_6px_rgba(198,166,107,0.5)]" />
                ) : (
                  <span className="inline-flex h-4.5 min-w-[18px] items-center justify-center rounded-full bg-[#C6A66B]/15 border border-[#C6A66B]/30 px-1 text-[8.5px] font-black text-[#C6A66B] ml-auto">
                    {unreadMessages}
                  </span>
                )
              ) : null;

            return (
              <SideNavItem
                key={item.to}
                to={item.to}
                icon={item.icon}
                label={item.label}
                end={"end" in item ? (item as any).end : false}
                onClick={onNavigate}
                badge={badge}
                isCollapsed={isCollapsed}
              />
            );
          })}
        </div>
      ))}
    </nav>
  );
}

// ─── Side Nav Item ────────────────────────────────────────────────────────────
function SideNavItem({
  to,
  icon,
  label,
  onClick,
  end = false,
  badge,
  isCollapsed = false,
  activeOverride,
}: {
  to: string;
  icon: ReactNode;
  label: ReactNode;
  onClick?: () => void;
  end?: boolean;
  badge?: ReactNode;
  isCollapsed?: boolean;
  activeOverride?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) => {
        const isCurrentActive = activeOverride !== undefined ? activeOverride : isActive;
        return cx(
          "flex h-9.5 items-center rounded-lg text-xs font-medium transition-all duration-200 ease-in-out relative group border select-none",
          isCollapsed ? "justify-center px-0 w-9.5 mx-auto" : "gap-2.5 px-3.5",
          isCurrentActive
            ? "bg-white/[0.03] border-white/[0.04] text-white"
            : "border-transparent text-slate-400 hover:bg-white/[0.015] hover:text-white hover:border-white/[0.02]"
        );
      }}
      aria-current={undefined}
    >
      {({ isActive }) => {
        const isCurrentActive = activeOverride !== undefined ? activeOverride : isActive;
        return (
          <>
            {isCurrentActive && !isCollapsed && (
              <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-[#C6A66B] shadow-[0_0_6px_rgba(198,166,107,0.4)]" />
            )}
            {isCurrentActive && isCollapsed && (
              <span className="absolute left-1 top-2 bottom-2 w-[3px] rounded bg-[#C6A66B] shadow-[0_0_6px_rgba(198,166,107,0.4)]" />
            )}
            <span className={cx("shrink-0 transition-all duration-250", isCurrentActive ? "text-[#C6A66B]" : "text-slate-500 group-hover:text-slate-350")}>
              {icon}
            </span>
            {!isCollapsed && <span className="flex-1 truncate tracking-wide">{label}</span>}
            {!isCollapsed && badge}
            {isCollapsed && badge}

            {/* Hover Tooltip Reveal when Collapsed */}
            {isCollapsed && (
              <div className="absolute left-full ml-3.5 top-1/2 -translate-y-1/2 opacity-0 scale-95 pointer-events-none group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto transition-all duration-150 origin-left z-50 bg-[#161B22]/95 border border-white/[0.08] text-slate-200 font-semibold text-[11px] py-1.5 px-3 rounded-lg shadow-[0_4px_16px_rgba(0,0,0,0.6)] backdrop-blur-md whitespace-nowrap">
                {label}
              </div>
            )}
          </>
        );
      }}
    </NavLink>
  );
}

// ─── User Footer ──────────────────────────────────────────────────────────────
function UserFooter({
  onLogout,
  onChangePassword,
  isCollapsed = false,
}: {
  onLogout: () => void;
  onChangePassword: () => void;
  isCollapsed?: boolean;
}) {
  if (isCollapsed) {
    return (
      <div className="mt-auto pt-4 border-t border-white/[0.03] flex flex-col items-center gap-3 relative group/footer">
        {/* User initials bubble acting as trigger */}
        <div className="relative cursor-pointer">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#D4AF37] to-[#AA771C] text-[#101317] font-black text-xs shadow-md border border-[#C6A66B]/20">
            AO
          </div>
          <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-500 border border-[#101317]" />
        </div>

        {/* Hover popover controls */}
        <div className="absolute bottom-10 left-full ml-3 opacity-0 scale-95 pointer-events-none group-hover/footer:opacity-100 group-hover/footer:scale-100 group-hover/footer:pointer-events-auto transition-all duration-150 origin-bottom-left z-50 bg-[#161B22]/95 border border-white/[0.08] p-3.5 rounded-xl shadow-[0_6px_24px_rgba(0,0,0,0.7)] backdrop-blur-md min-w-[170px] space-y-3">
          <div className="border-b border-white/5 pb-2">
            <p className="text-xs font-bold text-white tracking-wide leading-none">Ayo Oyesanya</p>
            <p className="text-[9px] font-extrabold uppercase tracking-wider text-[#C6A66B]/80 leading-none mt-1">Managing Partner</p>
          </div>
          <div className="flex flex-col gap-1.5 pt-0.5">
            <button
              onClick={onChangePassword}
              className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.04] text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
              type="button"
            >
              <KeyRound className="h-3.5 w-3.5 text-slate-500 shrink-0" />
              Change Passcode
            </button>
            <button
              onClick={onLogout}
              className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
              type="button"
            >
              <LogOut className="h-3.5 w-3.5 text-slate-500 shrink-0" />
              Log Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-auto pt-4 border-t border-white/[0.03] relative">
      <div className="flex items-center justify-between gap-2.5 rounded-xl border border-white/[0.02] bg-white/[0.005] p-2 hover:bg-white/[0.015] hover:border-white/[0.04] transition-all duration-300">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#D4AF37] to-[#AA771C] text-[#101317] font-black shadow-[0_0_12px_rgba(198,166,107,0.25)] text-[10px]">
            AO
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-white tracking-wide leading-none mb-0.5">
              Ayo Oyesanya
            </p>
            <p className="truncate text-[9px] font-bold uppercase tracking-wider text-[#C6A66B]/80 leading-none">
              Managing Partner
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onChangePassword}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.03] bg-white/[0.02] text-slate-400 hover:text-[#C6A66B] hover:bg-[#C6A66B]/15 hover:border-[#C6A66B]/30 hover:scale-105 transition-all duration-200 cursor-pointer"
            title="Change Passcode"
            type="button"
            aria-label="Change passcode"
          >
            <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            onClick={onLogout}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.03] bg-white/[0.02] text-slate-400 hover:text-rose-400 hover:bg-rose-500/15 hover:border-rose-500/30 hover:scale-105 transition-all duration-200 cursor-pointer"
            title="Log Out Session"
            type="button"
            aria-label="Log out"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Change Password Modal ────────────────────────────────────────────────────
function ChangePasswordModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess(false);

    if (!currentPassword) {
      setError("Current passcode is required.");
      return;
    }

    if (!newPassword || newPassword.trim() === "") {
      setError("New passcode cannot be empty.");
      return;
    }

    // Password strength check
    const passwordRegex = /^(?=.*[a-zA-Z])(?=.*[0-9!@#$%^&*()_+\-=[\]{};':",\\|.<>?]).{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      setError("New passcode must be at least 8 characters long and contain both letters and numbers/special characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      await changeAdminPassword(currentPassword, newPassword);
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => {
        onClose();
        setSuccess(false);
      }, 1500);
    } catch (err: any) {
      setError(err.message || "Failed to update passcode.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Change Admin Passcode">
      <form onSubmit={handleSubmit} className="space-y-4 font-sans">
        {error && (
          <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-center text-xs font-semibold text-rose-400">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-center text-xs font-semibold text-emerald-400">
            Passcode successfully updated!
          </div>
        )}

        <FormField label="Current Passcode" required id="change-pwd-current">
          <input
            id="change-pwd-current"
            type="password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="••••••••"
            className="h-10 w-full rounded-xl border border-white/[0.02] bg-white/[0.015] px-3 text-xs text-white placeholder-slate-600 outline-none focus:border-acp-bronze transition"
          />
        </FormField>

        <FormField label="New Passcode" required id="change-pwd-new">
          <input
            id="change-pwd-new"
            type="password"
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="••••••••"
            className="h-10 w-full rounded-xl border border-white/[0.02] bg-white/[0.015] px-3 text-xs text-white placeholder-slate-600 outline-none focus:border-acp-bronze transition"
          />
        </FormField>

        <FormField label="Confirm New Passcode" required id="change-pwd-confirm">
          <input
            id="change-pwd-confirm"
            type="password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
            className="h-10 w-full rounded-xl border border-white/[0.02] bg-white/[0.015] px-3 text-xs text-white placeholder-slate-600 outline-none focus:border-acp-bronze transition"
          />
        </FormField>

        <div className="text-[10px] text-slate-500 leading-normal bg-white/[0.01] border border-white/[0.03] rounded-lg p-2.5">
          <strong>Password Policy:</strong> Passcode must be at least 8 characters long and contain both letters and numbers/special characters.
        </div>

        <div className="flex justify-end gap-2.5 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded-xl border border-white/[0.02] text-slate-350 text-xs font-bold uppercase tracking-wider hover:bg-white/[0.015] transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting || success}
            className="h-9 px-4 rounded-xl bg-gradient-to-r from-acp-bronze to-acp-bronze-dark text-white text-xs font-bold uppercase tracking-wider disabled:opacity-40 disabled:pointer-events-none hover:shadow-glow-bronze transition cursor-pointer"
          >
            {isSubmitting ? "Updating..." : "Update Passcode"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

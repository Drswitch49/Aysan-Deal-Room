import { useState } from "react";
import type { ReactNode } from "react";
import { 
  Building2, Database, FolderOpen, LockKeyhole, ShieldCheck, Table2, Shield, LogOut, Menu, X, Key, MessageSquare,
  LayoutDashboard, Kanban, FileText, LineChart, Users, Compass, Settings
} from "lucide-react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { cx } from "../../utils/cx";
import { changeAdminPassword, fetchAdminLenders } from "../../api/admin";
import { fetchRecentAdminChat } from "../../api/chat";
import { ChatNotificationWatcher } from "../ui/ChatNotificationWatcher";
import { useEffect } from "react";

export function AppLayout() {
  const location = useLocation();
  const isPipelinePage = location.pathname === "/deals" || location.pathname === "/";
  const isDealDetailPage = location.pathname.startsWith("/deals") && location.pathname !== "/deals";
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState<number>(0);

  useEffect(() => {
    const calculateAdminUnread = async () => {
      try {
        const [lenders, messages] = await Promise.all([
          fetchAdminLenders().catch(() => []),
          fetchRecentAdminChat().catch(() => [])
        ]);

        let unread = 0;
        lenders.forEach((l: any) => {
          const msgs = messages.filter((m) => m.lenderId === l.id && m.sender !== "Admin");
          if (msgs.length === 0) return;

          const msgsByDeal: Record<string, any[]> = {};
          msgs.forEach((m) => {
            if (!msgsByDeal[m.dealId]) msgsByDeal[m.dealId] = [];
            msgsByDeal[m.dealId].push(m);
          });

          const hasAnyUnreadDeal = Object.entries(msgsByDeal).some(([dealId, dealMsgs]) => {
            const lastReadTimeStr = localStorage.getItem(`admin_last_read_${l.id}_${dealId}`) || 
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

  const handleLogout = () => {
    sessionStorage.removeItem("admin_authenticated");
    window.location.reload();
  };

  return (
    <div className="min-h-screen text-slate-100 lg:grid lg:grid-cols-[284px_minmax(0,1fr)] bg-acp-ink">
      {/* Desktop Sidebar */}
      <aside className="hidden h-screen sticky top-0 border-r border-white/[0.06] bg-[#0D0D0E] text-white lg:block relative overflow-hidden">
        {/* Subtle decorative glow in sidebar background */}
        <div className="absolute -left-12 -top-12 h-48 w-48 rounded-full bg-acp-bronze/5 blur-3xl pointer-events-none" />
        <div className="absolute -right-20 bottom-10 h-64 w-64 rounded-full bg-acp-bronze/5 blur-3xl pointer-events-none" />

        <div className="flex h-full flex-col px-6 py-7 z-10">
          <BrandBlock />

          <nav className="mt-8 flex-1 space-y-6 overflow-y-auto pr-1 select-none">
            {/* OPERATIONS SECTION */}
            <div className="space-y-1">
              <p className="text-[9px] font-extrabold uppercase tracking-[0.2em] text-slate-500 px-3.5 mb-1.5">Operations</p>
              <SideNavItem to="/" icon={<LayoutDashboard className="h-4 w-4" />} label="Dashboard" end />
              <SideNavItem to="/deals" icon={<Kanban className="h-4 w-4" />} label="Deal Pipeline" end />
            </div>

            {/* INTELLIGENCE SECTION */}
            <div className="space-y-1">
              <p className="text-[9px] font-extrabold uppercase tracking-[0.2em] text-slate-500 px-3.5 mb-1.5">Intelligence</p>
              <SideNavItem 
                to="/admin/lenders" 
                icon={<Building2 className="h-4 w-4" />} 
                label="Lender Intel" 
                badge={unreadMessages > 0 ? (
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[9px] font-black text-white shadow-[0_0_8px_rgba(239,68,68,0.4)] ml-auto">
                    {unreadMessages}
                  </span>
                ) : null}
              />
            </div>

            {/* PEOPLE SECTION */}
            <div className="space-y-1">
              <p className="text-[9px] font-extrabold uppercase tracking-[0.2em] text-slate-500 px-3.5 mb-1.5">People</p>
              <SideNavItem to="/admin/hr" icon={<Users className="h-4 w-4" />} label="HR & Stakeholders" />
            </div>

            {/* SYSTEM SECTION */}
            <div className="space-y-1">
              <p className="text-[9px] font-extrabold uppercase tracking-[0.2em] text-slate-500 px-3.5 mb-1.5">System</p>
              <SideNavItem to="/admin/settings" icon={<Settings className="h-4 w-4" />} label="Settings" />
            </div>
          </nav>

          {/* User Profile Footer */}
          <div className="mt-auto pt-4 border-t border-white/[0.06]">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F5C443] text-xs font-black text-slate-950 shadow-sm border border-[#F5C443]/20">
                  AO
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-white tracking-wide leading-none mb-1">
                    Ayo Oyesanya
                  </p>
                  <p className="truncate text-[9px] font-extrabold uppercase tracking-wider text-acp-bronze">
                    Managing Partner
                  </p>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-400 hover:text-rose-450 hover:bg-rose-500/10 hover:border-rose-500/20 transition cursor-pointer"
                title="Log Out Session"
                type="button"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile Sidebar Navigation Drawer */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm transition-opacity duration-300"
            onClick={() => setIsMobileMenuOpen(false)}
          />
          
          {/* Drawer Sidebar */}
          <aside className="relative flex w-[284px] max-w-[85vw] flex-col border-r border-white/[0.06] bg-[#0D0D0E] text-white h-full px-6 py-7 shadow-2xl animate-slide-in-left overflow-hidden">
            {/* Subtle decorative glow in drawer background */}
            <div className="absolute -left-12 -top-12 h-48 w-48 rounded-full bg-acp-bronze/5 blur-3xl pointer-events-none" />
            <div className="absolute -right-20 bottom-10 h-64 w-64 rounded-full bg-acp-bronze/5 blur-3xl pointer-events-none" />

            <div className="flex h-full flex-col z-10">
              <div className="flex items-center justify-between gap-3">
                <BrandBlock />
                <button
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="h-8 w-8 flex items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-400 hover:text-white transition cursor-pointer"
                  aria-label="Close menu"
                  type="button"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <nav className="mt-8 flex-1 space-y-6 overflow-y-auto pr-1 select-none">
                {/* OPERATIONS SECTION */}
                <div className="space-y-1">
                  <p className="text-[9px] font-extrabold uppercase tracking-[0.2em] text-slate-500 px-3.5 mb-1.5">Operations</p>
                  <SideNavItem to="/" icon={<LayoutDashboard className="h-4 w-4" />} label="Dashboard" end onClick={() => setIsMobileMenuOpen(false)} />
                  <SideNavItem to="/deals" icon={<Kanban className="h-4 w-4" />} label="Deal Pipeline" end onClick={() => setIsMobileMenuOpen(false)} />
                </div>

                {/* INTELLIGENCE SECTION */}
                <div className="space-y-1">
                  <p className="text-[9px] font-extrabold uppercase tracking-[0.2em] text-slate-500 px-3.5 mb-1.5">Intelligence</p>
                  <SideNavItem 
                    to="/admin/lenders" 
                    icon={<Building2 className="h-4 w-4" />} 
                    label="Lender Intel" 
                    onClick={() => setIsMobileMenuOpen(false)} 
                    badge={unreadMessages > 0 ? (
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[9px] font-black text-white shadow-[0_0_8px_rgba(239,68,68,0.4)] ml-auto">
                        {unreadMessages}
                      </span>
                    ) : null}
                  />
                </div>

                {/* PEOPLE SECTION */}
                <div className="space-y-1">
                  <p className="text-[9px] font-extrabold uppercase tracking-[0.2em] text-slate-500 px-3.5 mb-1.5">People</p>
                  <SideNavItem to="/admin/hr" icon={<Users className="h-4 w-4" />} label="HR & Stakeholders" onClick={() => setIsMobileMenuOpen(false)} />
                </div>

                {/* SYSTEM SECTION */}
                <div className="space-y-1">
                  <p className="text-[9px] font-extrabold uppercase tracking-[0.2em] text-slate-500 px-3.5 mb-1.5">System</p>
                  <SideNavItem to="/admin/settings" icon={<Settings className="h-4 w-4" />} label="Settings" onClick={() => setIsMobileMenuOpen(false)} />
                </div>
              </nav>

              {/* User Profile Footer */}
              <div className="mt-auto pt-4 border-t border-white/[0.06]">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F5C443] text-xs font-black text-slate-950 shadow-sm border border-[#F5C443]/20">
                      AO
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-white tracking-wide leading-none mb-1">
                        Ayo Oyesanya
                      </p>
                      <p className="truncate text-[9px] font-extrabold uppercase tracking-wider text-acp-bronze">
                        Managing Partner
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      handleLogout();
                    }}
                    className="h-8 w-8 flex items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-400 hover:text-rose-450 hover:bg-rose-500/10 hover:border-rose-500/20 transition cursor-pointer"
                    title="Log Out Session"
                    type="button"
                  >
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="min-w-0 flex flex-col min-h-screen relative z-10">
        <header className="sticky top-0 z-20 border-b border-white/[0.06] bg-[#0A0A0B]/40 backdrop-blur-md shadow-soft lg:bg-[#0A0A0B]/20">
          <div className="flex items-center justify-between gap-4 px-6 py-4 sm:px-8">
            <div className="lg:hidden flex shrink-0 items-center gap-3 min-w-0">
              <button
                onClick={() => setIsMobileMenuOpen(true)}
                className="h-9 w-9 flex shrink-0 items-center justify-center rounded-xl bg-white/10 border border-white/15 text-white hover:bg-white/20 transition cursor-pointer"
                title="Open menu"
                type="button"
              >
                <Menu className="h-5 w-5 text-white" />
              </button>
              <BrandBlock compact />
            </div>
            <div className="hidden min-w-0 lg:block">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-slate-400">Secure Environment</p>
              <Link to="/deals" className="block mt-1 text-xs font-bold text-slate-300 tracking-wide uppercase hover:text-white transition-colors">
                Aysan Capital Partners Pipeline
              </Link>
            </div>
            <div className="hidden items-center gap-2.5 md:flex">
              <Pill icon={<Database className="h-3.5 w-3.5 text-acp-bronze" aria-hidden="true" />} label="Active Pipeline" to="/deals" />
              <Pill icon={<ShieldCheck className="h-3.5 w-3.5 text-acp-emerald" aria-hidden="true" />} label="Secure Access" />
            </div>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-8 sm:py-8">
          <div className="mx-auto max-w-[1280px]">
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

function ChangePasswordModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess(false);

    if (!newPassword || newPassword.trim() === "") {
      setError("Password cannot be empty.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      await changeAdminPassword(newPassword);
      setSuccess(true);
      sessionStorage.setItem("admin_passcode", newPassword); // Update active session passcode
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={onClose} />
      
      {/* Modal Card */}
      <form 
        onSubmit={handleSubmit}
        className="relative z-10 w-full max-w-sm rounded-2xl border border-white/10 bg-[#0D0D0E] p-6 shadow-2xl backdrop-blur-xl animate-fade-in-up"
      >
        <div className="flex items-center justify-between pb-4 border-b border-white/5">
          <h3 className="font-display text-lg text-white font-normal italic tracking-wide">
            Change Admin Passcode
          </h3>
          <button 
            type="button" 
            onClick={onClose} 
            className="text-slate-400 hover:text-white transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          {error && (
            <div className="rounded-lg border border-rose-500/10 bg-rose-500/5 p-3 text-center text-xs font-semibold text-rose-400">
              {error}
            </div>
          )}

          {success && (
            <div className="rounded-lg border border-emerald-500/10 bg-emerald-500/5 p-3 text-center text-xs font-semibold text-acp-emerald">
              Passcode successfully updated!
            </div>
          )}

          <div className="space-y-1.5">
            <label className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-400">
              New Passcode
            </label>
            <input
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
              className="h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-white placeholder-slate-650 outline-none focus:border-acp-bronze focus:ring-1 focus:ring-acp-bronze transition"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-400">
              Confirm New Passcode
            </label>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              className="h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-white placeholder-slate-650 outline-none focus:border-acp-bronze focus:ring-1 focus:ring-acp-bronze transition"
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded-xl border border-white/10 text-slate-350 text-xs font-bold uppercase tracking-wider hover:bg-white/5 transition"
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
    </div>
  );
}


function BrandBlock({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <Link to="/" className="flex min-w-0 items-center gap-3 hover:opacity-90 transition">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#C5A059]/20 to-[#C5A059]/20 text-white border border-[#C5A059]/30">
          <Building2 className="h-5 w-5 text-white" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="truncate font-heading text-base font-black tracking-tight text-white uppercase">
            Aysan Capital
          </p>
          <p className="truncate text-[10px] font-extrabold uppercase tracking-[0.18em] text-acp-bronze">
            Deal Room Portal
          </p>
        </div>
      </Link>
    );
  }

  return (
    <Link to="/" className="min-w-0 space-y-0.5 select-none text-left mb-6 block hover:opacity-90 transition">
      <p className="text-[9px] font-bold uppercase tracking-[0.25em] text-slate-500">
        AYSAN CAPITAL
      </p>
      <h1 className="font-heading text-xl font-black text-white leading-none uppercase tracking-tight">
        ACP Deal OS
      </h1>
      <p className="text-[8px] font-bold tracking-wide text-acp-bronze uppercase">
        Operator-Investor Platform
      </p>
    </Link>
  );
}

function SideNavItem({ 
  to, 
  icon, 
  label, 
  onClick, 
  disabled = false, 
  end = false, 
  activeOverride,
  badge
}: { 
  to: string; 
  icon: ReactNode; 
  label: ReactNode; 
  onClick?: () => void; 
  disabled?: boolean;
  end?: boolean;
  activeOverride?: boolean;
  badge?: ReactNode;
}) {
  if (disabled) {
    return (
      <div
        className="flex h-10 items-center gap-3 rounded-lg px-3.5 text-xs font-bold text-slate-655 cursor-not-allowed select-none border border-transparent"
      >
        <span className="opacity-40">{icon}</span>
        <span className="opacity-40">{label}</span>
      </div>
    );
  }

  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) => {
        const isCurrentActive = activeOverride !== undefined ? activeOverride : isActive;
        return cx(
          "flex h-10 items-center gap-3 rounded-lg px-3.5 text-xs font-bold transition-all duration-300 relative group border",
          isCurrentActive
            ? "bg-white/[0.04] border-white/10 text-white shadow-soft"
            : "border-transparent text-slate-400 hover:bg-white/[0.02] hover:text-white",
        );
      }}
    >
      <span className="transition-transform duration-300 group-hover:scale-105">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {badge}
    </NavLink>
  );
}

function SideFact({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-3 text-xs font-semibold text-slate-300">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.03] border border-white/5 text-acp-bronze/80">{icon}</span>
      {label}
    </div>
  );
}

function Pill({ icon, label, to }: { icon: ReactNode; label: string; to?: string }) {
  const content = (
    <>
      {icon}
      {label}
    </>
  );

  const className = "inline-flex h-8 items-center gap-2 rounded-full border border-white/10 bg-white/[0.02] backdrop-blur-sm px-3.5 text-xs font-bold tracking-wide text-slate-300 shadow-sm transition-all duration-300 hover:border-white/25 hover:bg-white/5 hover:text-white cursor-pointer";

  if (to) {
    return (
      <Link to={to} className={className}>
        {content}
      </Link>
    );
  }

  return (
    <span className={className}>
      {content}
    </span>
  );
}

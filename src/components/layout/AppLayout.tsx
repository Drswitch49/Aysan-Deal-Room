import { useState } from "react";
import type { ReactNode } from "react";
import { Building2, Database, FolderOpen, LockKeyhole, ShieldCheck, Table2, Shield, LogOut, Menu, X } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { cx } from "../../utils/cx";

export function AppLayout() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleLogout = () => {
    sessionStorage.removeItem("admin_authenticated");
    window.location.reload();
  };

  return (
    <div className="min-h-screen text-slate-100 lg:grid lg:grid-cols-[284px_minmax(0,1fr)] bg-acp-ink">
      {/* Desktop Sidebar */}
      <aside className="hidden h-screen sticky top-0 border-r border-white/[0.06] bg-[#090816] text-white lg:block relative overflow-hidden">
        {/* Subtle decorative glow in sidebar background */}
        <div className="absolute -left-12 -top-12 h-48 w-48 rounded-full bg-acp-purple/5 blur-3xl pointer-events-none" />
        <div className="absolute -right-20 bottom-10 h-64 w-64 rounded-full bg-acp-blue/5 blur-3xl pointer-events-none" />

        <div className="flex h-full flex-col px-6 py-7 z-10">
          <BrandBlock />

          <nav className="mt-10 space-y-1.5">
            <SideNavItem to="/deals" icon={<FolderOpen className="h-4 w-4" aria-hidden="true" />} label="Active Deals" />
            <SideNavItem to="/admin/lenders" icon={<Building2 className="h-4 w-4" aria-hidden="true" />} label="Lenders" />
          </nav>

          <div className="mt-8 rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] backdrop-blur-md">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-acp-purple">Operating Model</p>
            <div className="mt-4 space-y-3.5">
              <SideFact icon={<Database className="h-3.5 w-3.5" aria-hidden="true" />} label="Live Database Sync" />
              <SideFact icon={<Table2 className="h-3.5 w-3.5" aria-hidden="true" />} label="Read-Only Access" />
              <SideFact icon={<LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />} label="Restricted Actions" />
            </div>
          </div>

          {/* Active Session Card with Logout Option */}
          <div className="mt-auto pt-4 border-t border-white/[0.04]">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-acp-purple/10 border border-acp-purple/20 text-xs font-bold text-acp-purple shadow-sm">
                  <Shield className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-white tracking-wide">
                    Active Session
                  </p>
                  <p className="truncate text-[9px] font-extrabold uppercase tracking-wider text-slate-500">
                    Secure Admin Panel
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
          <aside className="relative flex w-[284px] max-w-[85vw] flex-col border-r border-white/[0.06] bg-[#090816] text-white h-full px-6 py-7 shadow-2xl animate-slide-in-left overflow-hidden">
            {/* Subtle decorative glow in drawer background */}
            <div className="absolute -left-12 -top-12 h-48 w-48 rounded-full bg-acp-purple/5 blur-3xl pointer-events-none" />
            <div className="absolute -right-20 bottom-10 h-64 w-64 rounded-full bg-acp-blue/5 blur-3xl pointer-events-none" />

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

              <nav className="mt-10 space-y-1.5">
                <SideNavItem to="/deals" icon={<FolderOpen className="h-4 w-4" aria-hidden="true" />} label="Active Deals" onClick={() => setIsMobileMenuOpen(false)} />
                <SideNavItem to="/admin/lenders" icon={<Building2 className="h-4 w-4" aria-hidden="true" />} label="Lenders" onClick={() => setIsMobileMenuOpen(false)} />
              </nav>

              <div className="mt-8 rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] backdrop-blur-md">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-acp-purple">Operating Model</p>
                <div className="mt-4 space-y-3.5">
                  <SideFact icon={<Database className="h-3.5 w-3.5" aria-hidden="true" />} label="Live Database Sync" />
                  <SideFact icon={<Table2 className="h-3.5 w-3.5" aria-hidden="true" />} label="Read-Only Access" />
                  <SideFact icon={<LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />} label="Restricted Actions" />
                </div>
              </div>

              {/* Active Session Card with Logout Option */}
              <div className="mt-auto pt-4 border-t border-white/[0.04]">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-acp-purple/10 border border-acp-purple/20 text-xs font-bold text-acp-purple shadow-sm">
                      <Shield className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-white tracking-wide">
                        Active Session
                      </p>
                      <p className="truncate text-[9px] font-extrabold uppercase tracking-wider text-slate-500">
                        Secure Admin Panel
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
        <header className="sticky top-0 z-20 border-b border-white/[0.06] bg-[#060814]/40 backdrop-blur-md shadow-soft lg:bg-[#060814]/20">
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
              <p className="mt-1 text-xs font-bold text-slate-300 tracking-wide uppercase">Aysan Capital Partners Pipeline</p>
            </div>
            <div className="hidden items-center gap-2.5 md:flex">
              <Pill icon={<Database className="h-3.5 w-3.5 text-acp-blue" aria-hidden="true" />} label="Active Pipeline" />
              <Pill icon={<ShieldCheck className="h-3.5 w-3.5 text-acp-emerald" aria-hidden="true" />} label="Secure Access" />
            </div>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-8 sm:py-8">
          <div className="mx-auto max-w-[1280px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}


function BrandBlock({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div
        className={cx(
          "flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#8b5cf6]/20 to-[#5b5ef0]/20 text-white shadow-md border border-[#8b5cf6]/30",
          compact ? "h-10 w-10" : "h-11 w-11",
        )}
      >
        <Building2 className="h-5 w-5 text-white" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="truncate font-heading text-base font-black tracking-tight text-white uppercase">
          Aysan Capital
        </p>
        <p className="truncate text-[10px] font-extrabold uppercase tracking-[0.18em] text-acp-purple">
          Deal Room Portal
        </p>
      </div>
    </div>
  );
}

function SideNavItem({ to, icon, label, onClick }: { to: string; icon: ReactNode; label: string; onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        cx(
          "flex h-11 items-center gap-3 rounded-lg px-3.5 text-xs font-bold uppercase tracking-wider transition-all duration-300 relative group border",
          isActive
            ? "bg-[#0d0c1d] border-white/10 text-white shadow-soft"
            : "border-transparent text-slate-400 hover:bg-white/[0.03] hover:text-white",
        )
      }
    >
      <span className="transition-transform duration-300 group-hover:scale-110">{icon}</span>
      {label}
    </NavLink>
  );
}

function SideFact({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-3 text-xs font-semibold text-slate-300">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.03] border border-white/5 text-acp-purple/80">{icon}</span>
      {label}
    </div>
  );
}

function Pill({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="inline-flex h-8 items-center gap-2 rounded-full border border-white/10 bg-white/[0.02] backdrop-blur-sm px-3.5 text-xs font-bold tracking-wide text-slate-300 shadow-sm transition-all duration-300 hover:border-white/20 hover:bg-white/5">
      {icon}
      {label}
    </span>
  );
}

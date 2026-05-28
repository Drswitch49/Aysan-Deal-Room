import type { ReactNode } from "react";
import { Building2, Database, FolderOpen, LockKeyhole, ShieldCheck, Table2, Volume2, Music, Settings, Bell, Shield } from "lucide-react";
import { NavLink, Outlet, useLocation, Link } from "react-router-dom";
import { cx } from "../../utils/cx";

export function AppLayout() {
  const location = useLocation();
  const match = location.pathname.match(/\/(deals|lender)\/([^/]+)/);
  const activeRef = match ? match[2] : null;

  return (
    <div className="min-h-screen text-slate-100 lg:grid lg:grid-cols-[284px_minmax(0,1fr)] bg-acp-ink">
      {/* Sidebar */}
      <aside className="hidden min-h-screen border-r border-white/[0.06] bg-[#090816] text-white lg:block relative overflow-hidden">
        {/* Subtle decorative glow in sidebar background */}
        <div className="absolute -left-12 -top-12 h-48 w-48 rounded-full bg-acp-purple/5 blur-3xl pointer-events-none" />
        <div className="absolute -right-20 bottom-10 h-64 w-64 rounded-full bg-acp-blue/5 blur-3xl pointer-events-none" />

        <div className="sticky top-0 flex h-screen flex-col px-6 py-7 z-10">
          <BrandBlock />

          <nav className="mt-10 space-y-1.5">
            <SideNavItem to="/deals" icon={<FolderOpen className="h-4 w-4" aria-hidden="true" />} label="Active Deals" />
          </nav>

          <div className="mt-8 rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] backdrop-blur-md">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-acp-purple">Operating Model</p>
            <div className="mt-4 space-y-3.5">
              <SideFact icon={<Database className="h-3.5 w-3.5" aria-hidden="true" />} label="Airtable Source" />
              <SideFact icon={<Table2 className="h-3.5 w-3.5" aria-hidden="true" />} label="Read-Only Layer" />
              <SideFact icon={<LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />} label="Restricted Actions" />
            </div>
          </div>

          {/* Active Session Card (replacing private profile card) */}
          <div className="mt-auto flex items-center gap-3 pt-4 border-t border-white/[0.04]">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-acp-purple/10 border border-acp-purple/20 text-xs font-bold text-acp-purple shadow-sm">
              <Shield className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-bold text-white tracking-wide">
                Active Session
              </p>
              <p className="truncate text-[10px] font-extrabold uppercase tracking-wider text-slate-555">
                Authorized VDR Node
              </p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="min-w-0 flex flex-col min-h-screen relative z-10">
        <header className="sticky top-0 z-20 border-b border-white/[0.06] bg-[#060814]/40 backdrop-blur-md shadow-soft lg:bg-[#060814]/20">
          <div className="flex items-center justify-between gap-4 px-6 py-4 sm:px-8">
            <div className="lg:hidden">
              <BrandBlock compact />
            </div>
            <div className="hidden min-w-0 lg:block">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-slate-400">Secure Environment</p>
              <p className="mt-1 text-xs font-bold text-slate-300 tracking-wide uppercase">Aysan Capital Partners Pipeline</p>
            </div>
            <div className="hidden items-center gap-2.5 md:flex">
              <Pill icon={<Database className="h-3.5 w-3.5 text-acp-blue" aria-hidden="true" />} label="Airtable Pipeline" />
              <Pill icon={<ShieldCheck className="h-3.5 w-3.5 text-acp-emerald" aria-hidden="true" />} label="Secure Display" />
              <span className="w-px bg-white/10 h-5 mx-1" />
              <div className="flex items-center gap-2">
                <HeaderButton icon={<Volume2 className="h-4 w-4" />} />
                <HeaderButton icon={<Music className="h-4 w-4" />} />
                <HeaderButton icon={<Settings className="h-4 w-4" />} />
                <HeaderButton icon={<Bell className="h-4 w-4" />} badge />
              </div>
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

function HeaderButton({ icon, badge = false }: { icon: ReactNode; badge?: boolean }) {
  return (
    <button
      type="button"
      className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.06] bg-[#0c1122]/40 text-slate-400 hover:text-white hover:border-white/15 transition-all duration-300 relative shadow-sm hover:scale-105 active:scale-95"
    >
      {icon}
      {badge && (
        <span className="absolute top-1.5 right-1.5 flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-acp-purple opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-acp-purple" />
        </span>
      )}
    </button>
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
          Operational Portal
        </p>
      </div>
    </div>
  );
}

function SideNavItem({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
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

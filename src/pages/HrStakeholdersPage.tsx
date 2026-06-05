import { useState } from "react";
import { Plus, Users, ShieldAlert, Award, FileText, UserCheck, Briefcase } from "lucide-react";
import { cx } from "../utils/cx";

type TeamMember = {
  initials: string;
  name: string;
  role: string;
  accessLevel: string;
  avatarBg: string;
  avatarText: string;
};

type HiringBrief = {
  role: string;
  company: string;
  status: string;
  accentColor: "amber" | "blue" | "green";
};

type ExternalStakeholder = {
  name: string;
  association: string;
  description: string;
  accentColor: "amber" | "blue" | "green";
};

export function HrStakeholdersPage() {
  const [team] = useState<TeamMember[]>([
    {
      initials: "AO",
      name: "Ayo Oyesanya",
      role: "Managing Partner - ACP GP / VDR",
      accessLevel: "FULL ACCESS",
      avatarBg: "bg-blue-600/20 border-blue-500/30 text-blue-400",
      avatarText: "text-blue-400"
    },
    {
      initials: "PM",
      name: "Prince Molo",
      role: "Deal Sourcing - BDM",
      accessLevel: "READ ACCESS",
      avatarBg: "bg-emerald-600/20 border-emerald-500/30 text-emerald-400",
      avatarText: "text-emerald-400"
    },
    {
      initials: "DC",
      name: "David Chilton",
      role: "Finance - Underwriting",
      accessLevel: "FINANCE ACCESS",
      avatarBg: "bg-amber-600/20 border-amber-500/30 text-amber-450",
      avatarText: "text-amber-450"
    },
    {
      initials: "C",
      name: "Claude",
      role: "Deal Ops - Ref: Clear",
      accessLevel: "OPS ACCESS",
      avatarBg: "bg-purple-600/20 border-purple-500/30 text-purple-400",
      avatarText: "text-purple-400"
    },
    {
      initials: "D",
      name: "Deliveree",
      role: "Ops & Data",
      accessLevel: "ASSISTANT",
      avatarBg: "bg-slate-600/20 border-slate-500/30 text-slate-400",
      avatarText: "text-slate-400"
    }
  ]);

  const [hires] = useState<HiringBrief[]>([
    {
      role: "CEO",
      company: "Clear Water Cleaning Services",
      status: "Status: candidates search · First post clear · Target 60 days",
      accentColor: "amber"
    },
    {
      role: "Operations Manager",
      company: "MGL (contingent on close)",
      status: "Status: scoping · Depends on deal outcome",
      accentColor: "blue"
    }
  ]);

  const [stakeholders] = useState<ExternalStakeholder[]>([
    {
      name: "Lee Coutanche",
      association: "Moorfields Commercial Finance",
      description: "Lender · active relationship · on: 4 deals active",
      accentColor: "blue"
    },
    {
      name: "Gillie Edwards",
      association: "KBS Group broker",
      description: "Broker · Deal teaser · 3 referrals active",
      accentColor: "green"
    },
    {
      name: "Navi",
      association: "Marketing contractor",
      description: "Marketing · Website revamp · Current",
      accentColor: "green"
    },
    {
      name: "Torsten Edwards",
      association: "Tech contractor",
      description: "Developer · Portal development · on: all projects",
      accentColor: "amber"
    }
  ]);

  return (
    <div className="space-y-6 text-[#E2E8F0] font-sans">
      {/* Header section with warning badges */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-4">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-white tracking-tight">
            HR & <span className="text-[#C5A059]">Stakeholders</span>
          </h1>
          <p className="text-xs text-slate-550 font-medium">
            5 team members · 2 open hires
          </p>
        </div>
        
        <div className="flex items-center gap-2 select-none">
          <span className="inline-flex items-center rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[9px] font-bold text-amber-500 uppercase tracking-wider">
            2 OVERDUE TASKS
          </span>
          <span className="inline-flex items-center rounded-full bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 text-[9px] font-bold text-blue-450 uppercase tracking-wider">
            3 LIVE DEALS
          </span>
          
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#C5A059] px-3.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-950 shadow-sm hover:bg-[#C5A059]/90 cursor-pointer transition"
          >
            + New Deal
          </button>
        </div>
      </div>

      {/* Main Panels Grid */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* ACP TEAM (Left Column) */}
        <div className="col-span-12 lg:col-span-5 rounded-2xl border border-white/[0.06] bg-[#0E121A] p-5 shadow-premium-card card-sheen">
          <h3 className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-400 border-b border-white/[0.04] pb-3 mb-4 select-none">
            ACP Team
          </h3>
          
          <div className="divide-y divide-white/[0.04]">
            {team.map((member, idx) => (
              <div key={idx} className="flex items-center justify-between py-3.5 first:pt-0 last:pb-0 group">
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className={cx(
                    "flex h-9.5 w-9.5 shrink-0 items-center justify-center rounded-full border text-xs font-black shadow-sm transition-transform duration-300 group-hover:scale-105 select-none",
                    member.avatarBg
                  )}>
                    {member.initials}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-white tracking-wide">
                      {member.name}
                    </p>
                    <p className="truncate text-[10px] font-semibold text-slate-500 mt-0.5">
                      {member.role}
                    </p>
                  </div>
                </div>

                <span className="shrink-0 text-[8px] font-black uppercase tracking-wider text-slate-500 bg-white/[0.03] border border-white/5 rounded px-2 py-0.5 select-none">
                  {member.accessLevel}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column Panels */}
        <div className="col-span-12 lg:col-span-7 space-y-6">
          {/* OPEN HIRING — PORTCO CEO & OPERATORS */}
          <div className="rounded-2xl border border-white/[0.06] bg-[#0E121A] p-5 shadow-premium-card card-sheen">
            <h3 className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-400 border-b border-white/[0.04] pb-3 mb-4 select-none">
              Open Hiring — PortCo CEO & Operators
            </h3>

            <div className="space-y-3.5">
              {hires.map((hire, idx) => (
                <div 
                  key={idx} 
                  className={cx(
                    "rounded-xl border border-white/[0.03] bg-white/[0.01] p-3.5 border-l-4 flex flex-col justify-center",
                    hire.accentColor === "amber" ? "border-l-amber-500/60" :
                    hire.accentColor === "blue" ? "border-l-blue-500/60" : "border-l-emerald-500/60"
                  )}
                >
                  <p className="text-xs font-bold text-white">
                    {hire.role} <span className="text-slate-500 font-semibold">for</span> {hire.company}
                  </p>
                  <p className="text-[10px] font-semibold text-slate-450 mt-1">
                    {hire.status}
                  </p>
                </div>
              ))}

              {/* Add hiring brief button */}
              <button
                className="w-full flex h-10 items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/10 hover:border-white/20 bg-white/[0.01] hover:bg-white/[0.03] text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-300 transition cursor-pointer mt-2"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add hiring brief</span>
              </button>
            </div>
          </div>

          {/* EXTERNAL STAKEHOLDERS */}
          <div className="rounded-2xl border border-white/[0.06] bg-[#0E121A] p-5 shadow-premium-card card-sheen">
            <h3 className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-400 border-b border-white/[0.04] pb-3 mb-4 select-none">
              External Stakeholders
            </h3>

            <div className="grid gap-3.5 sm:grid-cols-2">
              {stakeholders.map((sh, idx) => (
                <div 
                  key={idx} 
                  className={cx(
                    "rounded-xl border border-white/[0.03] bg-white/[0.01] p-3.5 border-l-4 flex flex-col justify-center",
                    sh.accentColor === "amber" ? "border-l-amber-500/60" :
                    sh.accentColor === "blue" ? "border-l-blue-500/60" : "border-l-emerald-500/60"
                  )}
                >
                  <p className="text-xs font-bold text-white">
                    {sh.name} <span className="text-slate-550 font-semibold">on</span> {sh.association}
                  </p>
                  <p className="text-[10px] font-semibold text-slate-450 mt-1 leading-relaxed">
                    {sh.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

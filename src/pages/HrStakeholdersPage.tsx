import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash, X, Loader2, AlertCircle } from "lucide-react";
import { cx } from "../utils/cx";
import { HeaderMetrics } from "../components/ui/HeaderMetrics";
import { fetchHrRegistry, addHiringBrief, deleteHiringBrief } from "../api/admin";
import { Modal } from "../components/ui/Modal";
import { FormField, inputClass, selectClass } from "../components/ui/FormField";

type TeamMember = {
  id?: string;
  initials: string;
  name: string;
  role: string;
  accessLevel: string;
  avatarTheme: string;
};

type HiringBrief = {
  id?: string;
  role: string;
  company: string;
  status: string;
  accentColor: "amber" | "blue" | "green";
};

type ExternalStakeholder = {
  id?: string;
  name: string;
  association: string;
  description: string;
  accentColor: "amber" | "blue" | "green";
};

const themeMap: Record<string, { bg: string; text: string }> = {
  blue: { bg: "bg-blue-600/20 border-blue-500/30 text-blue-400", text: "text-blue-400" },
  green: { bg: "bg-emerald-600/20 border-emerald-500/30 text-emerald-400", text: "text-emerald-400" },
  emerald: { bg: "bg-emerald-600/20 border-emerald-500/30 text-emerald-400", text: "text-emerald-400" },
  amber: { bg: "bg-amber-600/20 border-amber-500/30 text-amber-450", text: "text-amber-450" },
  purple: { bg: "bg-purple-600/20 border-purple-500/30 text-purple-400", text: "text-purple-400" },
  slate: { bg: "bg-slate-600/20 border-slate-500/30 text-slate-400", text: "text-slate-400" },
};

export function HrStakeholdersPage() {
  const navigate = useNavigate();

  const [team, setTeam] = useState<TeamMember[]>([]);
  const [hires, setHires] = useState<HiringBrief[]>([]);
  const [stakeholders, setStakeholders] = useState<ExternalStakeholder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal form states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formRole, setFormRole] = useState("");
  const [formCompany, setFormCompany] = useState("");
  const [formStatus, setFormStatus] = useState("");
  const [formColor, setFormColor] = useState<"amber" | "blue" | "green">("amber");
  const [isSaving, setIsSaving] = useState(false);
  const [modalError, setModalError] = useState<{ title: string; message: string } | null>(null);

  const loadData = async () => {
    try {
      const data = await fetchHrRegistry();
      setTeam(data.team || []);
      setHires(data.hires || []);
      setStakeholders(data.stakeholders || []);
      setError(null);
    } catch (err: any) {
      console.error("Failed to load HR registry:", err);
      setError(err.message || "Failed to retrieve registry records.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSubmitBrief = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formRole.trim() || !formCompany.trim() || !formStatus.trim()) return;

    setIsSaving(true);
    setModalError(null);

    try {
      await addHiringBrief({
        role: formRole.trim(),
        company: formCompany.trim(),
        statusText: formStatus.trim(),
        accentColor: formColor,
      });

      await loadData();
      setIsModalOpen(false);
      // Reset form
      setFormRole("");
      setFormCompany("");
      setFormStatus("");
      setFormColor("amber");
    } catch (err: any) {
      console.error("Failed to save hiring brief:", err);
      
      if (err.message?.includes("Hiring_Briefs") || err.message?.includes("not found") || err.message?.includes("table")) {
        setModalError({
          title: "Airtable Table Missing",
          message: `The 'Hiring_Briefs' table doesn't exist in Airtable yet. We added the record locally for this session. To make it persistent, create the table named 'Hiring_Briefs' in your base.`
        });
        
        // Add locally
        const newBrief: HiringBrief = {
          role: formRole.trim(),
          company: formCompany.trim(),
          status: formStatus.trim(),
          accentColor: formColor
        };
        setHires(prev => [...prev, newBrief]);
        
        setTimeout(() => {
          setIsModalOpen(false);
          setModalError(null);
          // Reset form
          setFormRole("");
          setFormCompany("");
          setFormStatus("");
          setFormColor("amber");
        }, 3000);
      } else {
        setModalError({
          title: "Save Failed",
          message: err.message || "An unexpected error occurred while saving the hiring brief."
        });
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteBrief = async (brief: HiringBrief, idx: number) => {
    if (brief.id) {
      try {
        await deleteHiringBrief(brief.id);
        await loadData();
      } catch (err: any) {
        console.error("Failed to delete hiring brief:", err);
        alert(`Failed to delete hiring brief: ${err.message}`);
      }
    } else {
      setHires(prev => prev.filter((_, i) => i !== idx));
    }
  };

  return (
    <div className="space-y-6 text-[#E2E8F0] font-sans">
      {/* Header section with warning badges */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-4">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-white tracking-tight">
            HR & <span className="text-[#C6A66B]">Stakeholders</span>
          </h1>
          <p className="text-xs text-slate-550 font-medium">
            {isLoading ? (
              <span className="flex items-center gap-1.5 opacity-60">
                <Loader2 className="h-3 w-3 animate-spin text-slate-500" />
                Loading registry...
              </span>
            ) : (
              `${team.length} team members · ${hires.length} open hires`
            )}
          </p>
        </div>
        
        <div className="flex items-center gap-2 select-none">
          <HeaderMetrics />
          
          <button
            onClick={() => navigate("/deals?create=true")}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#C6A66B] px-3.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-950 shadow-sm hover:bg-[#C6A66B]/90 cursor-pointer transition"
          >
            + New Deal
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-xs text-red-400 animate-fade-in">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">Database Sync Warning</p>
            <p className="mt-1 opacity-90 leading-relaxed">{error}</p>
          </div>
        </div>
      )}

      {/* Main Panels Grid */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* ACP TEAM (Left Column) */}
        <div className="col-span-12 lg:col-span-5 rounded-2xl border border-white/[0.02] bg-[#161B22] p-5 shadow-premium-card card-sheen">
          <h3 className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-400 border-b border-white/[0.02] pb-3 mb-4 select-none">
            ACP Team
          </h3>
          
          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-500 text-xs">
              <Loader2 className="h-5 w-5 animate-spin text-[#C6A66B]" />
              <span>Loading team members...</span>
            </div>
          ) : team.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-xs select-none">
              No team members configured.
            </div>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {team.map((member, idx) => {
                const theme = themeMap[member.avatarTheme?.toLowerCase() || ""] || themeMap.blue;
                return (
                  <div key={idx} className="flex items-center justify-between py-3.5 first:pt-0 last:pb-0 group">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className={cx(
                        "flex h-9.5 w-9.5 shrink-0 items-center justify-center rounded-full border text-xs font-black shadow-sm transition-transform duration-300 group-hover:scale-105 select-none",
                        theme.bg
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
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column Panels */}
        <div className="col-span-12 lg:col-span-7 space-y-6">
          {/* OPEN HIRING — PORTCO CEO & OPERATORS */}
          <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-5 shadow-premium-card card-sheen">
            <h3 className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-400 border-b border-white/[0.02] pb-3 mb-4 select-none">
              Open Hiring — PortCo CEO & Operators
            </h3>

            {isLoading ? (
              <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-500 text-xs">
                <Loader2 className="h-5 w-5 animate-spin text-[#C6A66B]" />
                <span>Loading hiring pipelines...</span>
              </div>
            ) : (
              <div className="space-y-3.5">
                {hires.length === 0 ? (
                  <div className="py-6 text-center text-slate-550 text-xs select-none">
                    No active hiring briefs found.
                  </div>
                ) : (
                  hires.map((hire, idx) => (
                    <div 
                      key={idx} 
                      className={cx(
                        "rounded-xl border border-white/[0.02] bg-white/[0.01] p-3.5 border-l-4 flex items-center justify-between group/card transition duration-300 hover:bg-white/[0.02]",
                        hire.accentColor === "amber" ? "border-l-amber-500/60" :
                        hire.accentColor === "blue" ? "border-l-blue-500/60" : "border-l-emerald-500/60"
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-white">
                          {hire.role} <span className="text-slate-550 font-semibold">for</span> {hire.company}
                        </p>
                        <p className="text-[10px] font-semibold text-slate-450 mt-1 leading-normal">
                          {hire.status}
                        </p>
                      </div>

                      <button 
                        onClick={() => handleDeleteBrief(hire, idx)}
                        className="ml-3 shrink-0 opacity-0 group-hover/card:opacity-100 text-slate-500 hover:text-rose-500 transition cursor-pointer p-1.5 rounded hover:bg-white/[0.015]"
                        title="Delete hiring brief"
                      >
                        <Trash className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))
                )}

                {/* Add hiring brief button */}
                <button
                  onClick={() => {
                    setModalError(null);
                    setIsModalOpen(true);
                  }}
                  className="w-full flex h-10 items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/[0.02] hover:border-white/20 bg-white/[0.01] hover:bg-white/[0.03] text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-300 transition cursor-pointer mt-2 animate-fade-in"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add hiring brief</span>
                </button>
              </div>
            )}
          </div>

          {/* EXTERNAL STAKEHOLDERS */}
          <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-5 shadow-premium-card card-sheen">
            <h3 className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-400 border-b border-white/[0.02] pb-3 mb-4 select-none">
              External Stakeholders
            </h3>

            {isLoading ? (
              <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-500 text-xs">
                <Loader2 className="h-5 w-5 animate-spin text-[#C6A66B]" />
                <span>Loading external partners...</span>
              </div>
            ) : stakeholders.length === 0 ? (
              <div className="py-12 text-center text-slate-550 text-xs select-none">
                No external stakeholders recorded.
              </div>
            ) : (
              <div className="grid gap-3.5 sm:grid-cols-2">
                {stakeholders.map((sh, idx) => (
                  <div 
                    key={idx} 
                    className={cx(
                      "rounded-xl border border-white/[0.02] bg-white/[0.01] p-3.5 border-l-4 flex flex-col justify-center transition hover:bg-white/[0.02] duration-300",
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
            )}
          </div>
        </div>
      </div>

      {/* Modal Dialog */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Add Hiring Brief">
        {modalError && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-[11px] text-red-400 animate-fade-in">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-bold">{modalError.title}</p>
              <p className="font-medium opacity-90 leading-relaxed">{modalError.message}</p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmitBrief} className="space-y-4">
          <FormField label="Role / Position" required id="hr-brief-role">
            <input
              id="hr-brief-role"
              type="text"
              required
              value={formRole}
              onChange={(e) => setFormRole(e.target.value)}
              placeholder="e.g. CEO, Operations Manager"
              className={inputClass}
            />
          </FormField>

          <FormField label="Company / Portfolio Target" required id="hr-brief-company">
            <input
              id="hr-brief-company"
              type="text"
              required
              value={formCompany}
              onChange={(e) => setFormCompany(e.target.value)}
              placeholder="e.g. Clear Water Cleaning Services"
              className={inputClass}
            />
          </FormField>

          <FormField label="Recruitment Status Description" required id="hr-brief-status">
            <input
              id="hr-brief-status"
              type="text"
              required
              value={formStatus}
              onChange={(e) => setFormStatus(e.target.value)}
              placeholder="e.g. Status: candidates search · First post clear"
              className={inputClass}
            />
          </FormField>

          <FormField label="Accent Color Label" id="hr-brief-color">
            <select
              id="hr-brief-color"
              value={formColor}
              onChange={(e) => setFormColor(e.target.value as "amber" | "blue" | "green")}
              className={selectClass}
            >
              <option value="amber">Amber (Recruiting)</option>
              <option value="blue">Blue (Scoping/Contingent)</option>
              <option value="green">Green (Active/Filled)</option>
            </select>
          </FormField>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/5 mt-5">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="h-9 rounded-lg border border-white/[0.02] bg-transparent px-4 text-[10px] font-extrabold uppercase tracking-wider text-slate-400 hover:text-white transition cursor-pointer"
            >
              Cancel
            </button>
            
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[#C6A66B] px-4 text-[10px] font-extrabold uppercase tracking-wider text-slate-950 shadow-sm hover:bg-[#C6A66B]/90 disabled:opacity-50 cursor-pointer transition"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <span>Add Brief</span>
              )}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

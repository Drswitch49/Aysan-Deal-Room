import { useState, useEffect, useMemo } from "react";
import { Plus, Search, Building, AlertTriangle, Edit } from "lucide-react";
import { StakeholderForm } from "../components/stakeholders/StakeholderForm";
import { Modal } from "../components/ui/Modal";
import { LoadingState } from "../components/ui/LoadingState";
import { cx } from "../utils/cx";
import type { ExternalStakeholder, CreateExternalStakeholderInput } from "../types/entities";

export function StakeholderManagementPage() {
  const [stakeholders, setStakeholders] = useState<ExternalStakeholder[]>([]);
  const [isFetching, setIsFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<string>("All");

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStakeholder, setEditingStakeholder] = useState<ExternalStakeholder | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const fetchStakeholders = async () => {
    setIsFetching(true);
    setError(null);
    try {
      const response = await fetch("/api/stakeholders-crud");
      if (!response.ok) {
        throw new Error("Failed to load stakeholders");
      }
      const data = await response.json();
      setStakeholders(data);
    } catch (err: any) {
      setError(err.message || "Failed to load data");
    } finally {
      setIsFetching(false);
    }
  };

  useEffect(() => {
    fetchStakeholders();
  }, []);

  const handleOpenCreate = () => {
    setEditingStakeholder(null);
    setSaveError(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (stakeholder: ExternalStakeholder) => {
    setEditingStakeholder(stakeholder);
    setSaveError(null);
    setIsModalOpen(true);
  };

  const handleSubmit = async (data: CreateExternalStakeholderInput) => {
    setIsSaving(true);
    setSaveError(null);
    try {
      let url = "/api/stakeholders-crud";
      let method = "POST";
      if (editingStakeholder) {
        url = `/api/stakeholders-crud?id=${editingStakeholder.id}`;
        method = "PATCH";
      }

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to save stakeholder");
      }

      await fetchStakeholders();
      setIsModalOpen(false);
    } catch (err: any) {
      setSaveError(err.message || "An error occurred");
    } finally {
      setIsSaving(false);
    }
  };

  const filteredStakeholders = useMemo(() => {
    return stakeholders.filter((s) => {
      if (filterType !== "All" && s.type !== filterType) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          s.name.toLowerCase().includes(q) ||
          (s.organization && s.organization.toLowerCase().includes(q)) ||
          (s.email && s.email.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [stakeholders, filterType, searchQuery]);

  return (
    <div className="space-y-6 text-[#E2E8F0] font-sans animate-fade-in-up">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/[0.02] pb-5">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-white tracking-tight">External Stakeholders</h1>
          <p className="text-xs text-slate-500 font-medium">Manage advisors, lawyers, brokers, and other external contacts.</p>
        </div>
        <button
          onClick={handleOpenCreate}
          className="inline-flex h-9 items-center gap-2 rounded-xl bg-gradient-to-r from-acp-bronze to-acp-bronze-dark px-4 text-xs font-bold uppercase tracking-wider text-white hover:shadow-glow-bronze transition cursor-pointer"
        >
          <Plus className="h-4 w-4" /> Add Stakeholder
        </button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex gap-2 text-[10px] font-bold tracking-wide flex-wrap">
          {["All", "Advisor", "Lawyer", "Broker", "Consultant", "Investor", "Portfolio Contact"].map((type) => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={cx(
                "px-3.5 py-1.5 rounded-full border transition cursor-pointer",
                filterType === type
                  ? "border-[#C6A66B] bg-[#C6A66B]/5 text-[#C6A66B]"
                  : "border-white/[0.02] bg-white/[0.01] text-slate-400 hover:text-white hover:bg-white/[0.03]"
              )}
            >
              {type}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search stakeholders..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 w-48 rounded-xl border border-white/[0.02] bg-[#0B0B0C] pl-9 pr-3 text-xs text-white placeholder-slate-500 outline-none transition focus:border-[#C6A66B] focus:w-56 shadow-inner"
          />
        </div>
      </div>

      {isFetching ? (
        <LoadingState variant="table" label="Loading stakeholders..." />
      ) : error ? (
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-6 text-center text-xs font-semibold text-rose-400">
          {error}
        </div>
      ) : (
        <div className="rounded-2xl border border-white/[0.02] bg-white/[0.01] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/[0.02] text-slate-400">
                  <th className="px-5 py-4 text-[10px] font-bold tracking-wide uppercase">Name & Org</th>
                  <th className="px-4 py-4 text-[10px] font-bold tracking-wide uppercase">Type</th>
                  <th className="px-4 py-4 text-[10px] font-bold tracking-wide uppercase">Contact Info</th>
                  <th className="w-16 px-4 py-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filteredStakeholders.map((stakeholder) => (
                  <tr key={stakeholder.id} className="hover:bg-white/[0.01] transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.03] border border-white/[0.05]">
                          <Building className="h-4 w-4 text-[#C6A66B]" />
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-white">{stakeholder.name}</p>
                          <p className="mt-0.5 text-[10px] text-slate-500">{stakeholder.organization || "No Org"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-normal border bg-slate-500/10 text-slate-400 border-slate-500/20">
                        {stakeholder.type}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="text-xs font-medium text-slate-300">{stakeholder.email || "—"}</div>
                      <div className="text-[10px] text-slate-500">{stakeholder.phone || ""}</div>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <button
                        onClick={() => handleOpenEdit(stakeholder)}
                        className="p-1.5 text-slate-500 hover:text-[#C6A66B] hover:bg-white/[0.05] rounded-lg transition"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredStakeholders.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-xs font-bold text-slate-500">
                      No stakeholders found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingStakeholder ? "Edit Stakeholder" : "Add Stakeholder"}
        maxWidth="max-w-xl"
      >
        {saveError && (
          <div className="mb-4 rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-xs font-semibold text-rose-400 flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5" />
            {saveError}
          </div>
        )}
        <StakeholderForm
          initialData={editingStakeholder || undefined}
          onSubmit={handleSubmit}
          isLoading={isSaving}
        />
      </Modal>
    </div>
  );
}

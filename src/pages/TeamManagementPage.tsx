import { useState, useEffect, useMemo } from "react";
import { Plus, Search, Users, AlertTriangle, Edit } from "lucide-react";
import { TeamMemberForm } from "../components/team/TeamMemberForm";
import { Modal } from "../components/ui/Modal";
import { LoadingState } from "../components/ui/LoadingState";
import { cx } from "../utils/cx";
import type { TeamMember, CreateTeamMemberInput } from "../types/entities";

export function TeamManagementPage() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [isFetching, setIsFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [searchQuery, setSearchQuery] = useState("");
  const [filterRole, setFilterRole] = useState<string>("All");

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const fetchMembers = async () => {
    setIsFetching(true);
    setError(null);
    try {
      const response = await fetch("/api/team-members-crud");
      if (!response.ok) {
        throw new Error("Failed to load team members");
      }
      const data = await response.json();
      setMembers(data);
    } catch (err: any) {
      setError(err.message || "Failed to load data");
    } finally {
      setIsFetching(false);
    }
  };

  useEffect(() => {
    fetchMembers();
  }, []);

  const handleOpenCreate = () => {
    setEditingMember(null);
    setSaveError(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (member: TeamMember) => {
    setEditingMember(member);
    setSaveError(null);
    setIsModalOpen(true);
  };

  const handleSubmit = async (data: CreateTeamMemberInput) => {
    setIsSaving(true);
    setSaveError(null);
    try {
      let url = "/api/team-members-crud";
      let method = "POST";
      if (editingMember) {
        url = `/api/team-members-crud?id=${editingMember.id}`;
        method = "PATCH";
      }

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to save team member");
      }

      await fetchMembers();
      setIsModalOpen(false);
    } catch (err: any) {
      setSaveError(err.message || "An error occurred");
    } finally {
      setIsSaving(false);
    }
  };

  const filteredMembers = useMemo(() => {
    return members.filter((m) => {
      if (filterRole !== "All" && m.role !== filterRole) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          m.name.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q) ||
          (m.phone && m.phone.includes(q))
        );
      }
      return true;
    });
  }, [members, filterRole, searchQuery]);

  return (
    <div className="space-y-6 text-[#E2E8F0] font-sans animate-fade-in-up">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/[0.02] pb-5">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-white tracking-tight">Team Management</h1>
          <p className="text-xs text-slate-500 font-medium">Manage user access, roles, and status for the ACP team.</p>
        </div>
        <button
          onClick={handleOpenCreate}
          className="inline-flex h-9 items-center gap-2 rounded-xl bg-gradient-to-r from-acp-bronze to-acp-bronze-dark px-4 text-xs font-bold uppercase tracking-wider text-white hover:shadow-glow-bronze transition cursor-pointer"
        >
          <Plus className="h-4 w-4" /> Add Team Member
        </button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex gap-2 text-[10px] font-bold tracking-wide flex-wrap">
          {["All", "Managing Partner", "Partner", "Analyst", "Admin", "HR", "Read Only"].map((role) => (
            <button
              key={role}
              onClick={() => setFilterRole(role)}
              className={cx(
                "px-3.5 py-1.5 rounded-full border transition cursor-pointer",
                filterRole === role
                  ? "border-[#C6A66B] bg-[#C6A66B]/5 text-[#C6A66B]"
                  : "border-white/[0.02] bg-white/[0.01] text-slate-400 hover:text-white hover:bg-white/[0.03]"
              )}
            >
              {role}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search team..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 w-48 rounded-xl border border-white/[0.02] bg-[#0B0B0C] pl-9 pr-3 text-xs text-white placeholder-slate-500 outline-none transition focus:border-[#C6A66B] focus:w-56 shadow-inner"
          />
        </div>
      </div>

      {isFetching ? (
        <LoadingState variant="table" label="Loading team members..." />
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
                  <th className="px-5 py-4 text-[10px] font-bold tracking-wide uppercase">Member</th>
                  <th className="px-4 py-4 text-[10px] font-bold tracking-wide uppercase">Role</th>
                  <th className="px-4 py-4 text-[10px] font-bold tracking-wide uppercase">Status</th>
                  <th className="w-16 px-4 py-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filteredMembers.map((member) => (
                  <tr key={member.id} className="hover:bg-white/[0.01] transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-800 to-slate-900 border border-white/[0.05] shadow-inner">
                          <span className="text-[10px] font-bold text-white tracking-wider">
                            {member.name.split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-white">{member.name}</p>
                          <p className="mt-0.5 text-[10px] text-slate-500">{member.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-xs font-medium text-slate-300">{member.role}</td>
                    <td className="px-4 py-4">
                      <span className={cx(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-normal border",
                        member.status === "Active" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                        "bg-slate-500/10 text-slate-400 border-slate-500/20"
                      )}>
                        {member.status}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <button
                        onClick={() => handleOpenEdit(member)}
                        className="p-1.5 text-slate-500 hover:text-[#C6A66B] hover:bg-white/[0.05] rounded-lg transition"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredMembers.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-xs font-bold text-slate-500">
                      No team members found.
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
        title={editingMember ? "Edit Team Member" : "Add Team Member"}
        maxWidth="max-w-xl"
      >
        {saveError && (
          <div className="mb-4 rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-xs font-semibold text-rose-400 flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5" />
            {saveError}
          </div>
        )}
        <TeamMemberForm
          initialData={editingMember || undefined}
          onSubmit={handleSubmit}
          isLoading={isSaving}
        />
      </Modal>
    </div>
  );
}

import React, { useState, useEffect } from "react";
import { TeamMemberForm } from "../components/team/TeamMemberForm";
import type { TeamMember, CreateTeamMemberInput } from "../types/entities";
import { Plus, Edit2, Power } from "lucide-react";

export function TeamManagementPage() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    loadMembers();
  }, []);

  const loadMembers = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/team-members-crud", {
        headers: {
          "Authorization": `Bearer ${localStorage.getItem("authToken") || ""}`
        }
      });

      if (!response.ok) throw new Error("Failed to load team members");
      const data = await response.json();
      setMembers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (formData: CreateTeamMemberInput) => {
    try {
      const method = editingId ? "PATCH" : "POST";
      const url = editingId ? `/api/team-members-crud?id=${editingId}` : "/api/team-members-crud";

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("authToken") || ""}`
        },
        body: JSON.stringify(formData)
      });

      if (!response.ok) throw new Error("Failed to save team member");
      
      setShowForm(false);
      setEditingId(null);
      await loadMembers();
    } catch (err) {
      throw err;
    }
  };

  const handleToggleStatus = async (memberId: string, currentStatus: string) => {
    const newStatus = currentStatus === "Active" ? "Inactive" : "Active";
    
    try {
      const response = await fetch(`/api/team-members-crud?id=${memberId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("authToken") || ""}`
        },
        body: JSON.stringify({ status: newStatus })
      });

      if (!response.ok) throw new Error("Failed to update status");
      await loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    }
  };

  if (showForm) {
    const editingMember = editingId ? members.find(m => m.id === editingId) : undefined;
    return (
      <div className="min-h-screen bg-slate-900">
        <div className="max-w-4xl mx-auto px-4 py-12">
          <div className="mb-12">
            <button
              onClick={() => { setShowForm(false); setEditingId(null); }}
              className="text-sm text-blue-400 hover:text-blue-300 mb-4"
            >
              ← Back to Team
            </button>
            <h1 className="text-4xl font-bold text-white">
              {editingId ? "Edit Team Member" : "Add Team Member"}
            </h1>
          </div>

          <TeamMemberForm
            onSubmit={handleSubmit}
            onCancel={() => { setShowForm(false); setEditingId(null); }}
            initialData={editingMember}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900">
      <div className="max-w-6xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="flex items-center justify-between mb-12">
          <div>
            <h1 className="text-4xl font-bold text-white">Team Management</h1>
            <p className="text-slate-400 mt-2">Manage ACP team members and access levels</p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            <Plus size={20} />
            Add Member
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 rounded-lg bg-red-500/10 border border-red-500/20 p-4">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="text-center py-12">
            <p className="text-slate-400">Loading team members...</p>
          </div>
        )}

        {/* Team List */}
        {!isLoading && members.length === 0 && (
          <div className="text-center py-12">
            <p className="text-slate-400">No team members found</p>
          </div>
        )}

        {!isLoading && members.length > 0 && (
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-800/50">
                  <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300">Name</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300">Email</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300">Role</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300">Status</th>
                  <th className="px-6 py-4 text-right text-sm font-semibold text-slate-300">Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.map(member => (
                  <tr key={member.id} className="border-b border-slate-700 hover:bg-slate-700/30">
                    <td className="px-6 py-4">
                      <p className="text-white font-medium">{member.name}</p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-slate-300 text-sm">{member.email}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-block px-3 py-1 bg-blue-500/20 text-blue-300 rounded-full text-sm">
                        {member.role}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-block px-3 py-1 rounded-full text-sm ${
                        member.status === "Active"
                          ? "bg-green-500/20 text-green-300"
                          : "bg-red-500/20 text-red-300"
                      }`}>
                        {member.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => {
                            setEditingId(member.id);
                            setShowForm(true);
                          }}
                          className="p-2 bg-slate-700 hover:bg-slate-600 text-white rounded transition-colors"
                          title="Edit"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => handleToggleStatus(member.id, member.status)}
                          className={`p-2 rounded transition-colors ${
                            member.status === "Active"
                              ? "bg-slate-700 hover:bg-red-600 text-white"
                              : "bg-slate-700 hover:bg-green-600 text-white"
                          }`}
                          title={member.status === "Active" ? "Deactivate" : "Activate"}
                        >
                          <Power size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

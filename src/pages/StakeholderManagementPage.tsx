import React, { useState, useEffect } from "react";
import { StakeholderForm } from "../components/stakeholders/StakeholderForm";
import type { ExternalStakeholder, CreateExternalStakeholderInput } from "../types/entities";
import { Plus, Edit2, Archive } from "lucide-react";

export function StakeholderManagementPage() {
  const [stakeholders, setStakeholders] = useState<ExternalStakeholder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  const STAKEHOLDER_TYPES = ["Advisor", "Lawyer", "Broker", "Consultant", "Investor", "Portfolio Contact"];

  useEffect(() => {
    loadStakeholders();
  }, [typeFilter]);

  const loadStakeholders = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const url = typeFilter 
        ? `/api/stakeholders-crud?type=${typeFilter}`
        : "/api/stakeholders-crud";
      
      const response = await fetch(url, {
        headers: {
          "Authorization": `Bearer ${localStorage.getItem("authToken") || ""}`
        }
      });

      if (!response.ok) throw new Error("Failed to load stakeholders");
      const data = await response.json();
      setStakeholders(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (formData: CreateExternalStakeholderInput) => {
    try {
      const method = editingId ? "PATCH" : "POST";
      const url = editingId ? `/api/stakeholders-crud?id=${editingId}` : "/api/stakeholders-crud";

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("authToken") || ""}`
        },
        body: JSON.stringify(formData)
      });

      if (!response.ok) throw new Error("Failed to save stakeholder");
      
      setShowForm(false);
      setEditingId(null);
      await loadStakeholders();
    } catch (err) {
      throw err;
    }
  };

  const handleArchive = async (stakeholderId: string) => {
    if (!confirm("Archive this stakeholder?")) return;

    try {
      const response = await fetch(`/api/stakeholders-crud?id=${stakeholderId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("authToken") || ""}`
        },
        body: JSON.stringify({ status: "Archived" })
      });

      if (!response.ok) throw new Error("Failed to archive stakeholder");
      await loadStakeholders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to archive stakeholder");
    }
  };

  if (showForm) {
    const editingStakeholder = editingId ? stakeholders.find(s => s.id === editingId) : undefined;
    return (
      <div className="min-h-screen bg-slate-900">
        <div className="max-w-4xl mx-auto px-4 py-12">
          <div className="mb-12">
            <button
              onClick={() => { setShowForm(false); setEditingId(null); }}
              className="text-sm text-blue-400 hover:text-blue-300 mb-4"
            >
              ← Back to Stakeholders
            </button>
            <h1 className="text-4xl font-bold text-white">
              {editingId ? "Edit Stakeholder" : "Add Stakeholder"}
            </h1>
          </div>

          <StakeholderForm
            onSubmit={handleSubmit}
            onCancel={() => { setShowForm(false); setEditingId(null); }}
            initialData={editingStakeholder}
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
            <h1 className="text-4xl font-bold text-white">Stakeholder Management</h1>
            <p className="text-slate-400 mt-2">Manage advisors, lawyers, brokers, and other stakeholders</p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            <Plus size={20} />
            Add Stakeholder
          </button>
        </div>

        {/* Type Filter */}
        <div className="mb-8 flex flex-wrap gap-2">
          <button
            onClick={() => setTypeFilter(null)}
            className={`px-4 py-2 rounded-lg transition-colors ${
              typeFilter === null
                ? "bg-blue-600 text-white"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            All
          </button>
          {STAKEHOLDER_TYPES.map(type => (
            <button
              key={type}
              onClick={() => setTypeFilter(type)}
              className={`px-4 py-2 rounded-lg transition-colors ${
                typeFilter === type
                  ? "bg-blue-600 text-white"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              {type}
            </button>
          ))}
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
            <p className="text-slate-400">Loading stakeholders...</p>
          </div>
        )}

        {/* Stakeholders List */}
        {!isLoading && stakeholders.length === 0 && (
          <div className="text-center py-12">
            <p className="text-slate-400">No stakeholders found</p>
          </div>
        )}

        {!isLoading && stakeholders.length > 0 && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {stakeholders.map(stakeholder => (
              <div key={stakeholder.id} className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-white">{stakeholder.name}</h3>
                    <p className="text-sm text-blue-400">{stakeholder.type}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setEditingId(stakeholder.id);
                        setShowForm(true);
                      }}
                      className="p-2 bg-slate-700 hover:bg-slate-600 text-white rounded transition-colors"
                    >
                      <Edit2 size={16} />
                    </button>
                    {stakeholder.status !== "Archived" && (
                      <button
                        onClick={() => handleArchive(stakeholder.id)}
                        className="p-2 bg-slate-700 hover:bg-red-600 text-white rounded transition-colors"
                      >
                        <Archive size={16} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-2 text-sm">
                  {stakeholder.email && (
                    <div>
                      <p className="text-slate-400">Email</p>
                      <a href={`mailto:${stakeholder.email}`} className="text-blue-400 hover:text-blue-300">
                        {stakeholder.email}
                      </a>
                    </div>
                  )}
                  {stakeholder.phone && (
                    <div>
                      <p className="text-slate-400">Phone</p>
                      <p className="text-white">{stakeholder.phone}</p>
                    </div>
                  )}
                  {stakeholder.organization && (
                    <div>
                      <p className="text-slate-400">Organization</p>
                      <p className="text-white">{stakeholder.organization}</p>
                    </div>
                  )}
                </div>

                {stakeholder.notes && (
                  <div className="mt-4 pt-4 border-t border-slate-700">
                    <p className="text-sm text-slate-300 line-clamp-2">{stakeholder.notes}</p>
                  </div>
                )}

                <div className="mt-4 flex items-center justify-between">
                  <span className={`inline-block px-2 py-1 rounded text-xs ${
                    stakeholder.status === "Active"
                      ? "bg-green-500/20 text-green-300"
                      : "bg-slate-600 text-slate-300"
                  }`}>
                    {stakeholder.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

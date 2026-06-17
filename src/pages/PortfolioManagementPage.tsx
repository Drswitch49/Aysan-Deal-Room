import React, { useState, useEffect } from "react";
import { PortfolioCompanyForm } from "../components/portfolio/PortfolioCompanyForm";
import type { PortfolioCompany, CreatePortfolioCompanyInput } from "../types/entities";
import { Plus, Edit2, Archive } from "lucide-react";

export function PortfolioManagementPage() {
  const [companies, setCompanies] = useState<PortfolioCompany[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"Active" | "All">("Active");

  useEffect(() => {
    loadCompanies();
  }, [filter]);

  const loadCompanies = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const url = filter === "Active" 
        ? "/api/portfolio-companies-crud?status=Active"
        : "/api/portfolio-companies-crud";
      
      const response = await fetch(url, {
        headers: {
          "Authorization": `Bearer ${localStorage.getItem("authToken") || ""}`
        }
      });

      if (!response.ok) throw new Error("Failed to load companies");
      const data = await response.json();
      setCompanies(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (formData: CreatePortfolioCompanyInput) => {
    try {
      const method = editingId ? "PATCH" : "POST";
      const url = editingId ? `/api/portfolio-companies-crud?id=${editingId}` : "/api/portfolio-companies-crud";

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("authToken") || ""}`
        },
        body: JSON.stringify(formData)
      });

      if (!response.ok) throw new Error("Failed to save company");
      
      setShowForm(false);
      setEditingId(null);
      await loadCompanies();
    } catch (err) {
      throw err;
    }
  };

  const handleArchive = async (companyId: string) => {
    if (!confirm("Archive this company?")) return;

    try {
      const response = await fetch(`/api/portfolio-companies-crud?id=${companyId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("authToken") || ""}`
        },
        body: JSON.stringify({ status: "Archived" })
      });

      if (!response.ok) throw new Error("Failed to archive company");
      await loadCompanies();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to archive company");
    }
  };

  if (showForm) {
    const editingCompany = editingId ? companies.find(c => c.id === editingId) : undefined;
    return (
      <div className="min-h-screen bg-slate-900">
        <div className="max-w-4xl mx-auto px-4 py-12">
          <div className="mb-12">
            <button
              onClick={() => { setShowForm(false); setEditingId(null); }}
              className="text-sm text-blue-400 hover:text-blue-300 mb-4"
            >
              ← Back to Portfolio
            </button>
            <h1 className="text-4xl font-bold text-white">
              {editingId ? "Edit Portfolio Company" : "Add Portfolio Company"}
            </h1>
          </div>

          <PortfolioCompanyForm
            onSubmit={handleSubmit}
            onCancel={() => { setShowForm(false); setEditingId(null); }}
            initialData={editingCompany}
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
            <h1 className="text-4xl font-bold text-white">Portfolio Companies</h1>
            <p className="text-slate-400 mt-2">Manage your portfolio of active companies</p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            <Plus size={20} />
            Add Company
          </button>
        </div>

        {/* Filter */}
        <div className="mb-8 flex gap-4">
          <button
            onClick={() => setFilter("Active")}
            className={`px-4 py-2 rounded-lg transition-colors ${
              filter === "Active"
                ? "bg-blue-600 text-white"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            Active
          </button>
          <button
            onClick={() => setFilter("All")}
            className={`px-4 py-2 rounded-lg transition-colors ${
              filter === "All"
                ? "bg-blue-600 text-white"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            All
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
            <p className="text-slate-400">Loading companies...</p>
          </div>
        )}

        {/* Companies List */}
        {!isLoading && companies.length === 0 && (
          <div className="text-center py-12">
            <p className="text-slate-400">No portfolio companies found</p>
          </div>
        )}

        {!isLoading && companies.length > 0 && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {companies.map(company => (
              <div key={company.id} className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-white">{company.companyName}</h3>
                    <p className="text-sm text-slate-400">{company.industry}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setEditingId(company.id);
                        setShowForm(true);
                      }}
                      className="p-2 bg-slate-700 hover:bg-slate-600 text-white rounded transition-colors"
                    >
                      <Edit2 size={16} />
                    </button>
                    {company.status !== "Archived" && (
                      <button
                        onClick={() => handleArchive(company.id)}
                        className="p-2 bg-slate-700 hover:bg-red-600 text-white rounded transition-colors"
                      >
                        <Archive size={16} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-slate-400">Revenue</p>
                    <p className="text-white font-medium">${company.revenue}M</p>
                  </div>
                  <div>
                    <p className="text-slate-400">EBITDA</p>
                    <p className="text-white font-medium">${company.ebitda}M</p>
                  </div>
                  <div>
                    <p className="text-slate-400">Location</p>
                    <p className="text-white">{company.location}</p>
                  </div>
                  <div>
                    <p className="text-slate-400">Status</p>
                    <p className="text-white">{company.status}</p>
                  </div>
                </div>

                {company.notes && (
                  <div className="mt-4 pt-4 border-t border-slate-700">
                    <p className="text-sm text-slate-300 line-clamp-2">{company.notes}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

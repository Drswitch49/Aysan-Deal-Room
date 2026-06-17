import React, { useState } from "react";
import type { CreatePortfolioCompanyInput } from "../types/entities";

interface PortfolioCompanyFormProps {
  onSubmit: (company: CreatePortfolioCompanyInput) => Promise<void>;
  onCancel: () => void;
  initialData?: Partial<CreatePortfolioCompanyInput>;
  isLoading?: boolean;
}

const COMPANY_STATUSES = ["Active", "In Transition", "Exited", "Archived"];

export function PortfolioCompanyForm({ onSubmit, onCancel, initialData, isLoading }: PortfolioCompanyFormProps) {
  const [formData, setFormData] = useState<CreatePortfolioCompanyInput>({
    companyName: initialData?.companyName || "",
    industry: initialData?.industry || "",
    revenue: initialData?.revenue || undefined,
    ebitda: initialData?.ebitda || undefined,
    debt: initialData?.debt || undefined,
    headcount: initialData?.headcount || undefined,
    status: initialData?.status || "Active",
    location: initialData?.location || "",
    notes: initialData?.notes || ""
  });

  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === "number" ? (value ? parseFloat(value) : undefined) : value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!formData.companyName || !formData.industry || !formData.location || !formData.status) {
      setError("Please fill in all required fields");
      return;
    }

    try {
      await onSubmit(formData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save company");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-4">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Company Information */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-8">
        <h3 className="text-lg font-semibold text-white mb-6">Company Information</h3>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Company Name *
            </label>
            <input
              type="text"
              name="companyName"
              value={formData.companyName}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
              placeholder="Enter company name"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Industry *
            </label>
            <input
              type="text"
              name="industry"
              value={formData.industry}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
              placeholder="e.g., Technology, Manufacturing"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Location *
            </label>
            <input
              type="text"
              name="location"
              value={formData.location}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
              placeholder="Enter location"
              required
            />
          </div>
        </div>
      </div>

      {/* Financial Information */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-8">
        <h3 className="text-lg font-semibold text-white mb-6">Financial Information</h3>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Revenue ($ millions)
            </label>
            <input
              type="number"
              name="revenue"
              value={formData.revenue || ""}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
              placeholder="0.00"
              step="0.01"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              EBITDA ($ millions)
            </label>
            <input
              type="number"
              name="ebitda"
              value={formData.ebitda || ""}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
              placeholder="0.00"
              step="0.01"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Debt ($ millions)
            </label>
            <input
              type="number"
              name="debt"
              value={formData.debt || ""}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
              placeholder="0.00"
              step="0.01"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Headcount
            </label>
            <input
              type="number"
              name="headcount"
              value={formData.headcount || ""}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
              placeholder="0"
            />
          </div>
        </div>
      </div>

      {/* Status */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-8">
        <h3 className="text-lg font-semibold text-white mb-6">Status</h3>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Status *
          </label>
          <select
            name="status"
            value={formData.status}
            onChange={handleChange}
            className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
          >
            {COMPANY_STATUSES.map(status => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Notes */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-8">
        <h3 className="text-lg font-semibold text-white mb-6">Notes</h3>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Internal Notes
          </label>
          <textarea
            name="notes"
            value={formData.notes || ""}
            onChange={handleChange}
            rows={6}
            className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
            placeholder="Add any notes about this portfolio company..."
          />
        </div>
      </div>

      {/* Form Actions */}
      <div className="flex gap-4 justify-end pt-8 border-t border-slate-700">
        <button
          type="button"
          onClick={onCancel}
          className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
          disabled={isLoading}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
          disabled={isLoading}
        >
          {isLoading ? "Saving..." : "Save Company"}
        </button>
      </div>
    </form>
  );
}

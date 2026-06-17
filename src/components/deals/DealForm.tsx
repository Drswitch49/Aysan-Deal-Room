import React, { useState } from "react";
import type { CreateDealInput } from "../../types/entities";

interface DealFormProps {
  onSubmit: (deal: CreateDealInput) => Promise<void>;
  onCancel: () => void;
  initialData?: Partial<CreateDealInput>;
  isLoading?: boolean;
}

const DEAL_STAGES = ["Inbound", "Seller Call", "IM Review", "Due Diligence", "LOI", "Under Offer", "Closed", "Archived"];

export function DealForm({ onSubmit, onCancel, initialData, isLoading }: DealFormProps) {
  const [formData, setFormData] = useState<CreateDealInput>({
    companyName: initialData?.companyName || "",
    projectName: initialData?.projectName || "",
    industry: initialData?.industry || "",
    website: initialData?.website || "",
    location: initialData?.location || "",
    owner: initialData?.owner || "",
    analyst: initialData?.analyst || "",
    source: initialData?.source || "",
    revenue: initialData?.revenue || undefined,
    ebitda: initialData?.ebitda || undefined,
    enterpriseValue: initialData?.enterpriseValue || undefined,
    askingPrice: initialData?.askingPrice || undefined,
    stage: initialData?.stage || "Inbound",
    nextAction: initialData?.nextAction || "",
    dueDate: initialData?.dueDate || "",
    internalNotes: initialData?.internalNotes || ""
  });

  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setFormData((prev: CreateDealInput) => ({
      ...prev,
      [name]: type === "number" ? (value ? parseFloat(value) : undefined) : value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate required fields
    if (!formData.companyName || !formData.projectName || !formData.industry || !formData.location || !formData.owner || !formData.analyst || !formData.source) {
      setError("Please fill in all required fields");
      return;
    }

    try {
      await onSubmit(formData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save deal");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-4">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Company Information Section */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-8">
        <h3 className="text-lg font-semibold text-white mb-6">Company Information</h3>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
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
              Project Name *
            </label>
            <input
              type="text"
              name="projectName"
              value={formData.projectName}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
              placeholder="Enter project name"
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
              Website
            </label>
            <input
              type="url"
              name="website"
              value={formData.website || ""}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
              placeholder="https://example.com"
            />
          </div>

          <div className="md:col-span-2">
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

      {/* Ownership Section */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-8">
        <h3 className="text-lg font-semibold text-white mb-6">Ownership</h3>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Owner *
            </label>
            <input
              type="text"
              name="owner"
              value={formData.owner}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
              placeholder="Enter owner name"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Analyst *
            </label>
            <input
              type="text"
              name="analyst"
              value={formData.analyst}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
              placeholder="Enter analyst name"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Source *
            </label>
            <input
              type="text"
              name="source"
              value={formData.source}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
              placeholder="e.g., Broker, Inbound"
              required
            />
          </div>
        </div>
      </div>

      {/* Financials Section */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-8">
        <h3 className="text-lg font-semibold text-white mb-6">Financials</h3>
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
              Enterprise Value ($ millions)
            </label>
            <input
              type="number"
              name="enterpriseValue"
              value={formData.enterpriseValue || ""}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
              placeholder="0.00"
              step="0.01"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Asking Price ($ millions)
            </label>
            <input
              type="number"
              name="askingPrice"
              value={formData.askingPrice || ""}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
              placeholder="0.00"
              step="0.01"
            />
          </div>
        </div>
      </div>

      {/* Workflow Section */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-8">
        <h3 className="text-lg font-semibold text-white mb-6">Workflow</h3>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Stage
            </label>
            <select
              name="stage"
              value={formData.stage}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
            >
              {DEAL_STAGES.map(stage => (
                <option key={stage} value={stage}>{stage}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Due Date
            </label>
            <input
              type="date"
              name="dueDate"
              value={formData.dueDate || ""}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Next Action
            </label>
            <input
              type="text"
              name="nextAction"
              value={formData.nextAction || ""}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
              placeholder="What's the next step?"
            />
          </div>
        </div>
      </div>

      {/* Notes Section */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-8">
        <h3 className="text-lg font-semibold text-white mb-6">Notes</h3>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Internal Notes
          </label>
          <textarea
            name="internalNotes"
            value={formData.internalNotes || ""}
            onChange={handleChange}
            rows={6}
            className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
            placeholder="Add any internal notes or observations..."
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
          {isLoading ? "Saving..." : "Create Deal"}
        </button>
      </div>
    </form>
  );
}

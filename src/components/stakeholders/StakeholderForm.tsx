import React, { useState } from "react";
import type { CreateExternalStakeholderInput, StakeholderType } from "../../types/entities";

interface StakeholderFormProps {
  onSubmit: (stakeholder: CreateExternalStakeholderInput) => Promise<void>;
  onCancel: () => void;
  initialData?: Partial<CreateExternalStakeholderInput>;
  isLoading?: boolean;
}

const STAKEHOLDER_TYPES: StakeholderType[] = ["Advisor", "Lawyer", "Broker", "Consultant", "Investor", "Portfolio Contact"];

export function StakeholderForm({ onSubmit, onCancel, initialData, isLoading }: StakeholderFormProps) {
  const [formData, setFormData] = useState<CreateExternalStakeholderInput>({
    name: initialData?.name || "",
    type: initialData?.type || "Advisor",
    email: initialData?.email || "",
    phone: initialData?.phone || "",
    organization: initialData?.organization || "",
    notes: initialData?.notes || ""
  });

  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev: CreateExternalStakeholderInput) => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!formData.name || !formData.type) {
      setError("Please fill in all required fields");
      return;
    }

    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      setError("Please enter a valid email address");
      return;
    }

    try {
      await onSubmit(formData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save stakeholder");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-4">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Basic Information */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-8">
        <h3 className="text-lg font-semibold text-white mb-6">Basic Information</h3>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Name *
            </label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
              placeholder="Enter stakeholder name"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Type *
            </label>
            <select
              name="type"
              value={formData.type}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
            >
              {STAKEHOLDER_TYPES.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Email
            </label>
            <input
              type="email"
              name="email"
              value={formData.email || ""}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
              placeholder="name@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Phone
            </label>
            <input
              type="tel"
              name="phone"
              value={formData.phone || ""}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
              placeholder="+1 (555) 000-0000"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Organization
            </label>
            <input
              type="text"
              name="organization"
              value={formData.organization || ""}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
              placeholder="Company or firm name"
            />
          </div>
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
            placeholder="Add any notes about this stakeholder..."
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
          {isLoading ? "Saving..." : "Save Stakeholder"}
        </button>
      </div>
    </form>
  );
}

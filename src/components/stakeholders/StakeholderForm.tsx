import { useState } from "react";
import { FormField, inputClass, selectClass, textareaClass } from "../ui/FormField";
import type { CreateExternalStakeholderInput, StakeholderType } from "../../types/entities";

export interface StakeholderFormProps {
  initialData?: Partial<CreateExternalStakeholderInput>;
  onSubmit: (data: CreateExternalStakeholderInput) => void;
  isLoading?: boolean;
}

export function StakeholderForm({ initialData, onSubmit, isLoading }: StakeholderFormProps) {
  const [formData, setFormData] = useState<CreateExternalStakeholderInput>({
    name: initialData?.name || "",
    type: initialData?.type || "Advisor",
    email: initialData?.email || "",
    phone: initialData?.phone || "",
    organization: initialData?.organization || "",
    notes: initialData?.notes || "",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 font-sans">
      <div className="space-y-4 rounded-xl border border-white/[0.02] bg-white/[0.01] p-5">
        <h3 className="text-xs font-bold uppercase tracking-widest text-[#C6A66B]">Stakeholder Details</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Full Name" id="name" required>
            <input name="name" id="name" required value={formData.name} onChange={handleChange} className={inputClass} />
          </FormField>
          <FormField label="Type" id="type" required>
            <select name="type" id="type" required value={formData.type} onChange={handleChange} className={selectClass}>
              <option value="Advisor">Advisor</option>
              <option value="Lawyer">Lawyer</option>
              <option value="Broker">Broker</option>
              <option value="Consultant">Consultant</option>
              <option value="Investor">Investor</option>
              <option value="Portfolio Contact">Portfolio Contact</option>
            </select>
          </FormField>
          <FormField label="Email Address" id="email">
            <input type="email" name="email" id="email" value={formData.email || ""} onChange={handleChange} className={inputClass} />
          </FormField>
          <FormField label="Phone Number" id="phone">
            <input type="tel" name="phone" id="phone" value={formData.phone || ""} onChange={handleChange} className={inputClass} />
          </FormField>
          <FormField label="Organization" id="organization">
            <input name="organization" id="organization" value={formData.organization || ""} onChange={handleChange} className={inputClass} />
          </FormField>
        </div>
      </div>

      <div className="space-y-4 rounded-xl border border-white/[0.02] bg-white/[0.01] p-5">
        <h3 className="text-xs font-bold uppercase tracking-widest text-[#C6A66B]">Notes</h3>
        <FormField label="Additional Notes" id="notes">
          <textarea name="notes" id="notes" rows={4} value={formData.notes || ""} onChange={handleChange} className={textareaClass} />
        </FormField>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-white/[0.05]">
        <button
          type="submit"
          disabled={isLoading}
          className="h-10 px-6 rounded-xl bg-gradient-to-r from-acp-bronze to-acp-bronze-dark text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:pointer-events-none hover:shadow-glow-bronze transition cursor-pointer"
        >
          {isLoading ? "Saving..." : "Save Stakeholder"}
        </button>
      </div>
    </form>
  );
}

import { useState } from "react";
import { FormField, inputClass, selectClass, textareaClass } from "../ui/FormField";
import type { CreatePortfolioCompanyInput } from "../../types/entities";

export interface PortfolioCompanyFormProps {
  initialData?: Partial<CreatePortfolioCompanyInput>;
  onSubmit: (data: CreatePortfolioCompanyInput) => void;
  isLoading?: boolean;
}

export function PortfolioCompanyForm({ initialData, onSubmit, isLoading }: PortfolioCompanyFormProps) {
  const [formData, setFormData] = useState<CreatePortfolioCompanyInput>({
    companyName: initialData?.companyName || "",
    industry: initialData?.industry || "",
    revenue: initialData?.revenue || undefined,
    ebitda: initialData?.ebitda || undefined,
    debt: initialData?.debt || undefined,
    headcount: initialData?.headcount || undefined,
    status: initialData?.status || "Active",
    location: initialData?.location || "",
    notes: initialData?.notes || "",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: ["revenue", "ebitda", "debt", "headcount"].includes(name)
        ? value === "" ? undefined : Number(value)
        : value,
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 font-sans">
      <div className="space-y-4 rounded-xl border border-white/[0.02] bg-white/[0.01] p-5">
        <h3 className="text-xs font-bold uppercase tracking-widest text-[#C6A66B]">Company Details</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Company Name" id="companyName" required>
            <input name="companyName" id="companyName" required value={formData.companyName} onChange={handleChange} className={inputClass} />
          </FormField>
          <FormField label="Industry" id="industry" required>
            <input name="industry" id="industry" required value={formData.industry} onChange={handleChange} className={inputClass} />
          </FormField>
          <FormField label="Location" id="location" required>
            <input name="location" id="location" required value={formData.location} onChange={handleChange} className={inputClass} />
          </FormField>
          <FormField label="Status" id="status" required>
            <select name="status" id="status" required value={formData.status} onChange={handleChange} className={selectClass}>
              <option value="Active">Active</option>
              <option value="In Transition">In Transition</option>
              <option value="Exited">Exited</option>
              <option value="Archived">Archived</option>
            </select>
          </FormField>
        </div>
      </div>

      <div className="space-y-4 rounded-xl border border-white/[0.02] bg-white/[0.01] p-5">
        <h3 className="text-xs font-bold uppercase tracking-widest text-[#C6A66B]">Financials & Metrics</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Revenue" id="revenue">
            <input type="number" name="revenue" id="revenue" value={formData.revenue || ""} onChange={handleChange} className={inputClass} />
          </FormField>
          <FormField label="EBITDA" id="ebitda">
            <input type="number" name="ebitda" id="ebitda" value={formData.ebitda || ""} onChange={handleChange} className={inputClass} />
          </FormField>
          <FormField label="Debt" id="debt">
            <input type="number" name="debt" id="debt" value={formData.debt || ""} onChange={handleChange} className={inputClass} />
          </FormField>
          <FormField label="Headcount" id="headcount">
            <input type="number" name="headcount" id="headcount" value={formData.headcount || ""} onChange={handleChange} className={inputClass} />
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
          {isLoading ? "Saving..." : "Save Portfolio Company"}
        </button>
      </div>
    </form>
  );
}

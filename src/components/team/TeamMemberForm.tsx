import { useState } from "react";
import { FormField, inputClass, selectClass } from "../ui/FormField";
import type { CreateTeamMemberInput, UserRole, UserStatus } from "../../types/entities";

export interface TeamMemberFormProps {
  initialData?: Partial<CreateTeamMemberInput>;
  onSubmit: (data: CreateTeamMemberInput) => void;
  isLoading?: boolean;
}

export function TeamMemberForm({ initialData, onSubmit, isLoading }: TeamMemberFormProps) {
  const [formData, setFormData] = useState<CreateTeamMemberInput>({
    name: initialData?.name || "",
    email: initialData?.email || "",
    phone: initialData?.phone || "",
    role: initialData?.role || "Analyst",
    status: initialData?.status || "Active",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
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
        <h3 className="text-xs font-bold uppercase tracking-widest text-[#C6A66B]">Team Member Details</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Full Name" id="name" required>
            <input name="name" id="name" required value={formData.name} onChange={handleChange} className={inputClass} />
          </FormField>
          <FormField label="Email Address" id="email" required>
            <input type="email" name="email" id="email" required value={formData.email} onChange={handleChange} className={inputClass} />
          </FormField>
          <FormField label="Phone Number" id="phone">
            <input type="tel" name="phone" id="phone" value={formData.phone || ""} onChange={handleChange} className={inputClass} />
          </FormField>
        </div>
      </div>

      <div className="space-y-4 rounded-xl border border-white/[0.02] bg-white/[0.01] p-5">
        <h3 className="text-xs font-bold uppercase tracking-widest text-[#C6A66B]">Access & Role</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Role" id="role" required>
            <select name="role" id="role" required value={formData.role} onChange={handleChange} className={selectClass}>
              <option value="Managing Partner">Managing Partner</option>
              <option value="Partner">Partner</option>
              <option value="Analyst">Analyst</option>
              <option value="Admin">Admin</option>
              <option value="Read Only">Read Only</option>
              <option value="HR">HR</option>
              <option value="Stakeholder">Stakeholder</option>
            </select>
          </FormField>
          <FormField label="Status" id="status" required>
            <select name="status" id="status" required value={formData.status} onChange={handleChange} className={selectClass}>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </FormField>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-white/[0.05]">
        <button
          type="submit"
          disabled={isLoading}
          className="h-10 px-6 rounded-xl bg-gradient-to-r from-acp-bronze to-acp-bronze-dark text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:pointer-events-none hover:shadow-glow-bronze transition cursor-pointer"
        >
          {isLoading ? "Saving..." : "Save Team Member"}
        </button>
      </div>
    </form>
  );
}

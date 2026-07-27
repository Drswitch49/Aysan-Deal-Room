import { useState, useEffect, useMemo } from "react";
import { FormField, inputClass, selectClass, textareaClass } from "../ui/FormField";
import { Upload, Loader2, Link as LinkIcon } from "lucide-react";
import type { CreateDealInput } from "../../types/entities";
import { SearchableDropdown } from "../ui/SearchableDropdown";
import { hasPermission } from "../../lib/rbac";
import { fetchTeamMemberRecords, uploadTempFile } from "../../api/admin";

export interface DealFormProps {
  initialData?: Partial<CreateDealInput>;
  onSubmit: (data: CreateDealInput) => void;
  isLoading?: boolean;
}

export function DealForm({ initialData, onSubmit, isLoading }: DealFormProps) {
  const [teamMembers, setTeamMembers] = useState<any[]>([]);

  useEffect(() => {
    const loadTeamMembers = async () => {
      try {
        setTeamMembers(await fetchTeamMemberRecords());
      } catch (err) {
        console.error("Failed to load team members:", err);
      }
    };
    loadTeamMembers();
  }, []);

  const eligibleUsers = useMemo(() => {
    const list = teamMembers
      .filter((member: any) => {
        const fields = member.fields || {};
        const tempUser = {
          id: member.id,
          email: fields.Email || "",
          name: fields.Name || "",
          role: fields.Role,
          status: fields.Status || "Active"
        };
        return fields.Status !== "Inactive" && hasPermission(tempUser as any, "edit_deal");
      })
      .map((member: any) => member.fields.Name)
      .filter(Boolean);

    // Fallback list of users if API is loading or empty
    if (list.length === 0) {
      return ["Ayo Yusuf", "Prince Realo", "Dami", "Chante"];
    }
    return list;
  }, [teamMembers]);

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
    stage: initialData?.stage || "Intro",
    nextAction: initialData?.nextAction || "",
    dueDate: initialData?.dueDate || "",
    internalNotes: initialData?.internalNotes || "",
    imDocumentUrl: initialData?.imDocumentUrl || "",
    financialPackUrl: initialData?.financialPackUrl || "",
  });

  const [isUploadingIM, setIsUploadingIM] = useState(false);
  const [isUploadingFin, setIsUploadingFin] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, fieldName: "imDocumentUrl" | "financialPackUrl") => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (fieldName === "imDocumentUrl") setIsUploadingIM(true);
    else setIsUploadingFin(true);

    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64data = reader.result as string;
        try {
          // strip the data-URI prefix; uploadTempFile expects raw base64
          const rawBase64 = base64data.includes(",") ? base64data.split(",")[1] : base64data;
          const data = await uploadTempFile(file.name, file.type, rawBase64);
          setFormData(prev => ({ ...prev, [fieldName]: data.url }));
        } catch {
          alert("File upload failed.");
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error(err);
      alert("Error uploading file");
    } finally {
      if (fieldName === "imDocumentUrl") setIsUploadingIM(false);
      else setIsUploadingFin(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: ["revenue", "ebitda", "enterpriseValue", "askingPrice"].includes(name)
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
      {/* Company Information */}
      <div className="space-y-4 rounded-xl border border-white/[0.02] bg-white/[0.01] p-5">
        <h3 className="text-xs font-bold uppercase tracking-widest text-[#C6A66B]">Company Information</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Company Name" id="companyName" required>
            <input name="companyName" id="companyName" required value={formData.companyName} onChange={handleChange} className={inputClass} placeholder="e.g. Acme Corp" />
          </FormField>
          <FormField label="Project Name" id="projectName" required>
            <input name="projectName" id="projectName" required value={formData.projectName} onChange={handleChange} className={inputClass} placeholder="e.g. Project Alpha" />
          </FormField>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField label="Industry" id="industry" required>
            <input name="industry" id="industry" required value={formData.industry} onChange={handleChange} className={inputClass} placeholder="e.g. Technology" />
          </FormField>
          <FormField label="Website" id="website">
            <input name="website" id="website" value={formData.website || ""} onChange={handleChange} className={inputClass} placeholder="https://" />
          </FormField>
          <FormField label="Location" id="location" required>
            <input name="location" id="location" required value={formData.location} onChange={handleChange} className={inputClass} placeholder="e.g. London" />
          </FormField>
        </div>
      </div>

      {/* Ownership */}
      <div className="space-y-4 rounded-xl border border-white/[0.02] bg-white/[0.01] p-5">
        <h3 className="text-xs font-bold uppercase tracking-widest text-[#C6A66B]">Ownership & Sourcing</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField label="Owner" id="owner" required>
            <SearchableDropdown
              id="owner"
              name="owner"
              required
              value={formData.owner}
              onChange={(val) => setFormData((prev) => ({ ...prev, owner: val }))}
              options={eligibleUsers}
              placeholder="Select Deal Owner"
            />
          </FormField>
          <FormField label="Analyst" id="analyst" required>
            <SearchableDropdown
              id="analyst"
              name="analyst"
              required
              value={formData.analyst}
              onChange={(val) => setFormData((prev) => ({ ...prev, analyst: val }))}
              options={eligibleUsers}
              placeholder="Select Analyst"
            />
          </FormField>
          <FormField label="Source" id="source" required>
            <input name="source" id="source" required value={formData.source} onChange={handleChange} className={inputClass} />
          </FormField>
        </div>
      </div>

      {/* Financials */}
      <div className="space-y-4 rounded-xl border border-white/[0.02] bg-white/[0.01] p-5">
        <h3 className="text-xs font-bold uppercase tracking-widest text-[#C6A66B]">Financials</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Revenue" id="revenue">
            <input type="number" name="revenue" id="revenue" value={formData.revenue || ""} onChange={handleChange} className={inputClass} />
          </FormField>
          <FormField label="EBITDA" id="ebitda">
            <input type="number" name="ebitda" id="ebitda" value={formData.ebitda || ""} onChange={handleChange} className={inputClass} />
          </FormField>
          <FormField label="Enterprise Value" id="enterpriseValue">
            <input type="number" name="enterpriseValue" id="enterpriseValue" value={formData.enterpriseValue || ""} onChange={handleChange} className={inputClass} />
          </FormField>
          <FormField label="Asking Price" id="askingPrice">
            <input type="number" name="askingPrice" id="askingPrice" value={formData.askingPrice || ""} onChange={handleChange} className={inputClass} />
          </FormField>
        </div>
      </div>

      {/* Workflow */}
      <div className="space-y-4 rounded-xl border border-white/[0.02] bg-white/[0.01] p-5">
        <h3 className="text-xs font-bold uppercase tracking-widest text-[#C6A66B]">Workflow</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField label="Stage" id="stage" required>
            <select name="stage" id="stage" value={formData.stage} onChange={handleChange} className={selectClass}>
              <option value="Intro">Intro</option>
              <option value="Inbound">Inbound</option>
              <option value="Information Requested">Information Requested</option>
              <option value="Seller Call">Seller Call</option>
              <option value="IM Review">IM Review</option>
              <option value="Due Diligence">Due Diligence</option>
              <option value="LOI">LOI</option>
              <option value="Under Offer">Under Offer</option>
              <option value="Closed">Closed</option>
              <option value="Killed">Killed</option>
              <option value="Archived">Archived</option>
            </select>
          </FormField>
          <FormField label="Next Action" id="nextAction">
            <input name="nextAction" id="nextAction" value={formData.nextAction || ""} onChange={handleChange} className={inputClass} />
          </FormField>
          <FormField label="Next Action Date" id="dueDate">
            <input type="date" name="dueDate" id="dueDate" value={formData.dueDate || ""} onChange={handleChange} className={inputClass} />
          </FormField>
        </div>
      </div>

      {/* Documents */}
      <div className="space-y-4 rounded-xl border border-white/[0.02] bg-white/[0.01] p-5">
        <h3 className="text-xs font-bold uppercase tracking-widest text-[#C6A66B]">Documents</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Information Memorandum (IM)" id="imDocumentUrl">
            <div className="flex flex-col gap-2">
              <input name="imDocumentUrl" id="imDocumentUrl" value={formData.imDocumentUrl || ""} onChange={handleChange} className={inputClass} placeholder="Document URL..." />
              <div className="flex items-center gap-2 mt-1">
                <input type="file" id="im-file-upload" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx" onChange={(e) => handleFileUpload(e, "imDocumentUrl")} />
                <label htmlFor="im-file-upload" className="flex items-center gap-2 cursor-pointer bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-300 px-3 py-1.5 rounded-lg transition-colors border border-white/10">
                  {isUploadingIM ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  {isUploadingIM ? "Uploading..." : "Upload File"}
                </label>
                {formData.imDocumentUrl && (
                  <a href={formData.imDocumentUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-emerald-400 font-medium flex items-center gap-1 hover:underline">
                    <LinkIcon className="h-3 w-3" /> View Uploaded File
                  </a>
                )}
              </div>
            </div>
          </FormField>
          
          <FormField label="Financial Pack" id="financialPackUrl">
            <div className="flex flex-col gap-2">
              <input name="financialPackUrl" id="financialPackUrl" value={formData.financialPackUrl || ""} onChange={handleChange} className={inputClass} placeholder="Document URL..." />
              <div className="flex items-center gap-2 mt-1">
                <input type="file" id="fin-file-upload" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx" onChange={(e) => handleFileUpload(e, "financialPackUrl")} />
                <label htmlFor="fin-file-upload" className="flex items-center gap-2 cursor-pointer bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-300 px-3 py-1.5 rounded-lg transition-colors border border-white/10">
                  {isUploadingFin ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  {isUploadingFin ? "Uploading..." : "Upload File"}
                </label>
                {formData.financialPackUrl && (
                  <a href={formData.financialPackUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-emerald-400 font-medium flex items-center gap-1 hover:underline">
                    <LinkIcon className="h-3 w-3" /> View Uploaded File
                  </a>
                )}
              </div>
            </div>
          </FormField>
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-4 rounded-xl border border-white/[0.02] bg-white/[0.01] p-5">
        <h3 className="text-xs font-bold uppercase tracking-widest text-[#C6A66B]">Internal Notes</h3>
        <FormField label="Notes" id="internalNotes">
          <textarea name="internalNotes" id="internalNotes" rows={4} value={formData.internalNotes || ""} onChange={handleChange} className={textareaClass} />
        </FormField>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-white/[0.05]">
        <button
          type="submit"
          disabled={isLoading}
          className="h-10 px-6 rounded-xl bg-gradient-to-r from-acp-bronze to-acp-bronze-dark text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:pointer-events-none hover:shadow-glow-bronze transition cursor-pointer"
        >
          {isLoading ? "Saving..." : "Save Deal"}
        </button>
      </div>
    </form>
  );
}

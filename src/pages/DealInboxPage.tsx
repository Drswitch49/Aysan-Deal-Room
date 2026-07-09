import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { 
  Search, AlertTriangle, ChevronLeft, ChevronRight, Inbox, Plus, RefreshCw,
  Building2, MapPin, Briefcase, Mail, Phone, ExternalLink, Sparkles, FileText
} from "lucide-react";
import { getDealInbox, createInboxDeal, updateInboxDeal } from "../api/airtable";
import { promoteDealFromInbox, updateInboxStatus, deleteInboxDeal } from "../api/admin";
import { LoadingState } from "../components/ui/LoadingState";
import { Modal } from "../components/ui/Modal";
import { FormField } from "../components/ui/FormField";
import { cx } from "../utils/cx";
import { usePipeline } from "../context/PipelineContext";

export function DealInboxPage() {
  const [inboxItems, setInboxItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { refresh: refreshPipeline } = usePipeline();

  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("All Deals");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const [promotingId, setPromotingId] = useState<string | null>(null);

  // Detail Modal States
  const [selectedDeal, setSelectedDeal] = useState<any | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);


  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<any | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  
  const [formData, setFormData] = useState({
    refNo: "", dealName: "", companyName: "", sector: "", location: "", broker: "", status: "Pending", imReviewDoc: "",
    executiveSummary: "", businessDescription: "", ebitda: "", revenue: "", askingPrice: "", enterpriseValue: "", contactName: "", contactEmail: "", contactPhone: ""
  });
  const [submittingDeal, setSubmittingDeal] = useState(false);

  const openAddModal = () => {
    setFormData({ 
      refNo: "", dealName: "", companyName: "", sector: "", location: "", broker: "", status: "Pending", imReviewDoc: "",
      executiveSummary: "", businessDescription: "", ebitda: "", revenue: "", askingPrice: "", enterpriseValue: "", contactName: "", contactEmail: "", contactPhone: ""
    });
    setIsAddModalOpen(true);
  };
  
  const openEditModal = (deal: any, e: any) => {
    e.stopPropagation();
    setEditingDeal(deal);
    setFormData({
      refNo: deal.fields["REF. NO"] || "",
      imReviewDoc: (Array.isArray(deal.fields["Attachments"]) && deal.fields["Attachments"][0]?.url) || (Array.isArray(deal.fields["IM_Review_Documents"]) && deal.fields["IM_Review_Documents"][0]?.url) || deal.fields["Attachments"] || deal.fields["IM_Review_Documents"] || "",
      dealName: deal.fields["Deal Name"] || "",
      companyName: deal.fields["Company Name"] || deal.fields["Company_Name"] || "",
      sector: deal.fields["Sector"] || "",
      location: deal.fields["Location"] || "",
      broker: deal.fields["Broker"] || deal.fields["BROKER"] || "",
      status: deal.fields["Status"] || "Pending",
      executiveSummary: deal.fields["Summary"] || deal.fields["Description"] || deal.fields["Executive_Summary"] || "",
      businessDescription: deal.fields["Business_Description"] || "",
      ebitda: deal.fields["EBITDA_GBP"] || "",
      revenue: deal.fields["Turnover"] || "",
      askingPrice: deal.fields["Asking_Price_GBP"] || "",
      enterpriseValue: deal.fields["Enterprise_Value"] || "",
      contactName: deal.fields["Contact_Name"] || "",
      contactEmail: deal.fields["Contact_Email"] || "",
      contactPhone: deal.fields["Contact_Phone"] || ""
    });
    setIsEditModalOpen(true);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64data = reader.result as string;
        const res = await fetch("/api/admin/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "upload-temp-file",
            fileData: base64data,
            fileName: file.name,
            fileType: file.type
          })
        });
        if (res.ok) {
          const data = await res.json();
          setFormData(prev => ({ ...prev, imReviewDoc: data.url }));
        } else {
          alert("File upload failed.");
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error(err);
      alert("Error uploading file");
    } finally {
      setIsUploading(false);
    }
  };

  const handleSaveDeal = async (e: any) => {
    e.preventDefault();
    setSubmittingDeal(true);
    try {
      const payload = {
        "REF. NO": formData.refNo,
        "Deal Name": formData.dealName,
        "Company Name": formData.companyName,
        "Sector": formData.sector,
        "Location": formData.location,
        "BROKER": formData.broker,
        "Status": formData.status,
        "Summary": formData.executiveSummary,
        "Description": formData.businessDescription,
        "EBITDA_GBP": Number(formData.ebitda) || undefined,
        "Turnover": Number(formData.revenue) || undefined,
        "Asking_Price_GBP": Number(formData.askingPrice) || undefined,
        "Enterprise_Value": Number(formData.enterpriseValue) || undefined,
        "Contact_Name": formData.contactName,
        "Contact_Email": formData.contactEmail,
        "Contact_Phone": formData.contactPhone,
        "IM_Review_Documents": formData.imReviewDoc ? [{ url: formData.imReviewDoc }] : [],
        "Attachments": formData.imReviewDoc ? [{ url: formData.imReviewDoc }] : []
      };
      if (isAddModalOpen) {
        await createInboxDeal(payload);
      } else if (isEditModalOpen && editingDeal) {
        await updateInboxDeal(editingDeal.id, payload);
      }
      setIsAddModalOpen(false);
      setIsEditModalOpen(false);
      fetchInbox();
    } catch (err: any) {
      alert(err.message || "Error saving deal");
    } finally {
      setSubmittingDeal(false);
    }
  };

  // Dynamic status options from inbox items
  const statusOptions = Array.from(new Set(inboxItems.map(item => item.fields?.Status).filter(Boolean)));
  if (!statusOptions.includes("Active")) statusOptions.push("Active");
  if (!statusOptions.includes("Passed")) statusOptions.push("Passed");
  if (!statusOptions.includes("Review Required")) statusOptions.push("Review Required");
  if (!statusOptions.includes("In Review")) statusOptions.push("In Review");

  useEffect(() => {
    fetchInbox();
  }, []);

  const fetchInbox = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getDealInbox();
      setInboxItems(data || []);
    } catch (err: any) {
      console.error("Failed to load deal inbox:", err);
      setError(err.message || "Failed to load deal inbox.");
    } finally {
      setLoading(false);
    }
  };

  const handlePromote = async (id: string) => {
    try {
      setPromotingId(id);
      const res = await promoteDealFromInbox(id);
      if (res.success) {
        setInboxItems((prev) => prev.map((item) => item.id === id ? { ...item, fields: { ...item.fields, Status: "Active" } } : item));
        refreshPipeline();
        setIsModalOpen(false);
      } else {
        throw new Error(res.error || "Promotion failed.");
      }
    } catch (err: any) {
      alert("Error promoting deal: " + err.message);
    } finally {
      setPromotingId(null);
    }
  };

  const handleStatusChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!selectedDeal) return;
    const newStatus = e.target.value;
    
    if (newStatus === "Active") {
      // Promoting the deal to Active Pipeline
      if (confirm("Setting status to 'Active' will migrate this deal to the Active Pipeline. Continue?")) {
        handlePromote(selectedDeal.id);
      }
      return;
    }

    try {
      setIsUpdatingStatus(true);
      await updateInboxStatus(selectedDeal.id, newStatus);
      
      // Optimistic update locally
      const updatedItem = {
        ...selectedDeal,
        fields: { ...selectedDeal.fields, Status: newStatus }
      };
      setSelectedDeal(updatedItem);
      setInboxItems((prev) => prev.map(item => item.id === selectedDeal.id ? updatedItem : item));
    } catch (err: any) {
      alert("Error updating status: " + err.message);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleDeleteDeal = async () => {
    if (!selectedDeal) return;
    if (!confirm("Are you sure you want to permanently delete this deal?")) return;
    try {
      setLoading(true);
      await deleteInboxDeal(selectedDeal.id);
      setIsModalOpen(false);
      fetchInbox();
    } catch (err: any) {
      alert("Error deleting deal: " + err.message);
      setLoading(false);
    }
  };

  // Filter
  const filteredItems = inboxItems.filter((d: any) => {
    const fields = d.fields || {};
    // Category Filter (based on status/stage)
    if (activeFilter !== "All Deals") {
      const rawStatus = fields["Status"];
      const status = rawStatus?.trim();
      if (activeFilter === "Other") {
        if (status) return false;
      } else {
        if (status !== activeFilter) return false;
      }
    }

    // Search Query
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    const name = (fields["Deal Name"] || fields["Company Name"] || fields["Company_Name"] || "").toLowerCase();
    const ref = (fields["REF. NO"] || "").toLowerCase();
    const sector = (fields["Sector"] || "").toLowerCase();
    return name.includes(q) || ref.includes(q) || sector.includes(q);
  });

  const totalPages = Math.ceil(filteredItems.length / itemsPerPage) || 1;
  const paginatedItems = filteredItems.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const formatFinancial = (val: any) => {
    if (val === null || val === undefined || val === "") return "TBC";
    
    if (typeof val === 'string' && /[kKmMbB]/.test(val) && !/^\d+$/.test(val)) return val;

    const cleanStr = String(val).replace(/[^0-9.-]/g, '');
    const num = Number(cleanStr);
    
    if (isNaN(num) || cleanStr === "") return "TBC";
    if (num >= 1000000) return `£${(num / 1000000).toFixed(1)}m`;
    if (num >= 1000) return `£${(num / 1000).toFixed(0)}k`;
    return `£${num}`;
  };

  const getCompanyName = (fields: any) => {
    const raw = fields["Deal Name"] || fields["Company Name"] || fields["Company_Name"] || "Unknown Company";
    return raw.replace(/^[A-Z0-9]+\s*[—\-:]\s*/i, "").trim();
  };

  const dynamicCategories = Array.from(
    new Set(
      inboxItems
        .map((item) => item.fields?.["Status"]?.trim())
        .filter(Boolean)
    )
  ).sort();
  const filters = ["All Deals", ...dynamicCategories, "Other"];

  return (
    <div className="space-y-8 text-[#E2E8F0] font-sans animate-fade-in-up">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/[0.02] pb-5">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <Inbox className="h-6 w-6 text-acp-bronze" />
            Deal Inbox
          </h1>
          <p className="text-xs text-slate-500 font-medium">
            Intake layer for all sourced opportunities before they become active transactions.
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={fetchInbox}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.05] bg-white/[0.02] text-slate-400 hover:text-white hover:bg-white/[0.05] transition cursor-pointer"
            title="Refresh Inbox"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Filter Row */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => { setActiveFilter(f); setCurrentPage(1); }}
            className={cx(
              "px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-all border",
              activeFilter === f 
                ? "bg-acp-bronze text-[#0B0B0C] border-acp-bronze shadow-[0_0_15px_rgba(198,166,107,0.3)]" 
                : "bg-white/[0.02] text-slate-400 border-white/[0.05] hover:bg-white/[0.05] hover:text-white"
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search inbox..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            className="h-9 w-64 rounded-xl border border-white/[0.02] bg-[#0B0B0C] pl-9 pr-3 text-xs text-white placeholder-slate-500 outline-none transition focus:border-acp-bronze shadow-inner"
          />
        </div>
        
        <div className="flex flex-wrap items-center gap-4">
          <div className="text-xs text-slate-500 font-semibold tracking-wide">
            Total Unassigned: {filteredItems.length}
          </div>
          <button 
            onClick={openAddModal}
            className="flex items-center gap-2 px-4 py-2 bg-[#C6A66B] hover:bg-[#b0925c] text-[#0B0B0C] font-bold text-[10px] uppercase tracking-wider rounded-xl transition"
          >
            <Plus className="w-4 h-4" /> Add Deal
          </button>
        </div>
      </div>

      {loading && <LoadingState variant="table" label="Loading deal inbox" />}

      {error && (
        <div className="rounded-2xl border border-rose-500/10 bg-rose-500/5 p-6 text-center text-xs font-semibold text-rose-400 border-l-4 border-l-rose-500">
          {error}
        </div>
      )}

      {!loading && !error && (
        <div className="rounded-2xl premium-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse table-fixed min-w-[950px]">
              <thead>
                <tr className="border-b border-white/[0.02] bg-white/[0.01] select-none text-slate-400">
                  <th className="w-[180px] px-5 py-3.5 text-[10px] font-semibold tracking-wide uppercase">Company</th>
                  <th className="w-[100px] px-4 py-3.5 text-[10px] font-semibold tracking-wide uppercase">Sector</th>
                  <th className="w-[80px] px-4 py-3.5 text-[10px] font-semibold tracking-wide uppercase">Turnover</th>
                  <th className="w-[80px] px-4 py-3.5 text-[10px] font-semibold tracking-wide uppercase">EBITDA</th>
                  <th className="w-[80px] px-4 py-3.5 text-[10px] font-semibold tracking-wide uppercase">Asking Price</th>
                  <th className="w-[120px] px-4 py-3.5 text-[10px] font-semibold tracking-wide uppercase">Date Received</th>
                  <th className="w-[160px] px-5 py-3.5 text-[10px] font-semibold tracking-wide uppercase text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {paginatedItems.map((item) => {
                  const fields = item.fields || {};
                  const isPromoting = promotingId === item.id;
                  const companyName = getCompanyName(fields);

                  return (
                    <tr 
                      key={item.id} 
                      className="table-row-hover border-b border-white/[0.02] cursor-pointer"
                      onClick={() => {
                        setSelectedDeal(item);
                        setIsModalOpen(true);
                      }}
                    >
                      <td className="px-5 py-4 min-w-0">
                        <div className="font-sans font-semibold text-xs text-white truncate flex items-center gap-2">
                          {companyName}
                          {fields["AI_Verdict"] && <span title="AI Reviewed"><Sparkles className="w-3 h-3 text-acp-bronze flex-shrink-0" /></span>}
                        </div>
                        <p className="mt-1 text-[10px] text-slate-500 truncate leading-tight">
                          {fields["Location"] || "Unknown"} — Ref: {fields["REF. NO"] || "N/A"}
                        </p>
                      </td>
                      <td className="px-4 py-4 select-none">
                        <span className="inline-flex items-center rounded-full bg-slate-500/10 border border-slate-500/20 px-2.5 py-0.5 text-[10px] font-semibold text-slate-300">
                          {fields["Sector"] || fields["Industry"] || "General"}
                        </span>
                      </td>
                      <td className="px-4 py-4 font-sans text-xs font-medium text-white">
                        {formatFinancial(fields["Turnover"] || fields["Revenue"] || fields["Sales"])}
                      </td>
                      <td className="px-4 py-4 font-sans text-xs font-medium text-white">
                        {formatFinancial(fields["EBITDA_GBP"] || fields["EBITDA"])}
                      </td>
                      <td className="px-4 py-4 font-sans text-xs font-medium text-white">
                        {formatFinancial(fields["Asking_Price_GBP"] || fields["Asking Price"] || fields["EV Ask"] || fields["Enterprise_Value"])}
                      </td>
                      <td className="px-4 py-4 font-sans text-xs font-medium text-slate-400">
                        {fields["Date_Received"] || fields["Created Date"] || fields["Date Added"] || "N/A"}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-500/30 bg-slate-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-300">
                          {fields.Status || "Inbox"}
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {filteredItems.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-xs font-bold text-slate-500">
                      No items found in your Deal Inbox.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-white/[0.02] bg-white/[0.01] px-5 py-3.5 select-none">
              <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
                Showing {(currentPage - 1) * itemsPerPage + 1}–{Math.min(currentPage * itemsPerPage, filteredItems.length)} of {filteredItems.length}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                  disabled={currentPage === 1}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] text-slate-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none hover:bg-white/[0.05] transition cursor-pointer"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="text-[10px] font-bold text-slate-400 min-w-[60px] text-center">
                  {currentPage} / {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] text-slate-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none hover:bg-white/[0.05] transition cursor-pointer"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Deal Detail Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Deal Inbox Detail"
        maxWidth="max-w-4xl"
        subHeader={selectedDeal && (
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white/[0.01] p-4 rounded-xl border border-white/[0.03] min-w-0">
            <div className="min-w-0 w-full sm:w-auto flex-1 pr-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2 break-words whitespace-normal leading-tight">
                {getCompanyName(selectedDeal.fields)}
              </h2>
              <div className="text-xs text-slate-400 font-medium mt-1 truncate">
                Ref: {selectedDeal.fields["REF. NO"] || "N/A"}
              </div>
            </div>
            <div className="flex items-center gap-3 w-full sm:w-auto shrink-0 flex-wrap">
              <div className="relative w-full sm:w-auto">
                <select
                  value={selectedDeal.fields.Status || ""}
                  onChange={handleStatusChange}
                  disabled={isUpdatingStatus || promotingId === selectedDeal.id}
                  className="h-9 w-full appearance-none rounded-xl border border-[#C6A66B]/30 bg-[#C6A66B]/10 pl-4 pr-10 text-xs font-bold text-[#C6A66B] uppercase tracking-wider outline-none transition hover:bg-[#C6A66B]/20 cursor-pointer disabled:opacity-50"
                >
                  <option value="" disabled>Set Status...</option>
                  {statusOptions.map(o => (
                    <option key={String(o)} value={String(o)} className="bg-[#161B22] text-white">
                      {String(o)}
                    </option>
                  ))}
                </select>
                <ChevronRight className="absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-[#C6A66B] rotate-90 pointer-events-none" />
              </div>
              {promotingId === selectedDeal.id && (
                <RefreshCw className="w-4 h-4 text-[#C6A66B] animate-spin" />
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => {
                    setIsModalOpen(false);
                    openEditModal(selectedDeal, e);
                  }}
                  className="h-9 px-4 rounded-xl border border-white/[0.05] bg-white/[0.02] text-xs font-bold text-white hover:bg-white/[0.05] transition"
                >
                  Edit
                </button>
                <button
                  onClick={handleDeleteDeal}
                  className="h-9 px-4 rounded-xl border border-rose-500/20 bg-rose-500/10 text-xs font-bold text-rose-500 hover:bg-rose-500/20 transition"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      >
        {selectedDeal && (
          <div className="space-y-6 min-w-0">

            {/* AI Verdict Premium Card */}
            {selectedDeal.fields["AI_Verdict"] && (
              <div className="relative overflow-hidden rounded-2xl border border-[#C6A66B]/20 bg-gradient-to-br from-[#C6A66B]/10 to-transparent p-6 shadow-inner">
                <div className="absolute -top-10 -right-10 opacity-5 blur-3xl pointer-events-none">
                  <Sparkles className="w-40 h-40 text-[#C6A66B]" />
                </div>
                <div className="flex items-center gap-2 mb-4 relative z-10">
                  <Sparkles className="w-5 h-5 text-[#C6A66B]" />
                  <h3 className="text-sm font-bold text-[#C6A66B] uppercase tracking-widest">AI Verdict</h3>
                </div>
                <div className="text-sm text-[#E2E8F0] leading-relaxed whitespace-pre-wrap relative z-10 font-medium break-words">
                  {selectedDeal.fields["AI_Verdict"]}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 min-w-0">
              {/* Snapshot */}
              <div className="space-y-4 min-w-0">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 border-b border-white/[0.05] pb-2">Financial Snapshot</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-white/[0.02] border border-white/[0.02] p-4 min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1 truncate">Turnover</div>
                    <div className="text-sm font-bold text-white truncate">{formatFinancial(selectedDeal.fields["Turnover"] || selectedDeal.fields["Revenue"] || selectedDeal.fields["Sales"])}</div>
                  </div>
                  <div className="rounded-xl bg-white/[0.02] border border-white/[0.02] p-4 min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1 truncate">EBITDA</div>
                    <div className="text-sm font-bold text-white truncate">{formatFinancial(selectedDeal.fields["EBITDA_GBP"] || selectedDeal.fields["EBITDA"])}</div>
                  </div>
                  <div className="rounded-xl bg-white/[0.02] border border-white/[0.02] p-4 min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1 truncate">Asking Price</div>
                    <div className="text-sm font-bold text-white truncate">{formatFinancial(selectedDeal.fields["Asking_Price_GBP"] || selectedDeal.fields["Asking Price"] || selectedDeal.fields["EV Ask"] || selectedDeal.fields["Enterprise_Value"])}</div>
                  </div>
                  <div className="rounded-xl bg-white/[0.02] border border-white/[0.02] p-4 min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1 truncate">Sector</div>
                    <div className="text-sm font-bold text-white truncate" title={selectedDeal.fields["Sector"] || selectedDeal.fields["Industry"] || "General"}>
                      {selectedDeal.fields["Sector"] || selectedDeal.fields["Industry"] || "General"}
                    </div>
                  </div>
                  <div className="rounded-xl bg-white/[0.02] border border-white/[0.02] p-4 col-span-2 sm:col-span-1 min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1 truncate">DSCR Proxy</div>
                    <div className="text-sm font-bold text-white truncate">
                      {selectedDeal.fields["DSCR proxy"] || selectedDeal.fields["DSCR Proxy"] || selectedDeal.fields["DSCR_Proxy"] || "N/A"}
                    </div>
                  </div>
                  <div className="rounded-xl bg-white/[0.02] border border-white/[0.02] p-4 col-span-2 min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1 truncate">One Line Reason</div>
                    <div className="text-sm font-bold text-white whitespace-pre-wrap break-words">
                      {selectedDeal.fields["One line reason"] || selectedDeal.fields["One_Line_Reason"] || "N/A"}
                    </div>
                  </div>
                </div>
              </div>

              {/* Contact & Source */}
              <div className="space-y-4 min-w-0">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 border-b border-white/[0.05] pb-2">Sourcing & Contact</h4>
                <div className="space-y-3 min-w-0">
                  <div className="flex items-center gap-3 text-xs min-w-0">
                    <MapPin className="w-4 h-4 text-slate-500 flex-shrink-0" />
                    <span className="text-slate-300 truncate">{selectedDeal.fields["Location"] || "Location Unknown"}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs min-w-0">
                    <Briefcase className="w-4 h-4 text-slate-500 flex-shrink-0" />
                    <span className="text-slate-300 truncate">Broker: {selectedDeal.fields["BROKER"] || "N/A"}</span>
                  </div>
                  <div className="flex items-start gap-3 text-xs min-w-0">
                    <Mail className="w-4 h-4 text-slate-500 flex-shrink-0 mt-0.5" />
                    <span className="text-slate-300 break-all">{selectedDeal.fields["Contact E-mail"] || selectedDeal.fields["Contact Email"] || "No Email Provided"}</span>
                  </div>
                  <div className="flex items-start gap-3 text-xs min-w-0">
                    <Phone className="w-4 h-4 text-slate-500 flex-shrink-0 mt-0.5" />
                    <span className="text-slate-300 break-words">{selectedDeal.fields["Contact Call Line "] || selectedDeal.fields["Contact Phone"] || "No Phone Provided"}</span>
                  </div>
                  {(selectedDeal.fields["Listing Link"] || selectedDeal.fields["Source"]) && (
                    <div className="flex items-center gap-3 text-xs mt-4 pt-4 border-t border-white/[0.05] min-w-0">
                      <ExternalLink className="w-4 h-4 text-[#C6A66B] flex-shrink-0" />
                      <a 
                        href={selectedDeal.fields["Listing Link"] || selectedDeal.fields["Source"]} 
                        target="_blank" 
                        rel="noreferrer"
                        className="text-[#C6A66B] font-semibold hover:underline truncate block"
                      >
                        View Listing Source
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Long Text Sections */}
            <div className="space-y-6 min-w-0">
              {selectedDeal.fields["Executive Summary"] && (
                <div className="min-w-0">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Executive Summary</h4>
                  <div className="bg-white/[0.01] rounded-xl border border-white/[0.02] p-5 text-xs text-slate-300 leading-relaxed whitespace-pre-wrap break-words">
                    {selectedDeal.fields["Executive Summary"]}
                  </div>
                </div>
              )}
              {selectedDeal.fields["Business Description"] && (
                <div className="min-w-0">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Business Description</h4>
                  <div className="bg-white/[0.01] rounded-xl border border-white/[0.02] p-5 text-xs text-slate-300 leading-relaxed whitespace-pre-wrap break-words">
                    {selectedDeal.fields["Business Description"]}
                  </div>
                </div>
              )}

              {/* Attachments Section */}
              {(selectedDeal.fields["Attachments"] || selectedDeal.fields["IM_Review_Documents"]) && (
                <div className="min-w-0">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Attached Documents</h4>
                  <div className="flex flex-col gap-2 min-w-0">
                    {(() => {
                      const attachments = selectedDeal.fields["Attachments"] || selectedDeal.fields["IM_Review_Documents"];
                      if (Array.isArray(attachments)) {
                        return attachments.map((att: any, idx: number) => (
                          <a key={att.id || idx} href={att.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 bg-white/[0.01] border border-white/[0.02] p-4 rounded-xl hover:bg-white/[0.04] transition min-w-0">
                            <FileText className="w-5 h-5 text-acp-bronze flex-shrink-0" />
                            <div className="text-xs text-white truncate font-medium">{att.filename || `Document ${idx + 1}`}</div>
                          </a>
                        ));
                      }
                      if (typeof attachments === "string") {
                        return (
                          <a href={attachments} target="_blank" rel="noreferrer" className="flex items-center gap-3 bg-white/[0.01] border border-white/[0.02] p-4 rounded-xl hover:bg-white/[0.04] transition min-w-0">
                            <FileText className="w-5 h-5 text-acp-bronze flex-shrink-0" />
                            <div className="text-xs text-white truncate font-medium">Link to Document</div>
                          </a>
                        );
                      }
                      return null;
                    })()}
                  </div>
                </div>
              )}
            </div>

          </div>
        )}
      </Modal>

      {/* ADD / EDIT MODAL */}
      <Modal 
        isOpen={isAddModalOpen || isEditModalOpen} 
        onClose={() => { setIsAddModalOpen(false); setIsEditModalOpen(false); }} 
        title={isAddModalOpen ? "Add New Deal to Inbox" : "Edit Deal"}
        onSubmit={handleSaveDeal}
        footer={(
          <button type="submit" disabled={submittingDeal || isUploading} className="w-full flex items-center justify-center h-10 bg-acp-bronze hover:bg-acp-bronze-dark text-white rounded-xl text-xs font-bold uppercase tracking-wider transition disabled:opacity-50 cursor-pointer">
            {submittingDeal || isUploading ? "Saving..." : "Save Deal"}
          </button>
        )}
      >
        <div className="space-y-4 pr-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Reference No. (Optional)" id="modal-ref">
              <input id="modal-ref" type="text" value={formData.refNo} onChange={e => setFormData({...formData, refNo: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-acp-bronze/50 transition-colors" placeholder="e.g. ACP-CFS-018" />
            </FormField>
            <FormField label="Company Name" id="modal-company">
              <input id="modal-company" type="text" value={formData.companyName} onChange={e => setFormData({...formData, companyName: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-acp-bronze/50 transition-colors" required placeholder="e.g. Acme Corp" />
            </FormField>
          </div>
          
          <FormField label="Deal Name" id="modal-name">
            <input id="modal-name" type="text" value={formData.dealName} onChange={e => setFormData({...formData, dealName: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-acp-bronze/50 transition-colors" required placeholder="e.g. ACP-CFS-018 - Acme Corp" />
          </FormField>
          
          <FormField label="Executive Summary" id="modal-summary">
            <textarea id="modal-summary" value={formData.executiveSummary} onChange={e => setFormData({...formData, executiveSummary: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-acp-bronze/50 transition-colors h-20 resize-none" placeholder="Brief summary of the deal..." />
          </FormField>

          <FormField label="Business Description" id="modal-desc">
            <textarea id="modal-desc" value={formData.businessDescription} onChange={e => setFormData({...formData, businessDescription: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-acp-bronze/50 transition-colors h-24 resize-y" placeholder="Detailed description..." />
          </FormField>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Sector" id="modal-sector">
              <input id="modal-sector" type="text" value={formData.sector} onChange={e => setFormData({...formData, sector: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-acp-bronze/50 transition-colors" placeholder="e.g. Technology" />
            </FormField>
            <FormField label="Location" id="modal-location">
              <input id="modal-location" type="text" value={formData.location} onChange={e => setFormData({...formData, location: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-acp-bronze/50 transition-colors" placeholder="e.g. London, UK" />
            </FormField>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <FormField label="Revenue (£)" id="modal-rev">
              <input id="modal-rev" type="number" value={formData.revenue} onChange={e => setFormData({...formData, revenue: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-acp-bronze/50 transition-colors" placeholder="e.g. 5000000" />
            </FormField>
            <FormField label="EBITDA (£)" id="modal-ebitda">
              <input id="modal-ebitda" type="number" value={formData.ebitda} onChange={e => setFormData({...formData, ebitda: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-acp-bronze/50 transition-colors" placeholder="e.g. 1000000" />
            </FormField>
            <FormField label="Asking Price (£)" id="modal-asking">
              <input id="modal-asking" type="number" value={formData.askingPrice} onChange={e => setFormData({...formData, askingPrice: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-acp-bronze/50 transition-colors" placeholder="e.g. 4000000" />
            </FormField>
            <FormField label="Enterprise Value (£)" id="modal-ev">
              <input id="modal-ev" type="number" value={formData.enterpriseValue} onChange={e => setFormData({...formData, enterpriseValue: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-acp-bronze/50 transition-colors" placeholder="e.g. 4500000" />
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <FormField label="Contact Name" id="modal-contact-name">
              <input id="modal-contact-name" type="text" value={formData.contactName} onChange={e => setFormData({...formData, contactName: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-acp-bronze/50 transition-colors" placeholder="Name" />
            </FormField>
            <FormField label="Contact Email" id="modal-contact-email">
              <input id="modal-contact-email" type="email" value={formData.contactEmail} onChange={e => setFormData({...formData, contactEmail: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-acp-bronze/50 transition-colors" placeholder="Email" />
            </FormField>
            <FormField label="Contact Phone" id="modal-contact-phone">
              <input id="modal-contact-phone" type="text" value={formData.contactPhone} onChange={e => setFormData({...formData, contactPhone: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-acp-bronze/50 transition-colors" placeholder="Phone" />
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Broker" id="modal-broker">
              <input id="modal-broker" type="text" value={formData.broker} onChange={e => setFormData({...formData, broker: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-acp-bronze/50 transition-colors" placeholder="e.g. John Doe" />
            </FormField>
            <FormField label="Status" id="modal-status">
              <select id="modal-status" value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-acp-bronze/50 transition-colors">
                {statusOptions.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            </FormField>
          </div>

          <FormField label="IM Review Document (Upload or URL)" id="modal-im-review">
            <div className="flex flex-col gap-2">
              <input 
                id="modal-im-review-file" 
                type="file" 
                onChange={handleFileUpload} 
                accept=".pdf,.doc,.docx,.xls,.xlsx"
                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white file:mr-4 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-acp-bronze/20 file:text-acp-bronze hover:file:bg-acp-bronze/30 transition-colors cursor-pointer" 
              />
              {isUploading && <span className="text-[10px] text-acp-bronze animate-pulse font-medium">Uploading file...</span>}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-500 font-bold uppercase">OR</span>
                <input 
                  id="modal-im-review" 
                  type="url" 
                  value={formData.imReviewDoc || ""} 
                  onChange={e => setFormData({...formData, imReviewDoc: e.target.value})} 
                  className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-acp-bronze/50 transition-colors" 
                  placeholder="Paste URL..." 
                />
              </div>
              {formData.imReviewDoc && (
                <a href={formData.imReviewDoc} target="_blank" rel="noreferrer" className="text-[10px] text-blue-400 hover:underline break-all truncate block">
                  Current Document: {formData.imReviewDoc}
                </a>
              )}
            </div>
          </FormField>
        </div>
      </Modal>

    </div>
  );
}

import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { 
  Search, AlertTriangle, ChevronLeft, ChevronRight, Inbox, Plus, RefreshCw,
  Building2, MapPin, Briefcase, Mail, Phone, ExternalLink, Sparkles
} from "lucide-react";
import { getDealInbox } from "../api/airtable";
import { promoteDealFromInbox, updateInboxStatus } from "../api/admin";
import { LoadingState } from "../components/ui/LoadingState";
import { Modal } from "../components/ui/Modal";
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

  // Dynamic status options from inbox items
  const statusOptions = Array.from(new Set(inboxItems.map(item => item.fields?.Status).filter(Boolean)));
  if (!statusOptions.includes("Active")) statusOptions.push("Active");
  if (!statusOptions.includes("Passed")) statusOptions.push("Passed");
  if (!statusOptions.includes("Review Required")) statusOptions.push("Review Required");

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
        setInboxItems((prev) => prev.filter((item) => item.id !== id));
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

  // Filter
  const filteredItems = inboxItems.filter((d: any) => {
    const fields = d.fields || {};
    // Category Filter
    if (activeFilter === "AI Reviewed Deals" && !fields["AI_Verdict"]) return false;
    if (activeFilter === "Review Required" && (fields["Status"] || "").toLowerCase() !== "review required") return false;
    if (activeFilter === "Passed" && (fields["Status"] || "").toLowerCase() !== "passed") return false;

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
    const num = Number(val);
    if (isNaN(num)) return "TBC";
    if (num >= 1000000) return `£${(num / 1000000).toFixed(1)}m`;
    if (num >= 1000) return `£${(num / 1000).toFixed(0)}k`;
    return `£${num}`;
  };

  const getCompanyName = (fields: any) => {
    const raw = fields["Deal Name"] || fields["Company Name"] || fields["Company_Name"] || "Unknown Company";
    return raw.replace(/^[A-Z0-9]+\s*[—\-:]\s*/i, "").trim();
  };

  const filters = ["All Deals", "AI Reviewed Deals", "Review Required", "Passed"];

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
        
        <div className="text-xs text-slate-500 font-semibold tracking-wide">
          Total Unassigned: {filteredItems.length}
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
                        {formatFinancial(fields["Turnover"] || fields["Revenue"])}
                      </td>
                      <td className="px-4 py-4 font-sans text-xs font-medium text-white">
                        {formatFinancial(fields["EBITDA_GBP"] || fields["EBITDA"])}
                      </td>
                      <td className="px-4 py-4 font-sans text-xs font-medium text-white">
                        {formatFinancial(fields["Asking_Price_GBP"] || fields["EV Ask"] || fields["Enterprise_Value"])}
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
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Deal Inbox Detail" maxWidth="max-w-4xl">
        {selectedDeal && (
          <div className="space-y-6">
            {/* Header / Actions Row */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white/[0.01] p-4 rounded-xl border border-white/[0.03]">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  {getCompanyName(selectedDeal.fields)}
                </h2>
                <div className="text-xs text-slate-400 font-medium mt-1">
                  Ref: {selectedDeal.fields["REF. NO"] || "N/A"}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <select
                    value={selectedDeal.fields.Status || ""}
                    onChange={handleStatusChange}
                    disabled={isUpdatingStatus || promotingId === selectedDeal.id}
                    className="h-9 appearance-none rounded-xl border border-[#C6A66B]/30 bg-[#C6A66B]/10 pl-4 pr-10 text-xs font-bold text-[#C6A66B] uppercase tracking-wider outline-none transition hover:bg-[#C6A66B]/20 cursor-pointer disabled:opacity-50"
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
              </div>
            </div>

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
                <div className="text-sm text-[#E2E8F0] leading-relaxed whitespace-pre-wrap relative z-10 font-medium">
                  {selectedDeal.fields["AI_Verdict"]}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Snapshot */}
              <div className="space-y-4">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 border-b border-white/[0.05] pb-2">Financial Snapshot</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-white/[0.02] border border-white/[0.02] p-4">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Turnover</div>
                    <div className="text-sm font-bold text-white">{formatFinancial(selectedDeal.fields["Turnover"] || selectedDeal.fields["Revenue"])}</div>
                  </div>
                  <div className="rounded-xl bg-white/[0.02] border border-white/[0.02] p-4">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">EBITDA</div>
                    <div className="text-sm font-bold text-white">{formatFinancial(selectedDeal.fields["EBITDA_GBP"] || selectedDeal.fields["EBITDA"])}</div>
                  </div>
                  <div className="rounded-xl bg-white/[0.02] border border-white/[0.02] p-4">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Asking Price</div>
                    <div className="text-sm font-bold text-white">{formatFinancial(selectedDeal.fields["Asking_Price_GBP"] || selectedDeal.fields["EV Ask"] || selectedDeal.fields["Enterprise_Value"])}</div>
                  </div>
                  <div className="rounded-xl bg-white/[0.02] border border-white/[0.02] p-4">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Sector</div>
                    <div className="text-sm font-bold text-white truncate" title={selectedDeal.fields["Sector"] || selectedDeal.fields["Industry"] || "General"}>
                      {selectedDeal.fields["Sector"] || selectedDeal.fields["Industry"] || "General"}
                    </div>
                  </div>
                </div>
              </div>

              {/* Contact & Source */}
              <div className="space-y-4">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 border-b border-white/[0.05] pb-2">Sourcing & Contact</h4>
                <div className="space-y-3">
                  <div className="flex items-center gap-3 text-xs">
                    <MapPin className="w-4 h-4 text-slate-500 flex-shrink-0" />
                    <span className="text-slate-300">{selectedDeal.fields["Location"] || "Location Unknown"}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <Briefcase className="w-4 h-4 text-slate-500 flex-shrink-0" />
                    <span className="text-slate-300">Broker: {selectedDeal.fields["BROKER"] || "N/A"}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <Mail className="w-4 h-4 text-slate-500 flex-shrink-0" />
                    <span className="text-slate-300">{selectedDeal.fields["Contact E-mail"] || selectedDeal.fields["Contact Email"] || "No Email Provided"}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <Phone className="w-4 h-4 text-slate-500 flex-shrink-0" />
                    <span className="text-slate-300">{selectedDeal.fields["Contact Call Line "] || selectedDeal.fields["Contact Phone"] || "No Phone Provided"}</span>
                  </div>
                  {(selectedDeal.fields["Listing Link"] || selectedDeal.fields["Source"]) && (
                    <div className="flex items-center gap-3 text-xs mt-4 pt-4 border-t border-white/[0.05]">
                      <ExternalLink className="w-4 h-4 text-[#C6A66B] flex-shrink-0" />
                      <a 
                        href={selectedDeal.fields["Listing Link"] || selectedDeal.fields["Source"]} 
                        target="_blank" 
                        rel="noreferrer"
                        className="text-[#C6A66B] font-semibold hover:underline truncate"
                      >
                        View Listing Source
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Long Text Sections */}
            <div className="space-y-6">
              {selectedDeal.fields["Executive Summary"] && (
                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Executive Summary</h4>
                  <div className="bg-white/[0.01] rounded-xl border border-white/[0.02] p-5 text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">
                    {selectedDeal.fields["Executive Summary"]}
                  </div>
                </div>
              )}
              {selectedDeal.fields["Business Description"] && (
                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Business Description</h4>
                  <div className="bg-white/[0.01] rounded-xl border border-white/[0.02] p-5 text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">
                    {selectedDeal.fields["Business Description"]}
                  </div>
                </div>
              )}
            </div>

          </div>
        )}
      </Modal>
    </div>
  );
}

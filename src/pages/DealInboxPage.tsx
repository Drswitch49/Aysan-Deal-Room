import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { 
  Search, AlertTriangle, ChevronLeft, ChevronRight, Inbox, Plus, RefreshCw
} from "lucide-react";
import { getDealInbox } from "../api/airtable";
import { promoteDealFromInbox } from "../api/admin";
import { LoadingState } from "../components/ui/LoadingState";
import { cx } from "../utils/cx";
import { usePipeline } from "../context/PipelineContext";

export function DealInboxPage() {
  const [inboxItems, setInboxItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { refresh: refreshPipeline } = usePipeline();

  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const [promotingId, setPromotingId] = useState<string | null>(null);

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

  const handlePromote = async (id: string, refNo: string) => {
    try {
      setPromotingId(id);
      const res = await promoteDealFromInbox(id);
      if (res.success) {
        // Remove from local state
        setInboxItems((prev) => prev.filter((item) => item.id !== id));
        // Refresh global pipeline
        refreshPipeline();
      } else {
        throw new Error(res.error || "Promotion failed.");
      }
    } catch (err: any) {
      alert("Error promoting deal: " + err.message);
    } finally {
      setPromotingId(null);
    }
  };

  // Filter
  const filteredItems = inboxItems.filter((d: any) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    const name = (d.fields?.["Company Name"] || "").toLowerCase();
    const ref = (d.fields?.["REF. NO"] || "").toLowerCase();
    const sector = (d.fields?.["Sector"] || "").toLowerCase();
    return name.includes(q) || ref.includes(q) || sector.includes(q);
  });

  // Sort: show newer first if we have a created field, but we might just use default Airtable order.
  // Pagination
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
                  <th className="w-[160px] px-5 py-3.5 text-[10px] font-semibold tracking-wide uppercase text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {paginatedItems.map((item) => {
                  const fields = item.fields || {};
                  const isPromoting = promotingId === item.id;
                  
                  // Clean Company Name
                  const rawCompany = fields["Company Name"] || fields["Company_Name"] || "Unknown Company";
                  const companyName = rawCompany.replace(/^[A-Z0-9]+\s*[—\-:]\s*/i, "").trim();

                  return (
                    <tr key={item.id} className="table-row-hover border-b border-white/[0.02]">
                      <td className="px-5 py-4 min-w-0">
                        <div className="font-sans font-semibold text-xs text-white truncate">
                          {companyName}
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
                        {fields["Date_Received"] || fields["Created Date"] || "N/A"}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <button
                          onClick={() => handlePromote(item.id, fields["REF. NO"] || "")}
                          disabled={isPromoting}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#C6A66B]/30 bg-[#C6A66B]/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-[#C6A66B] hover:bg-[#C6A66B]/20 transition-colors disabled:opacity-50 cursor-pointer"
                        >
                          {isPromoting ? (
                            <>
                              <RefreshCw className="h-3 w-3 animate-spin" />
                              Promoting...
                            </>
                          ) : (
                            <>
                              <Plus className="h-3 w-3" />
                              Promote to Active
                            </>
                          )}
                        </button>
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
    </div>
  );
}

import { useState, useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { 
  Search, AlertTriangle, ChevronLeft, ChevronRight, Inbox, Plus, RefreshCw,
  Building2, MapPin, Briefcase, Mail, Phone, ExternalLink, Sparkles, FileText, Trash2,
  Upload, Star
} from "lucide-react";
import { getDealInbox, getDealStageCounts, createInboxDeal, updateInboxDeal } from "../api/airtable";
import { api } from "../api/http";
import { promoteDealFromInbox, transitionDealLifecycle, STATUS_TO_STAGE, deleteInboxDeal, fetchTeamMemberRecords, uploadTempFile, listImDocuments, createImDocument, deleteImDocumentRow } from "../api/admin";
import { LoadingState } from "../components/ui/LoadingState";
import { Modal } from "../components/ui/Modal";
import { FormField } from "../components/ui/FormField";
import { cx } from "../utils/cx";
import { fileNameFromUrl } from "../utils/fileName";
import { usePipeline } from "../context/PipelineContext";
import { ManualNotesTab } from "../components/deals/ManualNotesTab";
import { KillReasonCard } from "../components/deals/KillReasonCard";

// Helper to parse collaborator email or name safely
const getOwnerName = (ownerField: any) => {
  if (!ownerField) return "";
  if (typeof ownerField === "string") return ownerField.trim();
  if (Array.isArray(ownerField)) {
    const first = ownerField[0];
    if (first && typeof first === "object") {
      return first.name || first.email || "";
    }
    return String(first || "").trim();
  }
  if (typeof ownerField === "object") {
    return ownerField.name || ownerField.email || "";
  }
  return String(ownerField).trim();
};

/**
 * Filter pill → lifecycle stage.
 *
 * These used to bucket a client-held page by the legacy free-text `status`
 * field, which is why the inbox reported "Review (10)" while the dashboard —
 * counting the authoritative `stage` enum — reported 983. Both now read the
 * same column, so the two screens agree by construction.
 */
/**
 * Every way a deal row can read as killed — the lifecycle stage, the legacy
 * status text, the pipeline label, or a reason already on record. Deals killed
 * before the lifecycle fix only carry the pipeline label, so a stage-only test
 * would hide their kill reason.
 */
const isDealKilled = (fields: Record<string, any> = {}): boolean =>
  fields["Stage"] === "archived" ||
  String(fields["Status"] || "").toLowerCase() === "kill" ||
  String(fields["Pipeline_Stage"] || "").toLowerCase() === "killed" ||
  Boolean(fields["Kill_Reason"]);

const FILTER_STAGES: Record<string, "inbox" | "review" | "active" | "archived" | undefined> = {
  "All Deals": undefined,
  Active: "active",
  Kill: "archived",
  Review: "review",
  Inbox: "inbox",
  Watchlist: undefined, // resolved by id set, not stage
};

export function DealInboxPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [inboxItems, setInboxItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { refresh: refreshPipeline } = usePipeline();

  const [searchQuery, setSearchQuery] = useState("");
  
  const initialFilterParam = searchParams.get("filter");
  const initialFilter = ["Inbox", "Active", "Kill", "Review", "All Deals", "Watchlist"].includes(initialFilterParam || "")
    ? initialFilterParam!
    : "All Deals";

  const [activeFilter, setActiveFilter] = useState(initialFilter);

  useEffect(() => {
    const filterParam = searchParams.get("filter");
    if (filterParam && ["Inbox", "Active", "Kill", "Review", "All Deals", "Watchlist"].includes(filterParam)) {
      setActiveFilter(filterParam);
    }
  }, [searchParams]);

  // Watchlist ("starred" deals) — persisted per-browser in localStorage so a user's
  // important deals survive reloads without a backend/schema change.
  const WATCHLIST_KEY = "deal_inbox_watchlist";
  const [watchlist, setWatchlist] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(WATCHLIST_KEY);
      return new Set<string>(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set<string>();
    }
  });

  const toggleWatchlist = (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // don't open the row's detail modal
    setWatchlist((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(WATCHLIST_KEY, JSON.stringify([...next]));
      } catch {
        /* storage unavailable — keep in-memory only */
      }
      return next;
    });
  };
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 25;
  /** Total matching rows in the database, not just the loaded page. */
  const [totalItems, setTotalItems] = useState(0);
  const [stageCounts, setStageCounts] = useState<{
    total: number;
    byStage: { inbox: number; review: number; active: number; archived: number };
    unassigned: number;
  } | null>(null);

  const [promotingId, setPromotingId] = useState<string | null>(null);

  // Detail Modal States
  const [selectedDeal, setSelectedDeal] = useState<any | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  const [teamMembers, setTeamMembers] = useState<any[]>([]);

  useEffect(() => {
    const loadTeamMembers = async () => {
      try {
        setTeamMembers(await fetchTeamMemberRecords());
      } catch (err) {
        console.error("Failed to load team members in inbox:", err);
      }
    };
    loadTeamMembers();
  }, []);

  const eligibleUsers = useMemo(() => {
    return teamMembers
      .filter((member: any) => member.fields?.Status !== "Inactive")
      .map((member: any) => member.fields?.Name)
      .filter(Boolean);
  }, [teamMembers]);

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<any | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  // IM/Review docs as loaded from the table when the edit modal opened — used to
  // diff on save (delete rows the user removed, create rows they added).
  const [editImDocsOriginal, setEditImDocsOriginal] = useState<any[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    refNo: "", dealName: "", companyName: "", sector: "", location: "", broker: "", status: "Inbox",
    imReviewDocs: [] as any[],
    executiveSummary: "", businessDescription: "", ebitda: "", revenue: "", askingPrice: "", enterpriseValue: "", contactName: "", contactEmail: "", contactPhone: "",
    owner: ""
  });
  const [submittingDeal, setSubmittingDeal] = useState(false);

  const openAddModal = () => {
    setFormData({
      refNo: "", dealName: "", companyName: "", sector: "", location: "", broker: "", status: "Inbox",
      imReviewDocs: [],
      executiveSummary: "", businessDescription: "", ebitda: "", revenue: "", askingPrice: "", enterpriseValue: "", contactName: "", contactEmail: "", contactPhone: "",
      owner: ""
    });
    setEditImDocsOriginal([]);
    setIsAddModalOpen(true);
  };

  const openEditModal = async (deal: any, e: any) => {
    e.stopPropagation();
    setEditingDeal(deal);
    setEditImDocsOriginal([]);

    setFormData({
      refNo: deal.fields["REF. NO"] || "",
      imReviewDocs: [],
      dealName: deal.fields["Deal Name"] || "",
      companyName: deal.fields["Company Name"] || deal.fields["Company_Name"] || "",
      sector: deal.fields["Sector"] || "",
      location: deal.fields["Location"] || "",
      broker: deal.fields["Broker"] || deal.fields["BROKER"] || "",
      status: deal.fields["Status"] || "Inbox",
      executiveSummary: deal.fields["Summary"] || deal.fields["Description"] || deal.fields["Executive_Summary"] || "",
      businessDescription: deal.fields["Business_Description"] || "",
      ebitda: deal.fields["EBITDA_GBP"] || "",
      revenue: deal.fields["Turnover"] || "",
      askingPrice: deal.fields["Asking_Price_GBP"] || "",
      enterpriseValue: deal.fields["Enterprise_Value"] || "",
      contactName: deal.fields["Contact_Name"] || "",
      contactEmail: deal.fields["Contact_Email"] || "",
      contactPhone: deal.fields["Contact_Phone"] || "",
      owner: getOwnerName(deal.fields["Owner"]) || getOwnerName(deal.fields["Assigned To"]) || ""
    });
    setIsEditModalOpen(true);

    // Load this deal's IM/Review files from the table so the full list (with each
    // file's real name) shows, and we can diff against it on save.
    try {
      const docs = await listImDocuments(deal.id);
      setFormData(prev => ({ ...prev, imReviewDocs: docs }));
      setEditImDocsOriginal(docs);
    } catch (err) {
      console.error("Failed to load IM documents:", err);
    }
  };

  const openDetailModal = async (item: any) => {
    setSelectedDeal({ ...item, imDocs: [] });
    setIsModalOpen(true);
    try {
      const docs = await listImDocuments(item.id);
      setSelectedDeal((prev: any) => (prev && prev.id === item.id ? { ...prev, imDocs: docs } : prev));
    } catch (err) {
      console.error("Failed to load IM documents:", err);
    }
  };

  const handleDownloadDoc = async (docId: string | undefined, name: string) => {
    if (!docId) { alert("This file has no id and can't be downloaded."); return; }
    setDownloadingId(docId);
    // Open the tab synchronously (within the click gesture) so it isn't popup-blocked
    // after the async fetch; then point it at the signed URL once we have it.
    const win = window.open("", "_blank");
    try {
      // Authenticated Cloudinary assets need a short-lived signed URL — the server
      // builds one (private_download_url) that forces an attachment download.
      const res = await api.get<{ url: string }>(`/api/im-documents/download?id=${encodeURIComponent(docId)}`, { noCache: true });
      const url = res?.url;
      if (!url) throw new Error("No download URL returned.");
      if (win) {
        win.location.href = url;
      } else {
        // Popup blocked — fall back to a same-tab anchor click.
        const a = document.createElement("a");
        a.href = url;
        a.rel = "noreferrer";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (err: any) {
      if (win) win.close();
      alert("Download failed: " + (err.message || "unknown error"));
    } finally {
      setDownloadingId(null);
    }
  };

  const handleRemoveAttachment = async (docId: string | undefined, filename: string) => {
    if (!selectedDeal) return;
    if (!docId) { alert("This attachment has no id and can't be removed here."); return; }
    if (!confirm(`Are you sure you want to delete ${filename}?`)) return;
    try {
      await deleteImDocumentRow(docId);

      // Update selectedDeal state locally so the list updates immediately.
      const remaining = (selectedDeal.imDocs || []).filter((d: any) => d.id !== docId);
      const updatedDeal = { ...selectedDeal, imDocs: remaining };
      setSelectedDeal(updatedDeal);
    } catch (err: any) {
      alert("Error deleting document: " + err.message);
    }
  };

  const handleRemoveFormDoc = (idx: number) => {
    setFormData(prev => ({
      ...prev,
      imReviewDocs: prev.imReviewDocs.filter((_, i) => i !== idx)
    }));
  };

  const handleReplaceFormDoc = async (idx: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64data = reader.result as string;
        try {
          const raw = base64data.includes(",") ? base64data.split(",")[1] : base64data;
          const data = await uploadTempFile(file.name, file.type, raw);
          setFormData(prev => {
            const updated = [...prev.imReviewDocs];
            updated[idx] = { url: data.url, filename: file.name, publicId: data.publicId };
            return { ...prev, imReviewDocs: updated };
          });
        } catch {
          alert("File replacement failed.");
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error(err);
      alert("Error replacing file");
    } finally {
      setIsUploading(false);
    }
  };

  const handleAddFormDoc = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64data = reader.result as string;
        try {
          const raw = base64data.includes(",") ? base64data.split(",")[1] : base64data;
          const data = await uploadTempFile(file.name, file.type, raw);
          setFormData(prev => ({
            ...prev,
            imReviewDocs: [...prev.imReviewDocs, { url: data.url, filename: file.name, publicId: data.publicId }]
          }));
        } catch {
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
        "Company_Name": formData.companyName,
        "Sector": formData.sector,
        "Location": formData.location,
        "BROKER": formData.broker,
        // "Status" is deliberately NOT written here. It is a lifecycle move,
        // not a text field: writing it alone left `stage` untouched, so the
        // deal kept its old stage while the stored text claimed otherwise —
        // which is how ~30 deals ended up sitting in `inbox` labelled "Active".
        // The transition below does it properly.
        "Summary": formData.executiveSummary,
        "Description": formData.businessDescription,
        "EBITDA_GBP": Number(formData.ebitda) || undefined,
        "Turnover": Number(formData.revenue) || undefined,
        "Asking_Price_GBP": Number(formData.askingPrice) || undefined,
        "Enterprise_Value": Number(formData.enterpriseValue) || undefined,
        "Contact_Name": formData.contactName,
        "Contact_Email": formData.contactEmail,
        "Contact_Phone": formData.contactPhone,
        "Owner": formData.owner,
        "Assigned To": formData.owner,
      };

      // Save the deal fields, then resolve the deal id to sync IM/Review files.
      let dealId: string | undefined = editingDeal?.id;
      if (isAddModalOpen) {
        const created = await createInboxDeal(payload);
        dealId = created?.id ?? created?.deal?.id ?? created?.result?.id;
      } else if (isEditModalOpen && editingDeal) {
        await updateInboxDeal(editingDeal.id, payload);
        dealId = editingDeal.id;
      }

      // Apply the chosen status as a real lifecycle transition, so the deal
      // actually moves stage (and shows the right one afterwards).
      const targetStage = STATUS_TO_STAGE[formData.status];
      const currentStage = editingDeal?.fields?.Stage ?? (isAddModalOpen ? "inbox" : undefined);
      if (dealId && targetStage && targetStage !== currentStage) {
        let killReason: string | undefined;
        if (formData.status === "Kill") {
          const entered = prompt(
            "Why is this deal being killed? The reason is stored on the deal and shown in its details.",
            String(editingDeal?.fields?.Kill_Reason ?? ""),
          );
          // Cancelling the reason cancels only the status change — the field
          // edits the user already made are saved above and stay saved.
          if (entered !== null && entered.trim()) killReason = entered.trim();
        }
        if (formData.status !== "Kill" || killReason) {
          await transitionDealLifecycle(dealId, formData.status, { currentStage, killReason });
          refreshPipeline(); // the Active Deals page counts the same stage
        }
      }

      // Sync IM/Review files to the im_review_documents table (multi-file):
      // create the ones the user added, delete the ones they removed.
      if (dealId) {
        const current = formData.imReviewDocs || [];
        const currentIds = new Set(current.filter((d: any) => d.id).map((d: any) => d.id));
        const toDelete = editImDocsOriginal.filter((o: any) => o.id && !currentIds.has(o.id));
        const toCreate = current.filter((d: any) => !d.id && d.url);
        await Promise.all([
          ...toDelete.map((o: any) => deleteImDocumentRow(o.id)),
          ...toCreate.map((d: any) => createImDocument(dealId!, d)),
        ]);
      }

      setIsAddModalOpen(false);
      setIsEditModalOpen(false);
      await fetchInbox();
      refreshCounts();
    } catch (err: any) {
      alert(err.message || "Error saving deal");
    } finally {
      setSubmittingDeal(false);
    }
  };

  // Specific status options for Deal Inbox
  const statusOptions = ["Active", "Kill", "Review", "Inbox"];

  // Debounce typing so each keystroke doesn't fire a query against ~1.8k rows.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const fetchInbox = async () => {
    try {
      setLoading(true);
      setError(null);

      const isWatchlist = activeFilter === "Watchlist";
      const { rows, total } = await getDealInbox({
        stage: FILTER_STAGES[activeFilter],
        search: debouncedSearch || undefined,
        ids: isWatchlist ? [...watchlist] : undefined,
        limit: itemsPerPage,
        offset: (currentPage - 1) * itemsPerPage,
      });
      setInboxItems(rows || []);
      setTotalItems(total);
    } catch (err: any) {
      console.error("Failed to load deal inbox:", err);
      setError(err.message || "Failed to load deal inbox.");
    } finally {
      setLoading(false);
    }
  };

  // Starring changes which rows the Watchlist filter should return, but only
  // matters while that filter is the active one.
  const watchlistKey = activeFilter === "Watchlist" ? [...watchlist].sort().join(",") : "";

  // Re-query whenever the filter, page or (debounced) search changes.
  // Page resets live on the controls themselves (pill onClick / search onChange),
  // so this doesn't also fire a redundant fetch for a stale page number.
  useEffect(() => {
    fetchInbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilter, currentPage, debouncedSearch, watchlistKey]);

  const countsQuery = () => ({
    search: debouncedSearch || undefined,
    stage: FILTER_STAGES[activeFilter],
    ids: activeFilter === "Watchlist" ? [...watchlist] : undefined,
  });

  const refreshCounts = () => {
    getDealStageCounts(countsQuery())
      .then(setStageCounts)
      .catch((err) => console.error("Failed to load deal counts:", err));
  };

  // Pill counts and the unassigned tally come from the server so they describe
  // the whole table rather than the current page, and follow the active
  // search/filter so they always match the list beneath them.
  useEffect(() => {
    let alive = true;
    getDealStageCounts(countsQuery())
      .then((c) => { if (alive) setStageCounts(c); })
      .catch((err) => console.error("Failed to load deal counts:", err));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, activeFilter, watchlistKey]);


  const handlePromote = async (id: string) => {
    try {
      setPromotingId(id);
      const res = await promoteDealFromInbox(id);
      if (res.success) {
        refreshPipeline();
        setIsModalOpen(false);
        // The deal has left this stage — reload the page and pill counts.
        await fetchInbox();
        refreshCounts();
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
    const currentStage = selectedDeal.fields?.Stage || "";

    if (newStatus === "Active") {
      // Promoting the deal to Active Pipeline
      if (confirm("Setting status to 'Active' will migrate this deal to the Active Pipeline. Continue?")) {
        handlePromote(selectedDeal.id);
      }
      return;
    }

    // The kill reason is shown back on the deal's detail page, so it is
    // collected here rather than being left blank for inbox-side kills.
    let killReason: string | undefined;
    if (newStatus === "Kill") {
      const entered = prompt(
        "Why is this deal being killed? The reason is stored on the deal and shown in its details.",
        selectedDeal.fields?.Kill_Reason || "",
      );
      if (entered === null) return; // cancelled
      killReason = entered.trim();
      if (!killReason) {
        alert("A kill reason is required.");
        return;
      }
    }

    try {
      setIsUpdatingStatus(true);
      // Moves the lifecycle stage, not just the legacy status text — the filters
      // and the dashboard both count `stage`, so a status-only write would leave
      // the deal sitting in the wrong bucket.
      await transitionDealLifecycle(selectedDeal.id, newStatus, { currentStage, killReason });

      const updatedItem = {
        ...selectedDeal,
        fields: {
          ...selectedDeal.fields,
          Status: newStatus,
          Stage: STATUS_TO_STAGE[newStatus] ?? currentStage,
          ...(killReason ? { Kill_Reason: killReason } : {}),
        },
      };
      setSelectedDeal(updatedItem);

      // The deal may no longer belong in the current filter — refresh the page
      // and the pill counts rather than leaving a stale row behind.
      await fetchInbox();
      refreshCounts();
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
      await fetchInbox();
      refreshCounts();
    } catch (err: any) {
      alert("Error deleting deal: " + err.message);
      setLoading(false);
    }
  };

  // Filtering, searching and paging all happen server-side now — the rows in
  // state are exactly the page being displayed.
  const paginatedItems = inboxItems;

  // Deals in the current filter with nobody assigned. This was previously
  // rendered as filteredItems.length — the total row count — so it always
  // equalled the number of deals on screen no matter how many were assigned.
  // Counted server-side, since the page holds only 25 of ~1.8k rows.
  const unassignedCount = stageCounts?.unassigned ?? null;

  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;

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

  const filters = ["All Deals", "Active", "Kill", "Review", "Inbox", "Watchlist"];

  const getFilterCount = (filterName: string): number | null => {
    if (filterName === "Watchlist") return watchlist.size;
    if (!stageCounts) return null; // counts still loading — render the pill without a number
    if (filterName === "All Deals") return stageCounts.total;
    const stage = FILTER_STAGES[filterName];
    return stage ? stageCounts.byStage[stage] ?? 0 : 0;
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

      {/* Filter Row */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
        {filters.map((f) => {
          const count = getFilterCount(f);
          return (
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
              {f}{count === null ? "" : ` (${count})`}
            </button>
          );
        })}
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
            Unassigned:{" "}
            <span className="text-slate-300">
              {unassignedCount === null ? "—" : unassignedCount.toLocaleString()}
            </span>
            <span className="text-slate-600"> of {totalItems.toLocaleString()}</span>
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
            <table className="w-full text-left border-collapse table-fixed min-w-[1080px]">
              <thead>
                <tr className="border-b border-white/[0.05] bg-white/[0.02] select-none text-slate-450">
                  <th className="w-[340px] px-5 py-3.5 text-[10px] font-bold tracking-[0.14em] uppercase">Company</th>
                  <th className="w-[120px] px-4 py-3.5 text-[10px] font-bold tracking-[0.14em] uppercase">Sector</th>
                  <th className="w-[100px] px-4 py-3.5 text-[10px] font-bold tracking-[0.14em] uppercase text-right">Turnover</th>
                  <th className="w-[100px] px-4 py-3.5 text-[10px] font-bold tracking-[0.14em] uppercase text-right">EBITDA</th>
                  <th className="w-[110px] px-4 py-3.5 text-[10px] font-bold tracking-[0.14em] uppercase text-right">Asking Price</th>
                  <th className="w-[150px] px-5 py-3.5 text-[10px] font-bold tracking-[0.14em] uppercase text-right">Assigned To</th>
                  <th className="w-[90px] px-4 py-3.5 text-[10px] font-bold tracking-[0.14em] uppercase text-center">Watchlist</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {paginatedItems.map((item) => {
                  const fields = item.fields || {};
                  const isPromoting = promotingId === item.id;
                  const companyName = getCompanyName(fields);
                  const assignee = getOwnerName(fields.Owner) || getOwnerName(fields["Assigned To"]) || "";
                  const isStarred = watchlist.has(item.id);

                  return (
                    <tr
                      key={item.id}
                      className="table-row-hover border-b border-white/[0.03] cursor-pointer transition-colors hover:bg-white/[0.02]"
                      onClick={() => openDetailModal(item)}
                    >
                      <td className="px-5 py-4 align-middle">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-acp-bronze/10 border border-acp-bronze/20 text-[11px] font-bold uppercase text-acp-bronze">
                            {companyName.slice(0, 2)}
                          </div>
                          <div className="min-w-0">
                            <div className="font-sans font-semibold text-[13px] leading-snug text-white flex items-start gap-1.5">
                              <span className="break-words">{companyName}</span>
                              {fields["AI_Verdict"] && <span title="AI Reviewed" className="mt-0.5"><Sparkles className="w-3 h-3 text-acp-bronze flex-shrink-0" /></span>}
                            </div>
                            <p className="mt-1 text-[10px] text-slate-500 leading-tight flex items-center gap-1">
                              <MapPin className="w-2.5 h-2.5 shrink-0 text-slate-600" />
                              <span className="truncate">{fields["Location"] || "Unknown"} · Ref: {fields["REF. NO"] || "N/A"}</span>
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 select-none align-middle">
                        <span className="inline-flex items-center rounded-full bg-slate-500/10 border border-slate-500/20 px-2.5 py-0.5 text-[10px] font-semibold text-slate-300">
                          {fields["Sector"] || fields["Industry"] || "General"}
                        </span>
                      </td>
                      <td className="px-4 py-4 font-sans text-xs font-semibold text-white text-right tabular-nums align-middle">
                        {formatFinancial(fields["Turnover"] || fields["Revenue"] || fields["Sales"])}
                      </td>
                      <td className="px-4 py-4 font-sans text-xs font-semibold text-white text-right tabular-nums align-middle">
                        {formatFinancial(fields["EBITDA_GBP"] || fields["EBITDA"])}
                      </td>
                      <td className="px-4 py-4 font-sans text-xs font-semibold text-white text-right tabular-nums align-middle">
                        {formatFinancial(fields["Asking_Price_GBP"] || fields["Asking Price"] || fields["EV Ask"] || fields["Enterprise_Value"])}
                      </td>
                      <td className="px-5 py-4 text-right select-none align-middle">
                        <span className={cx(
                          "inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold border",
                          assignee
                            ? "bg-blue-500/5 border-blue-500/25 text-blue-400"
                            : "bg-slate-500/5 border-slate-500/20 text-slate-500"
                        )}>
                          {assignee || "Unassigned"}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-center select-none align-middle">
                        <button
                          type="button"
                          onClick={(e) => toggleWatchlist(item.id, e)}
                          title={isStarred ? "Remove from watchlist" : "Add to watchlist"}
                          aria-pressed={isStarred}
                          className={cx(
                            "inline-flex h-8 w-8 items-center justify-center rounded-lg transition cursor-pointer",
                            isStarred ? "bg-acp-bronze/10 hover:bg-acp-bronze/20" : "hover:bg-white/[0.05]"
                          )}
                        >
                          <Star
                            className={cx(
                              "h-4 w-4 transition",
                              isStarred ? "text-acp-bronze fill-acp-bronze" : "text-slate-500 hover:text-slate-300"
                            )}
                          />
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {inboxItems.length === 0 && (
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
                Showing {totalItems === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1}–{Math.min(currentPage * itemsPerPage, totalItems)} of {totalItems.toLocaleString()}
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

            {/* Kill Reason — always shown for a killed deal, wherever it was
                killed (inbox or Active Pipeline), blank reason included. */}
            {isDealKilled(selectedDeal.fields) && (
              <KillReasonCard
                reason={String(selectedDeal.fields["Kill_Reason"] || "")}
                killedBy={String(selectedDeal.fields["Killed_By"] || "")}
                killDate={String(selectedDeal.fields["Kill_Date"] || "")}
                onSave={async (next) => {
                  await updateInboxDeal(selectedDeal.id, { kill_reason_text: next });
                  setSelectedDeal({
                    ...selectedDeal,
                    fields: { ...selectedDeal.fields, Kill_Reason: next },
                  });
                  await fetchInbox();
                }}
              />
            )}

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

              {/* Manual Notes Section */}
              <div className="min-w-0 pt-6 border-t border-white/[0.05]">
                <ManualNotesTab dealRef={selectedDeal.id} />
              </div>

              {/* IM & Review Documents Section */}
              <div className="space-y-4 min-w-0 border-t border-white/[0.05] pt-6">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">IM & Review Documents</h4>
                {(() => {
                  const docsList = (selectedDeal.imDocs || []).filter((doc: any) => doc.url);

                  if (docsList.length === 0) {
                    return <p className="text-xs text-slate-500 italic">No IM documents attached to this deal.</p>;
                  }
                  
                  return (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
                      {docsList.map((att: any, idx: number) => {
                        const name = att.filename || `IM_Document_${idx + 1}`;
                        return (
                          <div key={att.id || idx} className="flex items-center justify-between bg-white/[0.01] border border-white/[0.02] p-4 rounded-xl hover:bg-white/[0.03] transition min-w-0">
                            <div className="flex items-center gap-3 min-w-0 flex-1 pr-2">
                              <FileText className="w-5 h-5 text-acp-bronze flex-shrink-0" />
                              <div className="text-xs text-white truncate font-medium" title={name}>
                                {name}
                              </div>
                            </div>
                            <div className="flex items-center gap-3 flex-shrink-0">
                              <button
                                type="button"
                                onClick={() => handleDownloadDoc(att.id, name)}
                                disabled={downloadingId === att.id}
                                className="text-xs text-[#C6A66B] hover:text-white font-bold select-none disabled:opacity-50 disabled:cursor-wait"
                              >
                                {downloadingId === att.id ? "Preparing…" : "Download"}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveAttachment(att.id, name)}
                                className="text-xs text-rose-500 hover:text-rose-450 font-bold select-none"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-1">
              <FormField label="Reference No. (Optional)" id="modal-ref">
                <input id="modal-ref" type="text" value={formData.refNo} onChange={e => setFormData({...formData, refNo: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-acp-bronze/50 transition-colors" placeholder="e.g. ACP-CFS-018" />
              </FormField>
            </div>
            <div className="sm:col-span-2">
              <FormField label="Deal Name" id="modal-name">
                <input id="modal-name" type="text" value={formData.dealName} onChange={e => setFormData({...formData, dealName: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-acp-bronze/50 transition-colors" required placeholder="e.g. ACP-CFS-018 - Acme Corp" />
              </FormField>
            </div>
          </div>
          
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

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <FormField label="Broker" id="modal-broker">
              <input id="modal-broker" type="text" value={formData.broker} onChange={e => setFormData({...formData, broker: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-acp-bronze/50 transition-colors" placeholder="e.g. John Doe" />
            </FormField>
            <FormField label="Status" id="modal-status">
              <select id="modal-status" value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-acp-bronze/50 transition-colors">
                {statusOptions.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            </FormField>
            <FormField label="Assigned To" id="modal-owner">
              <select id="modal-owner" value={formData.owner} onChange={e => setFormData({...formData, owner: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-acp-bronze/50 transition-colors">
                <option value="">Unassigned</option>
                {eligibleUsers.map((name: string) => <option key={name} value={name}>{name}</option>)}
              </select>
            </FormField>
          </div>

          {/* IM & Attachments Section */}
          <div className="space-y-3 pt-2 border-t border-white/[0.02]">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">IM & Attachments</p>
            
            {/* List of existing files */}
            {formData.imReviewDocs && formData.imReviewDocs.length > 0 && (
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {formData.imReviewDocs.map((att: any, idx: number) => (
                  <div key={att.id || idx} className="flex items-center justify-between p-2 rounded-lg bg-white/[0.015] border border-white/5 text-[11px]">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="h-3.5 w-3.5 text-[#C6A66B] shrink-0" />
                      <span className="text-white truncate font-medium">{att.filename || "IM_Document"}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="text-[10px] font-bold text-[#C6A66B] hover:text-white cursor-pointer select-none">
                        Replace
                        <input
                          type="file"
                          accept=".pdf,.doc,.docx,.xls,.xlsx"
                          className="hidden"
                          onChange={(e) => handleReplaceFormDoc(idx, e)}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => handleRemoveFormDoc(idx)}
                        className="text-[10px] font-bold text-rose-500 hover:text-rose-450 select-none"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add new attachment input */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <label className="flex-1 h-9 rounded-xl border border-dashed border-white/10 hover:border-white/20 bg-[#0B0B0C]/40 flex items-center justify-center gap-2 text-xs text-slate-450 cursor-pointer select-none">
                  <Upload className="h-3.5 w-3.5 text-slate-500" />
                  <span>Upload New Attachment</span>
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx,.xls,.xlsx"
                    className="hidden"
                    onChange={handleAddFormDoc}
                  />
                </label>
              </div>
              
              <div className="flex items-center gap-2">
                <input
                  type="url"
                  id="modal-add-url"
                  placeholder="Or paste URL to add..."
                  className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-acp-bronze/50 transition-colors"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const input = e.currentTarget;
                      const val = input.value.trim();
                      if (val) {
                        try {
                          new URL(val);
                          setFormData(prev => ({
                            ...prev,
                            imReviewDocs: [...prev.imReviewDocs, { url: val, filename: fileNameFromUrl(val) }]
                          }));
                          input.value = "";
                        } catch {
                          alert("Please enter a valid URL.");
                        }
                      }
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    const input = document.getElementById("modal-add-url") as HTMLInputElement;
                    const val = input?.value.trim();
                    if (val) {
                      try {
                        new URL(val);
                        setFormData(prev => ({
                          ...prev,
                          imReviewDocs: [...prev.imReviewDocs, { url: val, filename: val.split("/").pop() || "Document" }]
                        }));
                        if (input) input.value = "";
                      } catch {
                        alert("Please enter a valid URL.");
                      }
                    }
                  }}
                  className="px-3 h-8 bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-300 rounded-lg transition-colors border border-white/10"
                >
                  Add URL
                </button>
              </div>
            </div>
            {isUploading && (
              <span className="text-[10px] text-acp-bronze animate-pulse font-medium">Uploading file...</span>
            )}
          </div>
        </div>
      </Modal>

    </div>
  );
}

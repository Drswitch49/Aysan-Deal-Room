import { Filter, Files, ShieldAlert, FileText, FileSpreadsheet, FileArchive, CheckCircle2, Search, X, Calendar, User, History, Download, ExternalLink, Plus, FileWarning, Loader2, Sparkles, BrainCircuit, Upload, Trash2 } from "lucide-react";
import { useMemo, useState, useEffect, useCallback } from "react";
import type { DealDocument } from "../../types/deal";
import { updateAdminDocuments, createAdminDocument, uploadAdminDocument, analyzeAdminDocument, parseAdminDocument, getJobStatus, deleteAdminDocument } from "../../api/admin";
import { getDriveDownloadUrl, getDriveViewUrl } from "../../utils/drive";
import { formatDate, uniqueSorted } from "../../utils/fields";
import { isSentToLender } from "../../utils/security";
import { Badge, StatusBadge } from "../ui/Badge";
import { ButtonLink } from "../ui/ButtonLink";
import { EmptyState } from "../ui/EmptyState";
import { ProgressBar, ProgressRing } from "../ui/ProgressBar";
import { Table, Td, Th } from "../ui/Table";
import { cx } from "../../utils/cx";

type DocumentChecklistProps = {
  documents: DealDocument[];
  audience: "internal" | "lender";
  onRefresh?: () => void;
  dealId?: string;
};

// Maps document categories or extensions to premium lucide icons
function getDocIcon(name: string = "", category: string = "") {
  const normName = name.toLowerCase();
  const normCat = category.toLowerCase();
  if (normName.includes("model") || normName.includes("financial") || normName.includes("projection") || normCat.includes("financial") || normName.includes("xls")) {
    return <FileSpreadsheet className="h-4 w-4 text-emerald-500" />;
  }
  if (normName.includes("zip") || normName.includes("rar") || normName.includes("archive")) {
    return <FileArchive className="h-4 w-4 text-amber-600" />;
  }
  return <FileText className="h-4 w-4 text-acp-bronze" />;
}

export function DocumentChecklist({ documents, audience, onRefresh, dealId }: DocumentChecklistProps) {
  const [statusFilter, setStatusFilter] = useState("All");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDoc, setSelectedDoc] = useState<(DealDocument & { indexRef: string }) | null>(null);

  // Multi-select and Link Editor states
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBatchUpdating, setIsBatchUpdating] = useState(false);
  const [draftLink, setDraftLink] = useState("");
  const [isSavingLink, setIsSavingLink] = useState(false);

  // Deletion states
  const [docToDelete, setDocToDelete] = useState<DealDocument | null>(null);
  const [isDeletingDoc, setIsDeletingDoc] = useState(false);

  const handleDeleteDocConfirm = async () => {
    if (!docToDelete) return;
    setIsDeletingDoc(true);
    try {
      await deleteAdminDocument(docToDelete.id);
      setDocToDelete(null);
      // Close drawer if the deleted document was currently open
      if (selectedDoc?.id === docToDelete.id) {
        setSelectedDoc(null);
      }
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error("Failed to delete document:", err);
      alert(err instanceof Error ? err.message : "Failed to delete document");
    } finally {
      setIsDeletingDoc(false);
    }
  };

  // Create document states
  const [isAddDocOpen, setIsAddDocOpen] = useState(false);
  const [newDocName, setNewDocName] = useState("");
  const [newDocCategory, setNewDocCategory] = useState("Financial");
  const [customCategory, setCustomCategory] = useState("");
  const [newDocStatus, setNewDocStatus] = useState("Outstanding");
  const [newDocLink, setNewDocLink] = useState("");
  const [newDocCritical, setNewDocCritical] = useState(false);
  const [isSubmittingDoc, setIsSubmittingDoc] = useState(false);
  const [docErrorMessage, setDocErrorMessage] = useState("");

  // Upload and Preview/AI states
  const [uploadMode, setUploadMode] = useState<"link" | "upload">("link");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFileDataBase64, setSelectedFileDataBase64] = useState<string>("");
  const [previewDoc, setPreviewDoc] = useState<DealDocument | null>(null);
  const [previewText, setPreviewText] = useState<string>("");
  const [loadingPreviewText, setLoadingPreviewText] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<any | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Parse (text extraction) states
  const [isParsing, setIsParsing] = useState(false);
  const [parseResult, setParseResult] = useState<{ characterCount: number; wordCount: number; fileType: string } | null>(null);
  const [parseError, setParseError] = useState<string>("");

  // Async job polling — tracks in-flight QStash job IDs
  const [pendingParseJobId, setPendingParseJobId] = useState<{ recordId: string; table: string } | null>(null);
  const [pendingAnalysisJobId, setPendingAnalysisJobId] = useState<{ recordId: string; table: string } | null>(null);
  const [parseJobStatus, setParseJobStatus] = useState<string>("");
  const [analysisJobStatus, setAnalysisJobStatus] = useState<string>("");

  // Poll for parse job completion
  useEffect(() => {
    if (!pendingParseJobId) return;
    const { recordId, table } = pendingParseJobId;
    const interval = setInterval(async () => {
      try {
        const s = await getJobStatus(table, recordId);
        const label: Record<string, string> = {
          queued: "Queued…",
          processing: "Extracting…",
          extracted: "Extracted ✓",
          completed: "Extracted ✓",
          failed: "Extraction failed",
        };
        setParseJobStatus(label[s.status] ?? s.status);
        if (s.isComplete) {
          setParseResult({ characterCount: 0, wordCount: 0, fileType: "extracted" });
          setIsParsing(false);
          setPendingParseJobId(null);
          clearInterval(interval);
          if (onRefresh) onRefresh();
        } else if (s.isFailed) {
          setParseError(s.error || "Text extraction failed.");
          setIsParsing(false);
          setPendingParseJobId(null);
          clearInterval(interval);
        }
      } catch {
        // Network glitch — keep polling
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [pendingParseJobId, onRefresh]);

  // Poll for AI analysis job completion
  useEffect(() => {
    if (!pendingAnalysisJobId) return;
    const { recordId, table } = pendingAnalysisJobId;
    const interval = setInterval(async () => {
      try {
        const s = await getJobStatus(table, recordId);
        const label: Record<string, string> = {
          queued: "Queued…",
          processing: "Analyzing…",
          analyzing: "Analyzing…",
          completed: "Analysis complete ✓",
          failed: "Analysis failed",
        };
        setAnalysisJobStatus(label[s.status] ?? s.status);
        if (s.isComplete) {
          // Refresh to load the completed analysis result from Airtable
          setIsAnalyzing(false);
          setPendingAnalysisJobId(null);
          clearInterval(interval);
          if (onRefresh) onRefresh();
        } else if (s.isFailed) {
          setIsAnalyzing(false);
          setPendingAnalysisJobId(null);
          clearInterval(interval);
          alert(s.error || "AI Analysis failed.");
        }
      } catch {
        // Network glitch — keep polling
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [pendingAnalysisJobId, onRefresh]);

  // Fetch text preview content
  useEffect(() => {
    if (!previewDoc || !previewDoc.driveLink) {
      setPreviewText("");
      setAiAnalysis(null);
      return;
    }
    // Clean query parameters and extract file extension from URL/pathname
    let ext = "";
    try {
      const urlObj = new URL(previewDoc.driveLink);
      ext = urlObj.pathname.split(".").pop()?.toLowerCase() || "";
    } catch {
      const cleanLink = previewDoc.driveLink.split("?")[0];
      ext = cleanLink.split(".").pop()?.toLowerCase() || "";
    }

    const isHttpOrUpload = previewDoc.driveLink.startsWith("http://") || 
                           previewDoc.driveLink.startsWith("https://") || 
                           previewDoc.driveLink.startsWith("/uploads/");
    const isTextDoc = ["txt", "csv", "json", "md"].includes(ext);

    if (isHttpOrUpload && isTextDoc) {
      setLoadingPreviewText(true);
      fetch(previewDoc.driveLink)
        .then(res => res.text())
        .then(text => {
          setPreviewText(text);
          setLoadingPreviewText(false);
        })
        .catch(err => {
          console.error("Failed to load text preview:", err);
          setPreviewText("Failed to load file preview contents.");
          setLoadingPreviewText(false);
        });
    } else {
      setPreviewText("");
    }
    setAiAnalysis(null);
  }, [previewDoc]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      // Auto fill name
      const cleanName = file.name.substring(0, file.name.lastIndexOf(".")) || file.name;
      setNewDocName(cleanName);

      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setSelectedFileDataBase64(event.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleViewClick = (e: React.MouseEvent, doc: DealDocument) => {
    if (!doc.driveLink || doc.driveLink.trim() === "") {
      handleDocActionClick(e, doc, "view");
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    setPreviewDoc(doc);
  };

  const handleParseDocument = async (docId?: string) => {
    const id = docId || previewDoc?.id;
    if (!id) return;
    setIsParsing(true);
    setParseError("");
    setParseResult(null);
    setParseJobStatus("");
    try {
      const res = await parseAdminDocument(id);
      if (res.status === "queued") {
        // 202 — job queued with QStash. Start polling.
        setParseJobStatus("Queued…");
        setPendingParseJobId({ recordId: id, table: "Documents" });
        // isParsing stays true until polling completes
      } else {
        // 200 — synchronous result (local dev, no QStash)
        setParseResult({ characterCount: res.characterCount, wordCount: res.wordCount, fileType: res.fileType });
        setIsParsing(false);
        if (onRefresh) onRefresh();
      }
    } catch (err: any) {
      console.error("Document parse failed:", err);
      setParseError(err.message || "Text extraction failed.");
      setIsParsing(false);
    }
  };

  const handleRunAiAnalysis = async () => {
    if (!previewDoc) return;
    setIsAnalyzing(true);
    setAiAnalysis(null);
    setAnalysisJobStatus("");
    try {
      const res = await analyzeAdminDocument(previewDoc.id);
      if (res.status === "queued") {
        // 202 — job queued with QStash. Start polling.
        setAnalysisJobStatus("Queued…");
        setPendingAnalysisJobId({ recordId: previewDoc.id, table: "Documents" });
        // isAnalyzing stays true until polling completes
      } else {
        // 200 — synchronous result (local dev)
        setAiAnalysis(res);
        setIsAnalyzing(false);
      }
    } catch (err: any) {
      console.error("AI Analysis failed:", err);
      if (err.message?.includes("parse") || err.message?.includes("No extracted text")) {
        setParseError("This document must be parsed before AI analysis. Click \"Extract Text\" above.");
      } else {
        alert(err.message || "AI Analysis failed.");
      }
      setIsAnalyzing(false);
    }
  };


  // Synchronise draft link when drawer selection changes
  useEffect(() => {
    if (selectedDoc) {
      setDraftLink(selectedDoc.driveLink || "");
    }
  }, [selectedDoc]);

  // Synchronise selectedDoc when documents prop updates
  useEffect(() => {
    if (selectedDoc) {
      const updated = documents.find((d) => d.id === selectedDoc.id);
      if (updated) {
        setSelectedDoc((prev) => (prev ? { ...prev, ...updated } : null));
      }
    }
  }, [documents, selectedDoc?.id]);

  const handleBatchStatusUpdate = async (status: string) => {
    if (selectedIds.size === 0) return;
    setIsBatchUpdating(true);
    try {
      const updates = Array.from(selectedIds).map((id) => ({
        id,
        fields: { Status: status },
      }));
      await updateAdminDocuments(updates);
      setSelectedIds(new Set());
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error("Batch status update failed:", err);
      alert(err instanceof Error ? err.message : "Failed to update documents");
    } finally {
      setIsBatchUpdating(false);
    }
  };

  const handleSaveLink = async () => {
    if (!selectedDoc) return;
    setIsSavingLink(true);
    try {
      await updateAdminDocuments([
        {
          id: selectedDoc.id,
          fields: { Drive_Link: draftLink },
        },
      ]);
      setSelectedDoc((prev) => (prev ? { ...prev, driveLink: draftLink } : null));
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error("Failed to save document link:", err);
      alert(err instanceof Error ? err.message : "Failed to save link");
    } finally {
      setIsSavingLink(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!selectedDoc) return;
    try {
      await updateAdminDocuments([{ id: selectedDoc.id, fields: { Status: newStatus } }]);
      setSelectedDoc((prev) => (prev ? { ...prev, status: newStatus } : null));
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error("Failed to save document status:", err);
      alert(err instanceof Error ? err.message : "Failed to update status");
    }
  };

  const handleCreateDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDocName.trim()) {
      setDocErrorMessage("Document name is required.");
      return;
    }
    if (!dealId) {
      setDocErrorMessage("Deal ID is missing.");
      return;
    }
    setIsSubmittingDoc(true);
    setDocErrorMessage("");
    try {
      const categoryToWrite = newDocCategory;

      if (uploadMode === "upload") {
        if (!selectedFileDataBase64) {
          setDocErrorMessage("Please select a file to upload.");
          setIsSubmittingDoc(false);
          return;
        }
        const uploadResult = await uploadAdminDocument({
          documentName: newDocName.trim(),
          category: categoryToWrite.trim(),
          status: newDocStatus,
          dealId,
          ablCritical: newDocCritical,
          fileName: selectedFile?.name || "document.pdf",
          fileType: selectedFile?.type || "application/pdf",
          fileData: selectedFileDataBase64
        });

        // Automatically trigger text extraction after upload (fire-and-forget with status)
        if (uploadResult?.result?.id) {
          // Don't await – let it run in background; user can see parse status in drawer
          setParseResult(null);
          setParseError("");
          handleParseDocument(uploadResult.result.id).catch(() => {});
        }
      } else {
        await createAdminDocument({
          documentName: newDocName.trim(),
          category: categoryToWrite.trim(),
          status: newDocStatus,
          driveLink: newDocLink.trim() || undefined,
          dealId,
          ablCritical: newDocCritical
        });
      }

      setNewDocName("");
      setNewDocCategory("Financial");
      setCustomCategory("");
      setNewDocStatus("Outstanding");
      setNewDocLink("");
      setNewDocCritical(false);
      setSelectedFile(null);
      setSelectedFileDataBase64("");
      setUploadMode("link");
      setIsAddDocOpen(false);
      if (onRefresh) onRefresh();
    } catch (err: any) {
      console.error(err);
      setDocErrorMessage(err.message || "Failed to create document.");
    } finally {
      setIsSubmittingDoc(false);
    }
  };


  const handleDocActionClick = (e: React.MouseEvent, doc: DealDocument, action: "view" | "download") => {
    if (!doc.driveLink || doc.driveLink.trim() === "") {
      e.preventDefault();
      e.stopPropagation();
      if (audience === "internal") {
        alert(
          `No link has been uploaded for "${doc.documentName || "this document"}" yet.\n\nPlease select the document row, then paste a Google Drive or file URL in the "Document Link Management" section in the right drawer.`
        );
      } else {
        alert(
          `The document "${doc.documentName || "this document"}" is not yet available for view or download.\n\nPlease contact your Deal Manager to request access.`
        );
      }
    }
  };

  const visibleDocuments = useMemo(
    () => documents,
    [documents],
  );

  const statuses = uniqueSorted(visibleDocuments.map((doc) => doc.status));
  const categories = uniqueSorted(visibleDocuments.map((doc) => doc.category));

  // Build hierarchical index numbering
  const indexedDocuments = useMemo(() => {
    const categoriesList = uniqueSorted(visibleDocuments.map((doc) => doc.category));
    const grouped: Record<string, DealDocument[]> = {};
    visibleDocuments.forEach((doc) => {
      const cat = doc.category || "Uncategorized";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(doc);
    });

    const result: Array<DealDocument & { indexRef: string; categoryIndexRef: string }> = [];
    categoriesList.forEach((cat, catIdx) => {
      const catIndex = `${catIdx + 1}.0`;
      const docsInCat = grouped[cat] || [];
      // Sort documents alphabetically by name
      const sortedDocs = [...docsInCat].sort((a, b) => 
        (a.documentName || "").localeCompare(b.documentName || "")
      );
      sortedDocs.forEach((doc, docIdx) => {
        result.push({
          ...doc,
          categoryIndexRef: catIndex,
          indexRef: `${catIdx + 1}.${docIdx + 1}`,
        });
      });
    });
    return result;
  }, [visibleDocuments]);

  // Apply filters and search
  const filteredDocuments = useMemo(() => {
    return indexedDocuments.filter((doc) => {
      const statusMatches = statusFilter === "All" || doc.status === statusFilter;
      const categoryMatches = categoryFilter === "All" || doc.category === categoryFilter;
      const searchMatches =
        !searchQuery.trim() ||
        (doc.documentName || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (doc.category || "").toLowerCase().includes(searchQuery.toLowerCase());
      return statusMatches && categoryMatches && searchMatches;
    });
  }, [indexedDocuments, statusFilter, categoryFilter, searchQuery]);

  // Select/Deselect all visible filtered documents
  const isAllSelected = useMemo(() => {
    if (filteredDocuments.length === 0) return false;
    return filteredDocuments.every((doc) => selectedIds.has(doc.id));
  }, [filteredDocuments, selectedIds]);

  const handleSelectAllToggle = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (isAllSelected) {
        filteredDocuments.forEach((doc) => next.delete(doc.id));
      } else {
        filteredDocuments.forEach((doc) => next.add(doc.id));
      }
      return next;
    });
  };

  const handleSelectToggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const releasedCount = visibleDocuments.filter((doc) => isSentToLender(doc.status)).length;
  const progress = visibleDocuments.length > 0 ? (releasedCount / visibleDocuments.length) * 100 : 0;

  if (visibleDocuments.length === 0) {
    return <EmptyState title="No approved documents" message="No approved documents are available for this deal." />;
  }

  return (
    <div className="space-y-6 relative">
      {audience === "internal" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] backdrop-blur-md p-5 shadow-premium-card card-sheen flex items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.015] border border-white/[0.02] text-acp-bronze shadow-sm">
                <Files className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-450">Total Approved</p>
                <p className="mt-1 text-2xl font-display font-normal text-white italic">
                  {releasedCount}
                  <span className="text-xs font-semibold text-slate-400 font-sans not-italic"> / {visibleDocuments.length} released</span>
                </p>
              </div>
            </div>
            <div className="shrink-0">
              <ProgressRing value={progress} size={54} strokeWidth={4.5} />
            </div>
          </div>
          <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] backdrop-blur-md p-5 shadow-premium-card card-sheen flex items-center">
            <ProgressBar value={progress} label="Progress sent to lender" />
          </div>
        </div>
      ) : null}

      {/* Interactive Filter Pills & Search Deck */}
      <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] backdrop-blur-md p-6 shadow-premium-card card-sheen space-y-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pb-3 border-b border-white/5">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 select-none">
            <Filter className="h-4 w-4 text-acp-bronze" aria-hidden="true" />
            Document Filters
          </div>
          
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
            {audience === "internal" && (
              <button
                type="button"
                onClick={() => setIsAddDocOpen(true)}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-acp-bronze to-acp-bronze-dark px-4 text-xs font-bold uppercase tracking-wider text-white shadow-md hover:shadow-glow-bronze cursor-pointer transition-all duration-300 self-start sm:self-auto shrink-0"
              >
                <Plus className="h-4 w-4" />
                Add Document
              </button>
            )}
            
            {/* Live Search Bar */}
            <div className="relative w-full sm:max-w-xs">
              <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search documents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 w-full rounded-xl border border-white/[0.02] bg-white/[0.015] pl-10 pr-8 text-xs font-semibold text-white placeholder-slate-500 outline-none transition-all duration-300 focus:border-acp-bronze focus:ring-1 focus:ring-acp-bronze shadow-sm"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>
        
        {/* Status Filters */}
        <div className="space-y-2">
          <span className="block text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Filter by status</span>
          <div className="flex flex-wrap gap-1.5">
            <FilterPill
              label="All"
              active={statusFilter === "All"}
              count={visibleDocuments.length}
              onClick={() => setStatusFilter("All")}
            />
            {statuses.map((status) => (
              <FilterPill
                key={status}
                label={status}
                active={statusFilter === status}
                count={visibleDocuments.filter((d) => d.status === status).length}
                onClick={() => setStatusFilter(status)}
              />
            ))}
          </div>
        </div>

        {/* Category Filters */}
        <div className="space-y-2 pt-1">
          <span className="block text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Filter by category</span>
          <div className="flex flex-wrap gap-1.5">
            <FilterPill
              label="All"
              active={categoryFilter === "All"}
              count={visibleDocuments.length}
              onClick={() => setCategoryFilter("All")}
            />
            {categories.map((cat) => (
              <FilterPill
                key={cat}
                label={cat}
                active={categoryFilter === cat}
                count={visibleDocuments.filter((d) => d.category === cat).length}
                onClick={() => setCategoryFilter(cat)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Batch Approval Action Deck */}
      {audience === "internal" && selectedIds.size > 0 && (
        <div className="rounded-2xl border border-acp-bronze/20 bg-acp-bronze/5 p-5 shadow-soft flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 animate-fade-in-up">
          <div className="flex items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-acp-bronze/15 border border-acp-bronze/30 text-xs font-bold text-white shadow-sm">
              {selectedIds.size}
            </span>
            <span className="text-xs font-bold text-slate-200">
              {selectedIds.size === 1 ? "document" : "documents"} selected for approval actions
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => handleBatchStatusUpdate("Sent to Lender")}
              disabled={isBatchUpdating}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-4 text-xs font-bold uppercase tracking-wider text-white shadow-md hover:shadow-glow-emerald disabled:opacity-40 cursor-pointer transition-all duration-300"
              type="button"
            >
              Approve Selected
            </button>
            <button
              onClick={() => handleBatchStatusUpdate("Outstanding")}
              disabled={isBatchUpdating}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-white/[0.015] border border-white/[0.02] px-4 text-xs font-bold uppercase tracking-wider text-slate-350 hover:bg-white/[0.02] hover:text-white disabled:opacity-40 cursor-pointer transition-all duration-300"
              type="button"
            >
              Revoke Approval
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              disabled={isBatchUpdating}
              className="text-xs font-bold uppercase tracking-wider text-slate-450 hover:text-slate-200 transition-colors ml-1.5"
              type="button"
            >
              Clear Selection
            </button>
          </div>
        </div>
      )}

      {filteredDocuments.length > 0 ? (
        <Table className="max-h-[65vh]">
          <thead>
            <tr className="border-b border-white/5 bg-white/[0.01]">
              {audience === "internal" && (
                <Th className="w-10">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={handleSelectAllToggle}
                    className="rounded border-white/[0.02] bg-white/[0.015] text-acp-bronze focus:ring-acp-bronze cursor-pointer h-3.5 w-3.5"
                  />
                </Th>
              )}
              <Th>Index</Th>
              <Th className="w-full">Document Name</Th>
              <Th>Category</Th>
              <Th>Priority</Th>
              <Th>Status</Th>
              <Th>Date Received</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 bg-white/[0.01]">
            {filteredDocuments.map((document) => (
              <tr 
                key={document.id} 
                className={cx(
                  "transition-all duration-205 hover:bg-white/[0.02] cursor-pointer",
                  selectedDoc?.id === document.id ? "bg-white/[0.04]" : ""
                )}
                onClick={() => setSelectedDoc(document)}
              >
                {audience === "internal" && (
                  <Td className="w-10" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(document.id)}
                      onChange={() => handleSelectToggle(document.id)}
                      className="rounded border-white/[0.02] bg-white/[0.015] text-acp-bronze focus:ring-acp-bronze cursor-pointer h-3.5 w-3.5"
                    />
                  </Td>
                )}
                <Td className="font-mono text-xs font-bold text-slate-500 select-none">
                  {document.indexRef}
                </Td>
                <Td className="w-full min-w-64">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.015] border border-white/[0.02] shadow-sm">
                      {getDocIcon(document.documentName, document.category)}
                    </span>
                    <div className="min-w-0">
                      <div className="font-semibold text-white truncate" title={document.documentName}>
                        {document.documentName || "Untitled document"}
                      </div>
                      {audience === "lender" ? (
                        <div className="mt-0.5 flex items-center gap-1 text-[10px] font-bold text-acp-emerald uppercase tracking-wider">
                          <CheckCircle2 className="h-3 w-3" /> Approved Release
                        </div>
                      ) : null}
                    </div>
                  </div>
                </Td>
                <Td>
                  <span className="rounded-full border border-white/[0.02] bg-white/[0.015] px-2.5 py-0.5 text-[10px] font-semibold text-slate-300 uppercase tracking-wide">
                    {document.category || "Uncategorized"}
                  </span>
                </Td>
                <Td>
                  {document.ablCritical ? (
                    <Badge tone="amber">High Priority</Badge>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400">
                      <ShieldAlert className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                      Standard
                    </span>
                  )}
                </Td>
                <Td>
                  <StatusBadge status={document.status} />
                </Td>
                <Td className="font-semibold text-slate-350">
                  {formatDate(document.dateReceived) || "Not received"}
                </Td>
                <Td className="text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-2">
                    <ButtonLink 
                      href={document.driveLink} 
                      icon="view"
                      onClick={(e) => handleViewClick(e, document)}
                    >
                      View
                    </ButtonLink>
                    <ButtonLink 
                      href={getDriveDownloadUrl(document.driveLink)} 
                      icon="download" 
                      variant="purple"
                      onClick={(e) => handleDocActionClick(e, document, "download")}
                      download
                    >
                      Download
                    </ButtonLink>
                    {audience === "internal" && (
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setDocToDelete(document);
                        }}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-red-500/25 bg-red-500/5 text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-all duration-200 cursor-pointer"
                        title="Delete Document"
                        type="button"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <EmptyState title="No matching documents" message="Adjust the document filters to see more rows." />
      )}

      {/* Right-Hand slide out drawer backdrop */}
      {selectedDoc && (
        <div 
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-40 transition-opacity duration-300"
          onClick={() => setSelectedDoc(null)}
        />
      )}

      {/* Right-Hand slide out drawer */}
      <div 
        className={cx(
          "fixed top-0 right-0 h-screen w-full sm:w-[480px] bg-acp-ink border-l border-white/[0.02] z-50 shadow-2xl transition-all duration-450 cubic-bezier(0.16, 1, 0.3, 1) flex flex-col transform",
          selectedDoc ? "translate-x-0" : "translate-x-full"
        )}
      >
        {selectedDoc && (
          <>
            {/* Drawer Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-white/5">
              <div className="min-w-0">
                <span className="font-mono text-xs font-bold text-slate-500 select-none">
                  Document Index {selectedDoc.indexRef}
                </span>
                <h3 className="text-sm font-bold text-white truncate mt-1" title={selectedDoc.documentName}>
                  {selectedDoc.documentName}
                </h3>
              </div>
              <button 
                type="button" 
                onClick={() => setSelectedDoc(null)}
                className="h-8 w-8 flex items-center justify-center rounded-xl border border-white/[0.02] text-slate-400 hover:text-white hover:border-white/20 transition-colors shadow-sm"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Drawer Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Core metrics */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 border border-white/[0.02] bg-white/[0.02] rounded-xl">
                  <span className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-400">File Category</span>
                  <span className="block text-xs font-bold text-white mt-1.5">{selectedDoc.category || "Uncategorized"}</span>
                </div>
                <div className="p-3 border border-white/[0.02] bg-white/[0.02] rounded-xl">
                  <span className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Review Status</span>
                  <div className="mt-1.5">
                    {audience === "internal" ? (
                      <select
                        value={selectedDoc.status || "Outstanding"}
                        onChange={(e) => handleStatusChange(e.target.value)}
                        className="text-[10px] bg-slate-900 border border-white/10 rounded px-2 py-1 text-white font-semibold cursor-pointer outline-none focus:border-acp-bronze focus:ring-1 focus:ring-acp-bronze transition"
                      >
                        <option value="Outstanding" className="bg-[#161B22] text-white">Outstanding</option>
                        <option value="Sent to Lender" className="bg-[#161B22] text-white">Sent to Lender</option>
                      </select>
                    ) : (
                      <StatusBadge status={selectedDoc.status} />
                    )}
                  </div>
                </div>
              </div>

              {/* Detail fields */}
              <div className="space-y-3.5">
                <h4 className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-455">Document Information</h4>
                
                <DetailRow icon={<Calendar className="h-4 w-4 text-acp-bronze" />} label="Date Received" value={formatDate(selectedDoc.dateReceived) || "Not logged"} />
                {selectedDoc.expectedDate && (
                  <DetailRow icon={<Calendar className="h-4 w-4 text-acp-bronze" />} label="Expected Date" value={formatDate(selectedDoc.expectedDate)} />
                )}
                {audience === "internal" && (
                  <DetailRow icon={<User className="h-4 w-4 text-indigo-400" />} label="Database Source" value={selectedDoc.source || "Active Pipeline"} />
                )}
                <DetailRow 
                  icon={<ShieldAlert className="h-4 w-4 text-rose-500" />} 
                  label="Priority Class" 
                  value={selectedDoc.ablCritical ? "High Priority" : "Standard"} 
                />
              </div>

              {/* Edit Document Link (Admin only) */}
              {audience === "internal" && (
                <div className="space-y-3.5 border-t border-white/5 pt-4">
                  <div className="flex items-center gap-2 text-slate-400 font-medium text-xs">
                    <ExternalLink className="h-4 w-4 text-acp-bronze" />
                    <span>Document Link Management</span>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[9px] font-extrabold uppercase tracking-[0.12em] text-slate-450" htmlFor="document-link-input">
                      Google Drive or File URL
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="document-link-input"
                        type="text"
                        value={draftLink}
                        onChange={(e) => setDraftLink(e.target.value)}
                        placeholder="https://drive.google.com/..."
                        className="h-9 flex-1 rounded-xl border border-white/[0.02] bg-white/[0.015] px-3 text-xs text-white placeholder-slate-600 outline-none focus:border-acp-bronze focus:ring-1 focus:ring-acp-bronze shadow-sm transition-colors duration-300"
                      />
                      <button
                        type="button"
                        onClick={handleSaveLink}
                        disabled={isSavingLink || draftLink === (selectedDoc.driveLink || "")}
                        className="h-9 px-4 rounded-xl bg-gradient-to-r from-acp-bronze to-acp-bronze-dark text-white text-xs font-bold uppercase tracking-wider disabled:opacity-40 disabled:pointer-events-none hover:shadow-glow-bronze cursor-pointer shrink-0 transition-all duration-300"
                      >
                        {isSavingLink ? "Saving..." : "Save"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Internal notes */}
              <div className="space-y-2">
                <h4 className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-455">Internal Notes & Description</h4>
                <div className="p-4 border border-white/[0.02] bg-white/[0.02] rounded-2xl text-xs leading-relaxed text-slate-300 font-medium">
                  {selectedDoc.internalNotes || "No internal notes recorded for this file. Click view to inspect the file directly."}
                </div>
              </div>

              {/* Version History feed */}
              <div className="space-y-3">
                <h4 className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-455 flex items-center gap-1.5">
                  <History className="h-4 w-4 text-slate-400" />
                  Document History Log
                </h4>
                <div className="relative border-l border-white/[0.02] pl-4 space-y-4 text-xs">
                  <LogItem 
                    date={selectedDoc.dateReceived || "2026-05-24"} 
                    action="File received" 
                    user="System Sync" 
                  />
                  {selectedDoc.ablCritical && (
                    <LogItem 
                      date={selectedDoc.dateReceived || "2026-05-24"} 
                      action="Flagged as critical" 
                      user="System Compliance" 
                    />
                  )}
                  {isSentToLender(selectedDoc.status) && (
                    <LogItem 
                      date={selectedDoc.dateSentToLender || selectedDoc.dateReceived || "2026-05-25"} 
                      action="Document approved for release" 
                      user="Deal Manager" 
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Drawer Actions */}
            <div className="p-6 border-t border-white/5 bg-white/[0.01] grid grid-cols-2 gap-3.5">
              <ButtonLink
                href={selectedDoc.driveLink}
                icon="view"
                className="h-11 w-full"
                onClick={(e) => handleViewClick(e, selectedDoc)}
              >
                View File
              </ButtonLink>
              <ButtonLink
                href={getDriveDownloadUrl(selectedDoc.driveLink)}
                icon="download"
                variant="purple"
                className="h-11 w-full"
                onClick={(e) => handleDocActionClick(e, selectedDoc, "download")}
                download
              >
                Download
              </ButtonLink>
            </div>
          </>
        )}
      </div>

      {/* Add Document Modal Overlay */}
      {isAddDocOpen && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/[0.02] bg-[#161B22] p-6 shadow-2xl relative animate-scale-in max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setIsAddDocOpen(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-white cursor-pointer"
              type="button"
            >
              <X className="h-5 w-5" />
            </button>

            <h3 className="text-base font-bold text-white uppercase tracking-wider mb-5 flex items-center gap-2">
              <Files className="h-5 w-5 text-acp-bronze" />
              Add Document to Deal
            </h3>

            {docErrorMessage && (
              <div className="mb-4 rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 text-xs font-semibold text-rose-400 flex items-start gap-2">
                <FileWarning className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{docErrorMessage}</span>
              </div>
            )}

            <form onSubmit={handleCreateDocument} className="space-y-4 text-xs font-semibold">
              <div className="space-y-1.5">
                <label className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                  Document Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newDocName}
                  onChange={(e) => setNewDocName(e.target.value)}
                  placeholder="e.g. FY25 Management Accounts"
                  className="h-9 w-full rounded-xl border border-white/[0.02] bg-[#161B22] px-3 text-white placeholder-slate-650 outline-none focus:border-acp-bronze focus:ring-1 focus:ring-acp-bronze transition-all"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                    Category
                  </label>
                  <select
                    value={newDocCategory}
                    onChange={(e) => setNewDocCategory(e.target.value)}
                    className="h-9 w-full rounded-xl border border-white/[0.02] bg-[#161B22] px-3 text-white outline-none focus:border-acp-bronze focus:ring-1 focus:ring-acp-bronze transition-all cursor-pointer"
                  >
                    <option value="Financial" className="bg-[#161B22] text-white">Financial</option>
                    <option value="Debtors-ABL" className="bg-[#161B22] text-white">Debtors-ABL</option>
                    <option value="Commercial" className="bg-[#161B22] text-white">Commercial</option>
                    <option value="Operational" className="bg-[#161B22] text-white">Operational</option>
                    <option value="Internal Only" className="bg-[#161B22] text-white">Internal Only</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                    Review Status
                  </label>
                  <select
                    value={newDocStatus}
                    onChange={(e) => setNewDocStatus(e.target.value)}
                    className="h-9 w-full rounded-xl border border-white/[0.02] bg-[#161B22] px-3 text-white outline-none focus:border-acp-bronze focus:ring-1 focus:ring-acp-bronze transition-all cursor-pointer"
                  >
                    <option value="Outstanding" className="bg-[#161B22] text-white">Outstanding</option>
                    <option value="Sent to Lender" className="bg-[#161B22] text-white">Sent to Lender</option>
                  </select>
                </div>
              </div>

              <div className="space-y-3">
                <label className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                  Document Reference Mode
                </label>
                
                <div className="grid grid-cols-2 gap-2 p-1 bg-white/[0.015] border border-white/[0.02] rounded-xl">
                  <button
                    type="button"
                    onClick={() => { setUploadMode("link"); setSelectedFile(null); setSelectedFileDataBase64(""); }}
                    className={cx(
                      "h-8 rounded-lg text-[10px] uppercase font-black tracking-wider transition cursor-pointer",
                      uploadMode === "link" ? "bg-[#C6A66B] text-slate-950" : "text-slate-400 hover:text-white"
                    )}
                  >
                    Link URL
                  </button>
                  <button
                    type="button"
                    onClick={() => setUploadMode("upload")}
                    className={cx(
                      "h-8 rounded-lg text-[10px] uppercase font-black tracking-wider transition cursor-pointer",
                      uploadMode === "upload" ? "bg-[#C6A66B] text-slate-950" : "text-slate-400 hover:text-white"
                    )}
                  >
                    File Upload
                  </button>
                </div>
              </div>

              {uploadMode === "link" ? (
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                    Google Drive or File Link
                  </label>
                  <input
                    type="url"
                    value={newDocLink}
                    onChange={(e) => setNewDocLink(e.target.value)}
                    placeholder="https://drive.google.com/..."
                    className="h-9 w-full rounded-xl border border-white/[0.02] bg-[#161B22] px-3 text-white placeholder-slate-650 outline-none focus:border-acp-bronze focus:ring-1 focus:ring-acp-bronze transition-all"
                  />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                    Direct File Upload (PDF, Word, Excel, Images, Text)
                  </label>
                  <div className="border border-dashed border-white/15 rounded-xl p-6 text-center bg-white/[0.01] hover:bg-white/[0.02] transition relative cursor-pointer">
                    <input
                      type="file"
                      onChange={handleFileChange}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                    />
                    {selectedFile ? (
                      <div className="space-y-1">
                        <CheckCircle2 className="h-5 w-5 text-emerald-450 mx-auto" />
                        <p className="text-[10px] text-white font-bold truncate">{selectedFile.name}</p>
                        <p className="text-[8px] text-slate-500 uppercase tracking-widest">
                          {(selectedFile.size / 1024).toFixed(1)} KB — Ready
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-1.5 py-1">
                        <Upload className="h-5 w-5 text-slate-500 mx-auto" />
                        <p className="text-[9px] text-slate-450 uppercase tracking-wider">
                          Click or drag file to select
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="new-doc-critical"
                  checked={newDocCritical}
                  onChange={(e) => setNewDocCritical(e.target.checked)}
                  className="rounded border-white/[0.02] bg-white/[0.015] text-acp-bronze focus:ring-acp-bronze cursor-pointer h-4 w-4"
                />
                <label htmlFor="new-doc-critical" className="text-slate-350 font-bold cursor-pointer select-none">
                  High Priority / ABL Critical
                </label>
              </div>

              <div className="pt-4 border-t border-white/5 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsAddDocOpen(false)}
                  className="h-10 px-4 rounded-xl border border-white/[0.02] text-slate-300 text-xs font-bold uppercase tracking-wider hover:bg-white/[0.015] cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingDoc}
                  className="h-10 px-5 rounded-xl bg-gradient-to-r from-acp-bronze to-acp-bronze-dark text-white text-xs font-bold uppercase tracking-wider disabled:opacity-40 disabled:pointer-events-none hover:shadow-glow-bronze cursor-pointer transition-all"
                >
                  {isSubmittingDoc ? "Adding..." : "Add Document"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Dynamic File Preview Overlay Modal */}
      {previewDoc && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-5xl rounded-2xl border border-white/[0.02] bg-[#161B22] p-6 shadow-2xl relative flex flex-col h-[85vh] animate-scale-in">
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-white/5">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-[#C6A66B]">
                  Document Preview ({previewDoc.category})
                </span>
                <h3 className="text-sm font-bold text-white mt-0.5 truncate max-w-md">
                  {previewDoc.documentName}
                </h3>
              </div>
              <div className="flex items-center gap-3">
                <a
                  href={getDriveDownloadUrl(previewDoc.driveLink)}
                  download
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.02] bg-white/[0.015] px-3.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-300 hover:text-white hover:bg-white/[0.02] transition"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download File
                </a>
                <button
                  onClick={() => setPreviewDoc(null)}
                  className="h-8 w-8 flex items-center justify-center rounded-lg border border-white/[0.02] bg-white/[0.015] text-slate-400 hover:text-white hover:border-white/20 transition cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Split Screen Body */}
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 overflow-hidden pt-4">
              
              {/* Left Pane: Preview Content */}
              <div className="h-full overflow-hidden flex flex-col items-center justify-center bg-black/20 border border-white/5 rounded-xl p-4">
                {(() => {
                  const link = previewDoc.driveLink || "";
                  const ext = link.split(".").pop()?.toLowerCase();
                  
                  if (ext === "pdf") {
                    return (
                      <iframe 
                        src={link} 
                        className="w-full h-full border-0 rounded-lg bg-[#161B22]/50" 
                      />
                    );
                  }
                  if (["png", "jpg", "jpeg", "gif"].includes(ext || "")) {
                    return (
                      <img 
                        src={link} 
                        alt={previewDoc.documentName}
                        className="max-w-full max-h-full object-contain rounded-lg shadow-lg" 
                      />
                    );
                  }
                  if (["txt", "csv", "json", "md"].includes(ext || "")) {
                    if (loadingPreviewText) {
                      return (
                        <div className="flex flex-col items-center gap-2">
                          <Loader2 className="h-6 w-6 text-[#C6A66B] animate-spin" />
                          <span className="text-[10px] text-slate-405">Loading file content...</span>
                        </div>
                      );
                    }
                    if (ext === "csv" && previewText) {
                      // Parse CSV as table
                      const rows = previewText.split("\n").map(r => r.split(","));
                      return (
                        <div className="w-full h-full overflow-auto text-[10px] font-sans p-2">
                          <table className="min-w-full border-collapse divide-y divide-white/5 text-left">
                            <tbody className="divide-y divide-white/5">
                              {rows.map((row, rIdx) => (
                                <tr key={rIdx} className={rIdx === 0 ? "bg-white/[0.015] font-bold text-white" : "text-slate-350"}>
                                  {row.map((cell, cIdx) => (
                                    <td key={cIdx} className="px-3 py-1.5 border border-white/5 truncate max-w-32">{cell}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    }
                    return (
                      <pre className="w-full h-full overflow-auto rounded-lg p-4 bg-[#07090D] text-slate-350 font-mono text-[10px] text-left whitespace-pre-wrap leading-relaxed select-text">
                        {previewText || "Empty file content."}
                      </pre>
                    );
                  }
                  
                  // Default format warning
                  return (
                    <div className="text-center space-y-4 max-w-xs">
                      <FileWarning className="h-10 w-10 text-slate-500 mx-auto" />
                      <div>
                        <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Preview Not Available</h4>
                        <p className="text-[10px] text-slate-450 mt-1 leading-relaxed">
                          Spreadsheets (.xlsx) and Word files (.docx) cannot be previewed natively in the browser without third-party integrations.
                        </p>
                      </div>
                      <a
                        href={getDriveDownloadUrl(previewDoc.driveLink)}
                        download
                        className="inline-flex h-8 items-center gap-1.5 bg-white text-slate-950 px-4 text-[10px] font-extrabold uppercase tracking-wider hover:bg-slate-100 transition shadow-md"
                      >
                        Download file to view
                      </a>
                    </div>
                  );
                })()}
              </div>

              {/* Right Pane: AI Analysis Sidebar */}
              <div className="h-full flex flex-col justify-between overflow-y-auto space-y-5 border-l border-white/5 pl-4 pr-1">
                <div className="space-y-4">
                  <div>
                    <h4 className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                      Document Metadata
                    </h4>
                    <div className="mt-2.5 space-y-2 text-[10px] font-medium text-slate-350">
                      <div className="flex justify-between py-1 border-b border-white/5">
                        <span className="text-slate-500">Review Status:</span>
                        <span className="text-white font-bold">{previewDoc.status}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-white/5">
                        <span className="text-slate-500">Date Logged:</span>
                        <span className="text-white font-bold">{formatDate(previewDoc.dateReceived) || "Not logged"}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-white/5">
                        <span className="text-slate-500">Priority Level:</span>
                        <span className={previewDoc.ablCritical ? "text-amber-500 font-extrabold" : "text-white"}>
                          {previewDoc.ablCritical ? "High Priority" : "Standard"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-white/5 pt-4 space-y-3.5">
                    <h4 className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                      <BrainCircuit className="h-4 w-4 text-blue-450" />
                      AI Document Analyst
                    </h4>

                    {/* Step 1: Text Extraction */}
                    <div className="space-y-2">
                      <span className="text-[9px] text-slate-500 uppercase font-bold tracking-widest">Step 1 — Extract Text</span>

                      {/* Extraction in progress */}
                      {isParsing && (
                        <div className="flex items-center gap-2 p-3 bg-amber-500/5 border border-amber-500/10 rounded-xl">
                          <Loader2 className="h-3.5 w-3.5 text-amber-400 animate-spin flex-shrink-0" />
                          <span className="text-[9px] text-amber-300 font-bold uppercase tracking-widest">
                            {parseJobStatus || "Extracting document text…"}
                          </span>
                        </div>
                      )}

                      {/* Extraction success */}
                      {!isParsing && parseResult && (
                        <div className="flex items-start gap-2 p-3 bg-emerald-500/5 border border-emerald-500/10 rounded-xl">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <span className="block text-[9px] text-emerald-400 font-bold uppercase tracking-widest">Text Extracted</span>
                            <span className="block text-[9px] text-slate-400 mt-0.5">
                              {parseResult.wordCount.toLocaleString()} words · {parseResult.characterCount.toLocaleString()} chars · {parseResult.fileType}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleParseDocument()}
                            className="text-[8px] text-slate-500 hover:text-slate-300 underline uppercase tracking-widest flex-shrink-0"
                          >
                            Re-extract
                          </button>
                        </div>
                      )}

                      {/* Extraction error */}
                      {!isParsing && parseError && (
                        <div className="p-3 bg-rose-500/5 border border-rose-500/10 rounded-xl space-y-2">
                          <div className="flex items-start gap-2">
                            <FileWarning className="h-3.5 w-3.5 text-rose-400 mt-0.5 flex-shrink-0" />
                            <span className="text-[9px] text-rose-300 leading-relaxed">{parseError}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleParseDocument()}
                            className="w-full h-7 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 font-bold text-[9px] uppercase tracking-wider transition flex items-center justify-center gap-1"
                          >
                            <Loader2 className="h-3 w-3" />
                            Retry Extraction
                          </button>
                        </div>
                      )}

                      {/* Idle state – no parse started */}
                      {!isParsing && !parseResult && !parseError && (
                        <div className="p-3 bg-[#0E1524] border border-white/5 rounded-xl space-y-2">
                          <p className="text-[9px] leading-relaxed text-slate-400">
                            Extract raw text from PDF, DOCX, or XLSX files before running AI analysis. Required for binary documents.
                          </p>
                          <button
                            type="button"
                            onClick={() => handleParseDocument()}
                            disabled={!previewDoc?.driveLink}
                            className="w-full h-7 rounded-lg bg-slate-600 hover:bg-slate-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-[9px] uppercase tracking-wider transition flex items-center justify-center gap-1"
                          >
                            <FileText className="h-3 w-3" />
                            Extract Text
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Step 2: AI Analysis (only available after successful extraction) */}
                    <div className="space-y-2">
                      <span className={`text-[9px] uppercase font-bold tracking-widest ${parseResult ? "text-slate-500" : "text-slate-600"}`}>Step 2 — AI Analysis</span>

                      {!aiAnalysis && !isAnalyzing && (
                        <div className="space-y-2 bg-[#0E1524] border border-blue-500/10 rounded-xl p-3.5">
                          <p className="text-[9px] leading-relaxed text-slate-400">
                            Extract financial covenants, notice periods, TUPE transfer details, and operational risk metrics from real document content.
                          </p>
                          <button
                            onClick={handleRunAiAnalysis}
                            disabled={!parseResult || isParsing}
                            className="w-full h-8 rounded-lg bg-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-extrabold text-[10px] uppercase tracking-wider transition cursor-pointer flex items-center justify-center gap-1"
                          >
                            <Sparkles className="h-3 w-3" />
                            {parseResult ? "Extract Terms with AI" : "Extract Text First"}
                          </button>
                        </div>
                      )}

                    {isAnalyzing && (
                      <div className="flex flex-col items-center justify-center py-6 space-y-2.5 bg-white/[0.01] border border-white/5 rounded-xl">
                        <Loader2 className="h-5 w-5 text-blue-400 animate-spin" />
                        <span className="text-[9px] text-slate-400 animate-pulse uppercase tracking-widest font-bold">
                          {analysisJobStatus || "AI Analyzing…"}
                        </span>
                      </div>
                    )}

                    {aiAnalysis && (
                      <div className="space-y-3 animate-fade-in-up">
                        {/* Summary */}
                        <div className="bg-[#0E1524] border border-blue-500/10 rounded-xl p-3 text-[10px] leading-relaxed text-slate-350">
                          <p className="font-bold text-blue-400 mb-1">Executive Summary:</p>
                          {aiAnalysis.summary}
                        </div>

                        {/* Extracted Ratios / Terms */}
                        {aiAnalysis.keyClauses && aiAnalysis.keyClauses.length > 0 && (
                          <div className="space-y-1.5">
                            <span className="block text-[9px] uppercase font-bold text-slate-500">Key Clauses & Terms:</span>
                            {aiAnalysis.keyClauses.map((c: any, cIdx: number) => (
                              <div key={cIdx} className="p-2 bg-white/[0.02] border border-white/5 rounded-lg text-[9px] leading-relaxed">
                                <span className="font-bold text-slate-200 block">{c.term}</span>
                                <span className="text-slate-400">{c.details}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Risks & Covenants */}
                        {aiAnalysis.risks && aiAnalysis.risks.length > 0 && (
                          <div className="p-2.5 bg-rose-500/5 border border-rose-500/10 rounded-xl text-[9px] leading-relaxed text-rose-350">
                            <span className="font-bold text-rose-400 block mb-0.5">Flagged Risks:</span>
                            <ul className="list-disc pl-3 space-y-0.5">
                              {aiAnalysis.risks.map((r: string, rIdx: number) => (
                                <li key={rIdx}>{r}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {aiAnalysis.covenants && aiAnalysis.covenants.length > 0 && (
                          <div className="p-2.5 bg-emerald-500/5 border border-emerald-500/10 rounded-xl text-[9px] leading-relaxed text-emerald-350">
                            <span className="font-bold text-emerald-400 block mb-0.5">Covenants & Rules:</span>
                            <ul className="list-disc pl-3 space-y-0.5">
                              {aiAnalysis.covenants.map((cov: string, covIdx: number) => (
                                <li key={covIdx}>{cov}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Re-analyze button */}
                        <button
                          onClick={handleRunAiAnalysis}
                          disabled={isAnalyzing}
                          className="w-full h-7 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 font-bold text-[9px] uppercase tracking-wider transition flex items-center justify-center gap-1"
                        >
                          <Sparkles className="h-3 w-3" />
                          Re-analyse
                        </button>
                      </div>
                    )}
                    </div>
                  </div>

                  <div className="pt-4 border-t border-white/5 text-[9px] text-slate-500 leading-relaxed italic">
                    Analysis is grounded in real extracted document text. No content is fabricated.
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {docToDelete && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/[0.02] bg-[#161B22] p-6 shadow-2xl relative animate-scale-in">
            <h3 className="text-base font-bold text-white uppercase tracking-wider mb-3">
              Delete Document
            </h3>
            <p className="text-xs text-slate-350 leading-relaxed mb-6">
              Are you sure you want to permanently remove this document?
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDocToDelete(null)}
                disabled={isDeletingDoc}
                className="h-10 px-4 rounded-xl border border-white/[0.02] text-slate-300 text-xs font-bold uppercase tracking-wider hover:bg-white/[0.015] cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteDocConfirm}
                disabled={isDeletingDoc}
                className="h-10 px-5 rounded-xl bg-red-650 hover:bg-red-700 text-white text-xs font-bold uppercase tracking-wider disabled:opacity-40 disabled:pointer-events-none hover:shadow-glow-red cursor-pointer transition-all"
              >
                {isDeletingDoc ? "Deleting..." : "Delete Document"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterPill({
  label,
  active,
  count,
  onClick,
}: {
  label: string;
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-bold tracking-wide transition-all duration-300 transform active:scale-95 border",
        active
          ? "bg-gradient-to-r from-acp-bronze to-acp-bronze-dark text-white border-transparent shadow-md shadow-acp-bronze/10"
          : "bg-white/[0.015] border-white/[0.02] text-slate-350 hover:bg-white/[0.02] hover:text-white"
      )}
    >
      <span className="tracking-wide uppercase text-[10px]">{label}</span>
      <span className={cx(
        "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1.5 text-[9px] font-extrabold shadow-sm border",
        active
          ? "bg-white/[0.02] border-white/[0.02] text-white"
          : "bg-white/[0.015] border-white/5 text-slate-400"
      )}>
        {count}
      </span>
    </button>
  );
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-white/5">
      <div className="flex items-center gap-2 text-slate-400 font-medium text-xs">
        {icon}
        <span>{label}</span>
      </div>
      <span className="text-xs font-bold text-white">{value}</span>
    </div>
  );
}

function LogItem({ date, action, user }: { date: string; action: string; user: string }) {
  return (
    <div className="relative">
      <span className="absolute -left-6 top-1 h-2.5 w-2.5 rounded-full bg-acp-bronze border-2 border-acp-ink ring-1 ring-white/10" />
      <p className="text-[10px] font-bold text-slate-500">{formatDate(date)}</p>
      <p className="font-semibold text-slate-200 mt-0.5">{action}</p>
      <p className="text-[10px] text-slate-450 font-medium mt-0.5">by {user}</p>
    </div>
  );
}

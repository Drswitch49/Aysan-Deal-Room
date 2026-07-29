import { Filter, Files, ShieldAlert, FileText, FileSpreadsheet, FileArchive, CheckCircle2, Search, X, Calendar, User, History, ExternalLink, Plus, FileWarning, Upload, Trash2 } from "lucide-react";
import { useMemo, useState, useEffect, useCallback } from "react";
import type { DealDocument } from "../../types/deal";
import { updateAdminDocuments, createAdminDocument, uploadAdminDocument, parseAdminDocument, getJobStatus, deleteAdminDocument, getDocumentFileUrl } from "../../api/admin";
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
  /** Surfaced inline when View/Download can't resolve a file. */
  const [docActionError, setDocActionError] = useState<string>("");

  // Text extraction, kicked off automatically after an upload. There is no
  // manual trigger any more: it lived in the file-preview modal that used to
  // intercept View/Download, and that modal is gone.
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string>("");

  // Async job polling — tracks the in-flight extraction job
  const [pendingParseJobId, setPendingParseJobId] = useState<{ recordId: string; table: string } | null>(null);
  const [parseJobStatus, setParseJobStatus] = useState<string>("");

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

  /**
   * Download a document immediately — the only file action, for staff and
   * lenders alike.
   *
   * Deal files are Cloudinary `authenticated` assets whose stored URL 401s in a
   * browser, so the button cannot link straight at it; this resolves a
   * short-lived signed URL that comes back with an attachment disposition, then
   * clicks it. Navigating to an attachment starts the save without leaving the
   * page, so no new tab is involved.
   */
  const downloadDocument = async (e: React.MouseEvent, doc: DealDocument) => {
    e.preventDefault();
    e.stopPropagation();

    if (!doc.driveLink || doc.driveLink.trim() === "") {
      handleDocActionClick(e, doc);
      return;
    }

    setDocActionError("");
    try {
      const url = await getDocumentFileUrl(doc.id, "download");
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.documentName || "";
      a.rel = "noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err: any) {
      console.error("Document download failed:", err);
      setDocActionError(err?.message || `Could not download "${doc.documentName || "this document"}".`);
    }
  };

  /** Queue text extraction for a document (run automatically after upload). */
  const handleParseDocument = async (id: string) => {
    if (!id) return;
    setIsParsing(true);
    setParseError("");
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
        setIsParsing(false);
        if (onRefresh) onRefresh();
      }
    } catch (err: any) {
      console.error("Document parse failed:", err);
      setParseError(err.message || "Text extraction failed.");
      setIsParsing(false);
    }
  };

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
          // Don't await — status shows in the banner above the table.
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


  /** No file attached yet — explain rather than opening a dead link. */
  const handleDocActionClick = (e: React.MouseEvent, doc: DealDocument) => {
    e.preventDefault();
    e.stopPropagation();
    setDocActionError(
      audience === "internal"
        ? `No file has been uploaded for "${doc.documentName || "this document"}" yet. Open the document row and add a file or link under "Document Link Management".`
        : `"${doc.documentName || "This document"}" is not yet available. Please contact your Deal Manager to request access.`,
    );
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

  const isEmpty = visibleDocuments.length === 0;

  return (
    <div className="space-y-6 relative">
      {isEmpty && (
        <EmptyState 
          title={audience === "internal" ? "No documents yet" : "No approved documents"}
          message={audience === "internal" ? "There are no documents uploaded for this deal yet." : "No approved documents are available for this deal."}
          action={
            audience === "internal" ? (
              <button
                type="button"
                onClick={() => setIsAddDocOpen(true)}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-acp-bronze to-acp-bronze-dark px-4 text-xs font-bold uppercase tracking-wider text-white shadow-md hover:shadow-glow-bronze cursor-pointer transition-all duration-300"
              >
                <Plus className="h-4 w-4" />
                Add Document
              </button>
            ) : undefined
          }
        />
      )}

      {!isEmpty && (
        <>
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

      {/* Inline status for the document actions. These used to be an alert() or
          a panel inside the file-preview modal; neither survives the modal's
          removal, and a blocking alert was the wrong shape for both anyway. */}
      {docActionError && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 flex items-start justify-between gap-3">
          <span className="text-xs font-semibold text-rose-300 leading-relaxed">{docActionError}</span>
          <button
            type="button"
            onClick={() => setDocActionError("")}
            className="shrink-0 text-slate-400 hover:text-white transition-colors"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {isParsing && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-xs font-semibold text-slate-300">
          {parseJobStatus || "Extracting document text…"}
        </div>
      )}
      {!isParsing && parseError && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs font-semibold text-amber-300">
          {parseError}
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
              {audience === "internal" && <Th>Date Received</Th>}
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 bg-white/[0.01]">
            {filteredDocuments.map((document) => (
              <tr 
                key={document.id} 
                className={cx(
                  "transition-all duration-205 hover:bg-white/[0.02]",
                  audience === "internal" ? "cursor-pointer" : "",
                  selectedDoc?.id === document.id ? "bg-white/[0.04]" : ""
                )}
                onClick={() => {
                  if (audience === "internal") setSelectedDoc(document);
                }}
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
                {audience === "internal" && (
                  <Td className="font-semibold text-slate-350">
                    {formatDate(document.dateReceived) || "Not received"}
                  </Td>
                )}
                <Td className="text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-2">
                    <ButtonLink
                      href={document.driveLink}
                      icon="download"
                      variant="purple"
                      onClick={(e) => downloadDocument(e, document)}
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
        </>
      )}

      {/* Document detail — a centred dialog. It used to fly out of the top-right
          corner as a full-height drawer, which read as a stray notification
          rather than the record you had just clicked. */}
      {selectedDoc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md"
          onClick={() => setSelectedDoc(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`Document ${selectedDoc.indexRef}`}
        >
          <div
            className="w-full max-w-2xl max-h-[88vh] rounded-2xl border border-white/[0.06] bg-acp-ink shadow-2xl flex flex-col overflow-hidden animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
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

            {/* Drawer Body - Scrollable */}
            <div className="flex-1 overflow-y-auto min-h-0 p-6 space-y-6">
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
                
                {audience === "internal" && (
                  <DetailRow icon={<Calendar className="h-4 w-4 text-acp-bronze" />} label="Date Received" value={formatDate(selectedDoc.dateReceived) || "Not logged"} />
                )}
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

            {/* Dialog action — download only; there is no View anywhere now. */}
            <div className="p-6 border-t border-white/5 bg-white/[0.01] grid grid-cols-1 gap-3.5">
              <ButtonLink
                href={selectedDoc.driveLink}
                icon="download"
                variant="purple"
                className="h-11 w-full"
                onClick={(e) => downloadDocument(e, selectedDoc)}
              >
                Download
              </ButtonLink>
            </div>
          </>
          </div>
        </div>
      )}

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

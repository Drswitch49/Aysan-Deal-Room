import { Filter, Files, ShieldAlert, FileText, FileSpreadsheet, FileArchive, CheckCircle2, Search, X, Calendar, User, History, Download, ExternalLink } from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import type { DealDocument } from "../../types/deal";
import { updateAdminDocuments } from "../../api/admin";
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
  return <FileText className="h-4 w-4 text-acp-blue" />;
}

export function DocumentChecklist({ documents, audience, onRefresh }: DocumentChecklistProps) {
  const [statusFilter, setStatusFilter] = useState("All");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDoc, setSelectedDoc] = useState<(DealDocument & { indexRef: string }) | null>(null);

  // Multi-select and Link Editor states
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBatchUpdating, setIsBatchUpdating] = useState(false);
  const [draftLink, setDraftLink] = useState("");
  const [isSavingLink, setIsSavingLink] = useState(false);

  // Synchronise draft link when drawer selection changes
  useEffect(() => {
    if (selectedDoc) {
      setDraftLink(selectedDoc.driveLink || "");
    }
  }, [selectedDoc]);

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
          <div className="rounded-2xl border border-white/[0.06] bg-[#0d0c1d] backdrop-blur-md p-5 shadow-premium-card card-sheen flex items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 border border-white/[0.06] text-acp-purple shadow-sm">
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
          <div className="rounded-2xl border border-white/[0.06] bg-[#0d0c1d] backdrop-blur-md p-5 shadow-premium-card card-sheen flex items-center">
            <ProgressBar value={progress} label="Progress sent to lender" />
          </div>
        </div>
      ) : null}

      {/* Interactive Filter Pills & Search Deck */}
      <div className="rounded-2xl border border-white/[0.06] bg-[#0d0c1d] backdrop-blur-md p-6 shadow-premium-card card-sheen space-y-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pb-3 border-b border-white/5">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 select-none">
            <Filter className="h-4 w-4 text-acp-purple" aria-hidden="true" />
            Document Filters
          </div>
          {/* Live Search Bar */}
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search documents..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 w-full rounded-xl border border-white/[0.06] bg-white/5 pl-10 pr-8 text-xs font-semibold text-white placeholder-slate-500 outline-none transition-all duration-300 focus:border-acp-purple focus:ring-1 focus:ring-acp-purple shadow-sm"
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
        <div className="rounded-2xl border border-acp-purple/20 bg-acp-purple/5 p-5 shadow-soft flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 animate-fade-in-up">
          <div className="flex items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-acp-purple/15 border border-acp-purple/30 text-xs font-bold text-white shadow-sm">
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
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-white/5 border border-white/10 px-4 text-xs font-bold uppercase tracking-wider text-slate-350 hover:bg-white/10 hover:text-white disabled:opacity-40 cursor-pointer transition-all duration-300"
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
        <Table>
          <thead>
            <tr className="border-b border-white/5 bg-white/[0.01]">
              {audience === "internal" && (
                <Th className="w-10">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={handleSelectAllToggle}
                    className="rounded border-white/10 bg-white/5 text-acp-purple focus:ring-acp-purple cursor-pointer h-3.5 w-3.5"
                  />
                </Th>
              )}
              <Th>Index</Th>
              <Th>Document Name</Th>
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
                      className="rounded border-white/10 bg-white/5 text-acp-purple focus:ring-acp-purple cursor-pointer h-3.5 w-3.5"
                    />
                  </Td>
                )}
                <Td className="font-mono text-xs font-bold text-slate-500 select-none">
                  {document.indexRef}
                </Td>
                <Td className="min-w-64 max-w-sm">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/5 border border-white/[0.06] shadow-sm">
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
                  <span className="rounded-full border border-white/[0.06] bg-white/5 px-2.5 py-0.5 text-[10px] font-semibold text-slate-300 uppercase tracking-wide">
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
                    <ButtonLink href={getDriveViewUrl(document.driveLink)} icon="view">
                      View
                    </ButtonLink>
                    <ButtonLink href={getDriveDownloadUrl(document.driveLink)} icon="download" variant="purple">
                      Download
                    </ButtonLink>
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
          "fixed top-0 right-0 h-screen w-full sm:w-[480px] bg-acp-ink border-l border-white/10 z-50 shadow-2xl transition-all duration-450 cubic-bezier(0.16, 1, 0.3, 1) flex flex-col transform",
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
                className="h-8 w-8 flex items-center justify-center rounded-xl border border-white/10 text-slate-400 hover:text-white hover:border-white/20 transition-colors shadow-sm"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Drawer Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Core metrics */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 border border-white/10 bg-white/[0.02] rounded-xl">
                  <span className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-400">File Category</span>
                  <span className="block text-xs font-bold text-white mt-1.5">{selectedDoc.category || "Uncategorized"}</span>
                </div>
                <div className="p-3 border border-white/10 bg-white/[0.02] rounded-xl">
                  <span className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Review Status</span>
                  <div className="mt-1">
                    <StatusBadge status={selectedDoc.status} />
                  </div>
                </div>
              </div>

              {/* Detail fields */}
              <div className="space-y-3.5">
                <h4 className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-455">Document Information</h4>
                
                <DetailRow icon={<Calendar className="h-4 w-4 text-acp-blue" />} label="Date Received" value={formatDate(selectedDoc.dateReceived) || "Not logged"} />
                {selectedDoc.expectedDate && (
                  <DetailRow icon={<Calendar className="h-4 w-4 text-acp-purple" />} label="Expected Date" value={formatDate(selectedDoc.expectedDate)} />
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
                    <ExternalLink className="h-4 w-4 text-acp-purple" />
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
                        className="h-9 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-white placeholder-slate-600 outline-none focus:border-acp-purple focus:ring-1 focus:ring-acp-purple shadow-sm transition-colors duration-300"
                      />
                      <button
                        type="button"
                        onClick={handleSaveLink}
                        disabled={isSavingLink || draftLink === (selectedDoc.driveLink || "")}
                        className="h-9 px-4 rounded-xl bg-gradient-to-r from-acp-purple to-acp-purple-dark text-white text-xs font-bold uppercase tracking-wider disabled:opacity-40 disabled:pointer-events-none hover:shadow-glow-purple cursor-pointer shrink-0 transition-all duration-300"
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
                <div className="p-4 border border-white/10 bg-white/[0.02] rounded-2xl text-xs leading-relaxed text-slate-300 font-medium">
                  {selectedDoc.internalNotes || "No internal notes recorded for this file. Click view to inspect the file directly."}
                </div>
              </div>

              {/* Version History feed */}
              <div className="space-y-3">
                <h4 className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-455 flex items-center gap-1.5">
                  <History className="h-4 w-4 text-slate-400" />
                  Document History Log
                </h4>
                <div className="relative border-l border-white/10 pl-4 space-y-4 text-xs">
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
                href={getDriveViewUrl(selectedDoc.driveLink)}
                icon="view"
                className="h-11 w-full"
              >
                View File
              </ButtonLink>
              <ButtonLink
                href={getDriveDownloadUrl(selectedDoc.driveLink)}
                icon="download"
                variant="purple"
                className="h-11 w-full"
              >
                Download
              </ButtonLink>
            </div>
          </>
        )}
      </div>
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
          ? "bg-gradient-to-r from-acp-purple to-acp-purple-dark text-white border-transparent shadow-md shadow-acp-purple/10"
          : "bg-white/5 border-white/10 text-slate-350 hover:bg-white/10 hover:text-white"
      )}
    >
      <span className="tracking-wide uppercase text-[10px]">{label}</span>
      <span className={cx(
        "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1.5 text-[9px] font-extrabold shadow-sm border",
        active
          ? "bg-white/10 border-white/10 text-white"
          : "bg-white/5 border-white/5 text-slate-400"
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
      <span className="absolute -left-6 top-1 h-2.5 w-2.5 rounded-full bg-acp-purple border-2 border-acp-ink ring-1 ring-white/10" />
      <p className="text-[10px] font-bold text-slate-500">{formatDate(date)}</p>
      <p className="font-semibold text-slate-200 mt-0.5">{action}</p>
      <p className="text-[10px] text-slate-450 font-medium mt-0.5">by {user}</p>
    </div>
  );
}

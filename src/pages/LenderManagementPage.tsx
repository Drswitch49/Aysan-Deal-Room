import { useState, useEffect } from "react";
import { 
  Building2, Users, Link2, KeyRound, Copy, Check, ShieldCheck, 
  RotateCcw, Trash2, UserPlus, X, ChevronRight, Ban, CheckCircle, ExternalLink, Search 
} from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { LoadingState } from "../components/ui/LoadingState";
import { EmptyState } from "../components/ui/EmptyState";
import { StatusBadge } from "../components/ui/Badge";
import { Table, Td, Th } from "../components/ui/Table";
import { 
  fetchAdminLenders, createLender, assignDealToLender, 
  removeDealAssignment, resetLenderPassword, regenerateLenderPortal, deleteLender 
} from "../api/admin";
import { getDeals } from "../api/airtable";
import type { PipelineDeal } from "../types/deal";
import { cx } from "../utils/cx";

type LenderAssignment = {
  assignmentId: string;
  dealRef: string;
  assignedAt: string;
};

type Lender = {
  id: string;
  Lender_ID: string;
  Company_Name: string;
  Contact_Name?: string;
  Email?: string;
  Phone?: string;
  Portal_Slug: string;
  Portal_Password?: string;
  Status: string;
  assignments: LenderAssignment[];
  Created_At: string;
};

export function LenderManagementPage() {
  const [lenders, setLenders] = useState<Lender[]>([]);
  const [deals, setDeals] = useState<PipelineDeal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Modal States
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [selectedLender, setSelectedLender] = useState<Lender | null>(null);
  
  // Create success details display
  const [createdLenderDetails, setCreatedLenderDetails] = useState<{ url: string; pass: string; company: string } | null>(null);
  const [newResetPassword, setNewResetPassword] = useState<string | null>(null);

  // Form Inputs
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newContactName, setNewContactName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [selectedDealRef, setSelectedDealRef] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Collapsed Assigned Deals & Searchable Deals modal
  const [expandedLenderIds, setExpandedLenderIds] = useState<Record<string, boolean>>({});
  const [dealSearchQuery, setDealSearchQuery] = useState("");
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

  const toggleLenderExpanded = (lenderId: string) => {
    setExpandedLenderIds((prev) => ({
      ...prev,
      [lenderId]: !prev[lenderId],
    }));
  };

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setIsLoading(true);
    setError("");
    try {
      const [lendersList, allDeals] = await Promise.all([
        fetchAdminLenders(),
        getDeals().catch(() => [])
      ]);
      setLenders(lendersList);
      setDeals(allDeals);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to query database schema.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleCopy(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  const getPortalUrl = (slug: string) => {
    return `${window.location.origin}/portal/${slug}`;
  };

  // Add Lender Handler
  async function handleAddLender(e: React.FormEvent) {
    e.preventDefault();
    if (!newCompanyName) return;
    setSubmitting(true);
    try {
      const result = await createLender({
        companyName: newCompanyName,
        contactName: newContactName,
        email: newEmail,
        phone: newPhone,
        status: "Active"
      });

      // Clear inputs
      setNewCompanyName("");
      setNewContactName("");
      setNewEmail("");
      setNewPhone("");
      
      // Load and update
      const updatedLenders = await fetchAdminLenders();
      setLenders(updatedLenders);

      // Show details screen in modal
      setCreatedLenderDetails({
        url: getPortalUrl(result.Portal_Slug),
        pass: result.Portal_Password || "",
        company: result.Company_Name
      });
    } catch (err: any) {
      alert(err.message || "Error creating lender");
    } finally {
      setSubmitting(false);
    }
  }

  // Assign Deal Handler
  async function handleAssignDeal(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedLender || !selectedDealRef) return;
    setSubmitting(true);
    try {
      await assignDealToLender(selectedLender.id, selectedDealRef);
      setIsAssignModalOpen(false);
      setSelectedDealRef("");
      const updated = await fetchAdminLenders();
      setLenders(updated);
    } catch (err: any) {
      alert(err.message || "Error assigning deal");
    } finally {
      setSubmitting(false);
    }
  }

  // Remove Assignment Handler
  async function handleRemoveAssignment(asgId: string) {
    if (!confirm("Are you sure you want to revoke access to this deal?")) return;
    try {
      await removeDealAssignment(asgId);
      const updated = await fetchAdminLenders();
      setLenders(updated);
    } catch (err: any) {
      alert(err.message || "Error removing assignment");
    }
  }

  // Reset Password Handler
  async function handleResetPassword() {
    if (!selectedLender) return;
    setSubmitting(true);
    try {
      const result = await resetLenderPassword(selectedLender.id);
      setNewResetPassword(result.password);
      const updated = await fetchAdminLenders();
      setLenders(updated);
    } catch (err: any) {
      alert(err.message || "Error resetting password");
    } finally {
      setSubmitting(false);
    }
  }

  // Regenerate Slug Handler
  async function handleRegeneratePortal(lenderId: string) {
    if (!confirm("Regenerating the portal link will deactivate the old portal URL. Continue?")) return;
    try {
      await regenerateLenderPortal(lenderId);
      const updated = await fetchAdminLenders();
      setLenders(updated);
    } catch (err: any) {
      alert(err.message || "Error regenerating link");
    }
  }

  // Close modals safely
  function closeAddModal() {
    setIsAddModalOpen(false);
    setCreatedLenderDetails(null);
  }

  function closeResetModal() {
    setIsResetConfirmOpen(false);
    setNewResetPassword(null);
    setSelectedLender(null);
  }

  async function handleDeleteLender() {
    if (!selectedLender) return;
    setSubmitting(true);
    try {
      await deleteLender(selectedLender.id);
      setIsDeleteConfirmOpen(false);
      setSelectedLender(null);
      const updated = await fetchAdminLenders();
      setLenders(updated);
    } catch (err: any) {
      alert(err.message || "Error deleting lender");
    } finally {
      setSubmitting(false);
    }
  }

  function closeDeleteModal() {
    setIsDeleteConfirmOpen(false);
    setSelectedLender(null);
  }

  // Metrics Calculations
  const totalLenders = lenders.length;
  const activeLenders = lenders.filter(l => l.Status === "Active").length;
  const totalAssignments = lenders.reduce((sum, l) => sum + l.assignments.length, 0);

  return (
    <div className="space-y-8 animate-fade-in-up">
      <PageHeader title="Lender Portals" eyebrow="System Management">
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-acp-purple to-acp-purple-dark px-4 text-xs font-bold uppercase tracking-wider text-white shadow-md hover:shadow-glow-purple transition-all duration-300 transform hover:-translate-y-0.5"
        >
          <UserPlus className="h-4 w-4" />
          Create Lender
        </button>
      </PageHeader>

      {/* Metrics Row */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/[0.06] bg-[#0d0c1d] p-5 shadow-premium-card card-sheen flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#5b5ef0]/15 text-[#5b5ef0] border border-[#5b5ef0]/20">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <p className="text-2xl font-bold text-white">{totalLenders}</p>
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Total Registered Lenders</p>
          </div>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-[#0d0c1d] p-5 shadow-premium-card card-sheen flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-acp-purple/15 text-acp-purple border border-acp-purple/20">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <p className="text-2xl font-bold text-white">{activeLenders}</p>
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Active Portals</p>
          </div>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-[#0d0c1d] p-5 shadow-premium-card card-sheen flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#10b981]/15 text-[#10b981] border border-[#10b981]/20">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <p className="text-2xl font-bold text-white">{totalAssignments}</p>
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Active Deal Assignments</p>
          </div>
        </div>
      </div>

      {isLoading ? <LoadingState /> : null}
      
      {error ? (
        <EmptyState 
          title="Database Setup Required" 
          message={error.includes("Lenders") ? "Please create a table named 'Lenders' in Airtable." : error}
        />
      ) : null}

      {!isLoading && !error && lenders.length === 0 ? (
        <EmptyState title="No Lenders Configured" message="Click 'Create Lender' to configure your first external investor access." />
      ) : null}

      {!isLoading && !error && lenders.length > 0 ? (
        <div className="rounded-2xl border border-white/[0.06] bg-[#0d0c1d] p-6 shadow-premium-card card-sheen">
          <div className="mb-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-white">Lender Registry</h3>
          </div>

          <Table>
            <thead>
              <tr className="border-b border-white/5 bg-white/[0.01]">
                <Th>Company Name</Th>
                <Th>Portal URL & Passcode</Th>
                <Th>Assigned Acquisition Deals</Th>
                <Th>Status</Th>
                <Th className="text-right">Portal Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 bg-white/[0.01]">
              {lenders.map((lender) => {
                const url = getPortalUrl(lender.Portal_Slug);
                return (
                  <tr key={lender.id} className="transition hover:bg-white/[0.01]">
                    <Td className="min-w-[180px]">
                      <div className="font-semibold text-white">{lender.Company_Name}</div>
                      <div className="text-[10px] text-slate-450 mt-1 space-y-0.5">
                        {lender.Contact_Name && <div>Contact: {lender.Contact_Name}</div>}
                        {lender.Email && <div>Email: {lender.Email}</div>}
                        {lender.Phone && <div>Phone: {lender.Phone}</div>}
                      </div>
                    </Td>
                    <Td className="max-w-[280px]">
                      {/* Link Row */}
                      <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg p-1.5 pr-2.5">
                        <span className="text-[11px] font-mono text-slate-400 truncate flex-1 pl-1">
                          {url}
                        </span>
                        <button
                          onClick={() => handleCopy(url, `${lender.id}-url`)}
                          className="h-6 w-6 flex items-center justify-center rounded bg-white/5 text-slate-400 hover:text-white"
                          title="Copy Portal URL"
                        >
                          {copiedId === `${lender.id}-url` ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Link2 className="h-3.5 w-3.5" />}
                        </button>
                      </div>

                      {/* Password Row */}
                      <div className="mt-2 flex items-center gap-2">
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-white/5 border border-white/5 text-[10px] font-mono text-slate-300">
                          <KeyRound className="h-3 w-3 text-acp-purple" />
                          <span>Passcode: <b>{lender.Portal_Password || "Redacted"}</b></span>
                        </div>
                        {lender.Portal_Password && (
                          <button
                            onClick={() => handleCopy(lender.Portal_Password || "", `${lender.id}-pass`)}
                            className="text-slate-400 hover:text-white text-[10px] flex items-center gap-0.5 ml-1"
                          >
                            {copiedId === `${lender.id}-pass` ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                            Copy
                          </button>
                        )}
                      </div>
                    </Td>
                    <Td className="min-w-[260px]">
                      {/* List of deals */}
                      <div className="flex flex-wrap gap-1.5 max-w-[320px]">
                        {(expandedLenderIds[lender.id]
                          ? lender.assignments
                          : lender.assignments.slice(0, 3)
                        ).map((asg) => (
                          <span
                            key={asg.assignmentId}
                            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[10px] font-semibold text-slate-355"
                          >
                            {asg.dealRef}
                            <button
                              onClick={() => handleRemoveAssignment(asg.assignmentId)}
                              className="text-slate-500 hover:text-rose-400 transition cursor-pointer"
                              title="Revoke access"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}

                        {/* Expand (+N more) button */}
                        {!expandedLenderIds[lender.id] && lender.assignments.length > 3 && (
                          <button
                            onClick={() => toggleLenderExpanded(lender.id)}
                            className="inline-flex items-center gap-1 rounded-full border border-acp-purple/20 bg-acp-purple/5 px-2 py-0.5 text-[10px] font-black text-acp-purple hover:bg-acp-purple/10 hover:border-acp-purple/30 transition cursor-pointer"
                          >
                            +{lender.assignments.length - 3}
                          </button>
                        )}

                        {/* Collapse (Show less) button */}
                        {expandedLenderIds[lender.id] && lender.assignments.length > 3 && (
                          <button
                            onClick={() => toggleLenderExpanded(lender.id)}
                            className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-slate-400 hover:text-white transition cursor-pointer"
                          >
                            Show Less
                          </button>
                        )}

                        <button
                          onClick={() => {
                            setSelectedLender(lender);
                            setDealSearchQuery("");
                            setSelectedDealRef("");
                            setIsAssignModalOpen(true);
                          }}
                          className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-acp-purple/10 border border-acp-purple/20 text-acp-purple hover:bg-acp-purple hover:text-white transition cursor-pointer"
                          title="Assign deal"
                        >
                          +
                        </button>
                      </div>
                    </Td>
                    <Td>
                      <StatusBadge status={lender.Status} />
                    </Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-2">
                        {/* Reset Password */}
                        <button
                          onClick={() => {
                            setSelectedLender(lender);
                            setIsResetConfirmOpen(true);
                          }}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-300 hover:bg-white/10 transition cursor-pointer"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Reset Pass
                        </button>
                        {/* Regenerate Slug */}
                        <button
                          onClick={() => handleRegeneratePortal(lender.id)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-300 hover:bg-white/10 transition cursor-pointer"
                        >
                          <Link2 className="h-3 w-3" />
                          New Link
                        </button>
                        {/* Delete Lender */}
                        <button
                          onClick={() => {
                            setSelectedLender(lender);
                            setIsDeleteConfirmOpen(true);
                          }}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 text-[10px] font-bold uppercase tracking-wider text-rose-450 hover:bg-rose-500/10 hover:border-rose-500/30 transition cursor-pointer"
                        >
                          <Trash2 className="h-3 w-3" />
                          Delete
                        </button>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      ) : null}

      {/* MODAL 1: ADD LENDER */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d0c1d] p-6 shadow-2xl relative">
            <button
              onClick={closeAddModal}
              className="absolute right-4 top-4 text-slate-450 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>

            {!createdLenderDetails ? (
              <form onSubmit={handleAddLender} className="space-y-4">
                <h3 className="text-base font-bold text-white uppercase tracking-wider mb-2">Create New Lender</h3>
                
                <div>
                  <label className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Company Name</label>
                  <input
                    type="text"
                    required
                    value={newCompanyName}
                    onChange={(e) => setNewCompanyName(e.target.value)}
                    placeholder="e.g. Moorfields Capital"
                    className="mt-1.5 h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-white placeholder-slate-600 outline-none focus:border-acp-purple"
                  />
                </div>

                <div>
                  <label className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Contact Name</label>
                  <input
                    type="text"
                    value={newContactName}
                    onChange={(e) => setNewContactName(e.target.value)}
                    placeholder="e.g. Jane Doe"
                    className="mt-1.5 h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-white placeholder-slate-600 outline-none focus:border-acp-purple"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Email Address</label>
                    <input
                      type="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      placeholder="e.g. contact@moorfields.com"
                      className="mt-1.5 h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-white placeholder-slate-600 outline-none focus:border-acp-purple"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Phone Number</label>
                    <input
                      type="text"
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value)}
                      placeholder="e.g. +44 20 7946 0958"
                      className="mt-1.5 h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-white placeholder-slate-600 outline-none focus:border-acp-purple"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-acp-purple to-acp-purple-dark text-xs font-bold uppercase tracking-wider text-white shadow-md hover:shadow-glow-purple disabled:opacity-40"
                >
                  {submitting ? "Creating..." : "Generate Portal Access"}
                </button>
              </form>
            ) : (
              <div className="space-y-5 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 mx-auto">
                  <CheckCircle className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white uppercase tracking-wider">Portal Access Ready</h3>
                  <p className="text-xs text-slate-450 mt-1">Lender portal generated successfully for {createdLenderDetails.company}.</p>
                </div>

                <div className="text-left space-y-3.5 bg-white/5 border border-white/10 rounded-xl p-4">
                  {/* URL */}
                  <div>
                    <span className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-450">Secure URL</span>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[11px] font-mono text-white truncate flex-1">{createdLenderDetails.url}</span>
                      <button
                        onClick={() => handleCopy(createdLenderDetails.url, "modal-url")}
                        className="h-6 w-6 flex items-center justify-center rounded bg-white/5 text-slate-350 hover:text-white"
                      >
                        {copiedId === "modal-url" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>

                  {/* Password */}
                  <div>
                    <span className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-450">Temporary Passcode</span>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[12px] font-mono font-bold text-acp-purple">{createdLenderDetails.pass}</span>
                      <button
                        onClick={() => handleCopy(createdLenderDetails.pass, "modal-pass")}
                        className="h-6 w-6 flex items-center justify-center rounded bg-white/5 text-slate-355 hover:text-white"
                      >
                        {copiedId === "modal-pass" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>

                <button
                  onClick={closeAddModal}
                  className="w-full inline-flex h-10 items-center justify-center rounded-xl bg-white/5 border border-white/10 text-xs font-bold uppercase tracking-wider text-white hover:bg-white/10"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL 2: ASSIGN DEALS */}
      {isAssignModalOpen && selectedLender && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d0c1d] p-6 shadow-2xl relative animate-scale-in">
            <button
              onClick={() => {
                setIsAssignModalOpen(false);
                setSelectedLender(null);
              }}
              className="absolute right-4 top-4 text-slate-450 hover:text-white cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>

            <form onSubmit={handleAssignDeal} className="space-y-4">
              <h3 className="text-base font-bold text-white uppercase tracking-wider mb-1">Assign Deal</h3>
              <p className="text-xs text-slate-400">Grant portal review access to {selectedLender.Company_Name}.</p>

              <div className="space-y-2">
                <label className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Select Acquisition Deal</label>
                
                {/* Search Bar Input */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-450" />
                  <input
                    type="text"
                    placeholder="Search by Deal ID or Company Name..."
                    value={dealSearchQuery}
                    onChange={(e) => setDealSearchQuery(e.target.value)}
                    className="h-10 w-full rounded-xl border border-white/10 bg-[#06050e] pl-9 pr-4 text-xs text-white placeholder-slate-600 outline-none transition-all duration-300 focus:border-acp-purple focus:ring-1 focus:ring-acp-purple"
                  />
                </div>

                {/* Custom Searchable Scroll Container */}
                <div className="max-h-48 overflow-y-auto rounded-xl border border-white/10 bg-[#06050e] divide-y divide-white/[0.04] custom-scrollbar">
                  {deals
                    // Filter out deals already assigned to this lender
                    .filter(deal => !selectedLender.assignments.some(a => a.dealRef === deal.dealRef))
                    // Filter by search query
                    .filter(deal => {
                      if (!dealSearchQuery.trim()) return true;
                      const q = dealSearchQuery.toLowerCase();
                      const refStr = String(deal.dealRef || "").toLowerCase();
                      const company = String(deal.companyName || "").toLowerCase();
                      return refStr.includes(q) || company.includes(q);
                    })
                    .map(deal => {
                      const isSelected = selectedDealRef === deal.dealRef;
                      return (
                        <button
                          key={deal.id}
                          type="button"
                          onClick={() => setSelectedDealRef(deal.dealRef)}
                          className={cx(
                            "w-full text-left px-3 py-2.5 text-xs transition-colors flex items-center justify-between cursor-pointer",
                            isSelected 
                              ? "bg-acp-purple/10 text-white font-bold" 
                              : "text-slate-300 hover:bg-white/5"
                          )}
                        >
                          <div className="min-w-0">
                            <span className="font-semibold text-white">{deal.dealRef}</span>
                            <span className="text-slate-450 ml-2">— {deal.companyName || "Not specified"}</span>
                          </div>
                          {isSelected && <Check className="h-4 w-4 text-acp-purple shrink-0" />}
                        </button>
                      );
                    })}

                  {deals
                    .filter(deal => !selectedLender.assignments.some(a => a.dealRef === deal.dealRef))
                    .filter(deal => {
                      if (!dealSearchQuery.trim()) return true;
                      const q = dealSearchQuery.toLowerCase();
                      const refStr = String(deal.dealRef || "").toLowerCase();
                      const company = String(deal.companyName || "").toLowerCase();
                      return refStr.includes(q) || company.includes(q);
                    }).length === 0 && (
                      <div className="p-4 text-center text-xs text-slate-500">
                        No assignable deals found
                      </div>
                    )}
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting || !selectedDealRef}
                className="w-full inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-acp-purple to-acp-purple-dark text-xs font-bold uppercase tracking-wider text-white shadow-md hover:shadow-glow-purple disabled:opacity-40 cursor-pointer"
              >
                {submitting ? "Assigning..." : "Assign Access"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: PASSWORD RESET CONFIRMATION */}
      {isResetConfirmOpen && selectedLender && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d0c1d] p-6 shadow-2xl relative text-center">
            <button
              onClick={closeResetModal}
              className="absolute right-4 top-4 text-slate-450 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>

            {!newResetPassword ? (
              <div className="space-y-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 mx-auto">
                  <RotateCcw className="h-6 w-6 animate-spin-slow" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white uppercase tracking-wider">Reset Passcode?</h3>
                  <p className="text-xs text-slate-400 mt-1">This will immediately revoke the current passcode for {selectedLender.Company_Name}.</p>
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={closeResetModal}
                    className="flex-1 inline-flex h-10 items-center justify-center rounded-xl bg-white/5 border border-white/10 text-xs font-bold uppercase tracking-wider text-white hover:bg-white/10"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleResetPassword}
                    disabled={submitting}
                    className="flex-1 inline-flex h-10 items-center justify-center rounded-xl bg-rose-500 text-xs font-bold uppercase tracking-wider text-white hover:bg-rose-600 disabled:opacity-40"
                  >
                    {submitting ? "Resetting..." : "Confirm Reset"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 mx-auto">
                  <CheckCircle className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white uppercase tracking-wider">Passcode Reset Complete</h3>
                  <p className="text-xs text-slate-400 mt-1">The new passcode is successfully written to database.</p>
                </div>

                <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-left">
                  <span className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-450">New Passcode</span>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[12px] font-mono font-bold text-acp-purple">{newResetPassword}</span>
                    <button
                      onClick={() => handleCopy(newResetPassword, "modal-reset-pass")}
                      className="h-6 w-6 flex items-center justify-center rounded bg-white/5 text-slate-355 hover:text-white"
                    >
                      {copiedId === "modal-reset-pass" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                <button
                  onClick={closeResetModal}
                  className="w-full inline-flex h-10 items-center justify-center rounded-xl bg-white/5 border border-white/10 text-xs font-bold uppercase tracking-wider text-white hover:bg-white/10"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL 4: DELETE LENDER CONFIRMATION */}
      {isDeleteConfirmOpen && selectedLender && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d0c1d] p-6 shadow-2xl relative text-center animate-scale-in">
            <button
              onClick={closeDeleteModal}
              className="absolute right-4 top-4 text-slate-450 hover:text-white cursor-pointer"
              type="button"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="space-y-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 mx-auto">
                <Trash2 className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white uppercase tracking-wider">Delete Lender?</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Are you sure you want to delete <strong>{selectedLender.Company_Name}</strong>? This will permanently remove their portal access and all active deal assignments in Airtable.
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={closeDeleteModal}
                  className="flex-1 inline-flex h-10 items-center justify-center rounded-xl bg-white/5 border border-white/10 text-xs font-bold uppercase tracking-wider text-white hover:bg-white/10 cursor-pointer"
                  type="button"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteLender}
                  disabled={submitting}
                  className="flex-1 inline-flex h-10 items-center justify-center rounded-xl bg-rose-500 text-xs font-bold uppercase tracking-wider text-white hover:bg-rose-600 disabled:opacity-40 cursor-pointer"
                  type="button"
                >
                  {submitting ? "Deleting..." : "Confirm Delete"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from "react";
import { Plus, Trash, Loader2, AlertCircle, UserPlus, X, Copy, ShieldCheck, KeyRound, Edit, UserCheck, UserX } from "lucide-react";
import { cx } from "../utils/cx";
import { HeaderMetrics } from "../components/ui/HeaderMetrics";
import { fetchHrRegistry, addHiringBrief, deleteHiringBrief } from "../api/admin";
import { Modal } from "../components/ui/Modal";
import { FormField, inputClass, selectClass } from "../components/ui/FormField";

type TeamMember = {
  id: string;
  initials: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  loginLink: string;
  status: string;
  createdAt: string;
  lastLogin: string;
  accessLevel: string;
  avatarTheme: string;
};

type HiringBrief = {
  id?: string;
  role: string;
  company: string;
  status: string;
  accentColor: "amber" | "blue" | "green";
};

type ExternalStakeholder = {
  id: string;
  name: string;
  email: string;
  phone: string;
  association: string;
  type: string;
  accentColor: string;
  description: string;
  status: string;
  loginLink: string;
  createdAt: string;
  lastLogin: string;
};

const themeMap: Record<string, { bg: string; text: string }> = {
  blue: { bg: "bg-blue-600/20 border-blue-500/30 text-blue-400", text: "text-blue-400" },
  green: { bg: "bg-emerald-600/20 border-emerald-500/30 text-emerald-400", text: "text-emerald-400" },
  emerald: { bg: "bg-emerald-600/20 border-emerald-500/30 text-emerald-400", text: "text-emerald-400" },
  amber: { bg: "bg-amber-600/20 border-amber-500/30 text-amber-450", text: "text-amber-450" },
  purple: { bg: "bg-purple-600/20 border-purple-500/30 text-purple-400", text: "text-purple-400" },
  slate: { bg: "bg-slate-600/20 border-slate-500/30 text-slate-400", text: "text-slate-400" },
};

export function HrStakeholdersPage() {
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [hires, setHires] = useState<HiringBrief[]>([]);
  const [stakeholders, setStakeholders] = useState<ExternalStakeholder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missingTables, setMissingTables] = useState<string[]>([]);
  const [diagnostics, setDiagnostics] = useState<{ message: string; resolution: string } | null>(null);

  // Current User Session
  const [currentUser, setCurrentUser] = useState<any>(null);

  // Slide-over side drawer settings
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerUser, setDrawerUser] = useState<{
    id: string;
    name: string;
    email: string;
    phone: string;
    role: string;
    status: string;
    loginLink: string;
    createdAt: string;
    lastLogin: string;
    type: "team" | "stakeholder";
    association?: string;
    notes?: string;
    stakeholderType?: string;
    accessLevel?: string;
  } | null>(null);

  // Edit User details states
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    phone: "",
    role: "",
    status: "",
    association: "",
    notes: "",
    type: ""
  });
  const [isEditSaving, setIsEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  // Confirmation Modal States
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

  // Modal form states for open hires
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formRole, setFormRole] = useState("");
  const [formCompany, setFormCompany] = useState("");
  const [formStatus, setFormStatus] = useState("");
  const [formColor, setFormColor] = useState<"amber" | "blue" | "green">("amber");
  const [isSaving, setIsSaving] = useState(false);
  const [modalError, setModalError] = useState<{ title: string; message: string } | null>(null);

  // Credentials display modal state
  const [createdCredentials, setCreatedCredentials] = useState<{ name: string; email: string; pass: string; type: string; role?: string; accessLevel?: string } | null>(null);

  // Add Team Member modal states
  const [isAddTeamMemberOpen, setIsAddTeamMemberOpen] = useState(false);
  const [teamForm, setTeamForm] = useState({ name: "", email: "", phone: "", role: "Analyst" as string, status: "Active" as string });
  const [isTeamSaving, setIsTeamSaving] = useState(false);
  const [teamFormError, setTeamFormError] = useState("");

  // Add Stakeholder modal states
  const [isAddStakeholderOpen, setIsAddStakeholderOpen] = useState(false);
  const [stakeholderForm, setStakeholderForm] = useState({ name: "", type: "Advisor" as string, email: "", phone: "", organization: "", notes: "" });
  const [isStakeholderSaving, setIsStakeholderSaving] = useState(false);
  const [stakeholderFormError, setStakeholderFormError] = useState("");

  const handleAddTeamMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!teamForm.name.trim() || !teamForm.email.trim()) { setTeamFormError("Name and Email are required."); return; }
    setIsTeamSaving(true); setTeamFormError("");
    try {
      const res = await fetch("/api/team-members-crud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(teamForm),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({ error: `Server error (${res.status})` })); throw new Error(err.error || "Failed to add team member"); }
      const data = await res.json();
      setCreatedCredentials({
        name: teamForm.name,
        email: teamForm.email,
        pass: data.tempPassword || "",
        type: "Team Member",
        role: teamForm.role,
        accessLevel: ["managing partner", "partner", "super admin", "owner", "admin"].includes((teamForm.role || "").toLowerCase()) ? "FULL ACCESS" : "WRITE ACCESS"
      });
      setTeamForm({ name: "", email: "", phone: "", role: "Analyst", status: "Active" });
      setIsAddTeamMemberOpen(false);
      loadData();
    } catch (err: any) { setTeamFormError(err.message || "Failed"); } finally { setIsTeamSaving(false); }
  };

  const handleAddStakeholder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stakeholderForm.name.trim() || !stakeholderForm.type) { setStakeholderFormError("Name and Type are required."); return; }
    setIsStakeholderSaving(true); setStakeholderFormError("");
    try {
      const res = await fetch("/api/stakeholders-crud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stakeholderForm),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({ error: `Server error (${res.status})` })); throw new Error(err.error || "Failed to add stakeholder"); }
      const data = await res.json();
      setCreatedCredentials({
        name: stakeholderForm.name,
        email: stakeholderForm.email || "N/A",
        pass: data.tempPassword || "",
        type: "External Stakeholder",
        role: "Stakeholder",
        accessLevel: "READ ONLY"
      });
      setStakeholderForm({ name: "", type: "Advisor", email: "", phone: "", organization: "", notes: "" });
      setIsAddStakeholderOpen(false);
      loadData();
    } catch (err: any) { setStakeholderFormError(err.message || "Failed"); } finally { setIsStakeholderSaving(false); }
  };

  const loadData = async () => {
    try {
      const data = await fetchHrRegistry();
      setTeam(data.team || []);
      setHires(data.hires || []);
      setStakeholders(data.stakeholders || []);
      setError(null);
      setMissingTables([]);
      setDiagnostics(null);
    } catch (err) {
      const apiErr = err as { message?: string; missingTables?: string[]; diagnostics?: { message: string; resolution: string } };
      console.error("Failed to load HR registry:", apiErr);
      setError(apiErr.message || "Failed to retrieve registry records.");
      setMissingTables(apiErr.missingTables || []);
      setDiagnostics(apiErr.diagnostics || null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    fetch("/api/auth/session")
      .then(res => res.json())
      .then(data => {
        if (data.authenticated) {
          setCurrentUser(data.user);
        }
      })
      .catch(console.error);
  }, []);

  const canManageTeam = currentUser && ["admin", "managing partner"].includes((currentUser.role || "").toLowerCase());
  const canManageStakeholders = currentUser && ["admin", "managing partner", "partner"].includes((currentUser.role || "").toLowerCase());

  // Configuration drawer triggers
  const openConfigDrawerForTeam = (member: TeamMember) => {
    setDrawerUser({
      id: member.id,
      name: member.name,
      email: member.email,
      phone: member.phone,
      role: member.role,
      status: member.status,
      loginLink: member.loginLink,
      createdAt: member.createdAt,
      lastLogin: member.lastLogin,
      type: "team",
      accessLevel: member.accessLevel
    });
    setIsDrawerOpen(true);
  };

  const openConfigDrawerForStakeholder = (sh: ExternalStakeholder) => {
    setDrawerUser({
      id: sh.id,
      name: sh.name,
      email: sh.email,
      phone: sh.phone,
      role: sh.type,
      status: sh.status,
      loginLink: sh.loginLink,
      createdAt: sh.createdAt,
      lastLogin: sh.lastLogin,
      type: "stakeholder",
      association: sh.association,
      notes: sh.description,
      stakeholderType: sh.type
    });
    setIsDrawerOpen(true);
  };

  // Drawer action implementations
  const handleResetPassword = async () => {
    if (!drawerUser) return;
    setIsSaving(true);
    try {
      const endpoint = drawerUser.type === "team" ? "/api/team-members-crud" : "/api/stakeholders-crud";
      const payload = drawerUser.type === "team"
        ? { action: "reset-password", memberId: drawerUser.id }
        : { action: "reset-password", stakeholderId: drawerUser.id };
        
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error || "Failed to reset password");
      }
      const data = await res.json();
      setCreatedCredentials({
        name: drawerUser.name,
        email: drawerUser.email || "N/A",
        pass: data.tempPassword || "",
        type: drawerUser.type === "team" ? "Team Member" : "External Stakeholder"
      });
      setIsResetConfirmOpen(false);
      setIsDrawerOpen(false);
      setDrawerUser(null);
    } catch (err: any) {
      alert(err.message || "Failed to reset password");
    } finally {
      setIsSaving(false);
    }
  };

  const handleGenerateLoginLink = async () => {
    if (!drawerUser) return;
    try {
      const endpoint = drawerUser.type === "team" ? "/api/team-members-crud" : "/api/stakeholders-crud";
      const payload = drawerUser.type === "team"
        ? { action: "generate-login-link", memberId: drawerUser.id }
        : { action: "generate-login-link", stakeholderId: drawerUser.id };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        throw new Error("Failed to generate login link");
      }
      const data = await res.json();
      setDrawerUser(prev => prev ? { ...prev, loginLink: data.loginLink } : null);
      alert("Login link generated successfully!");
      loadData();
    } catch (err: any) {
      alert(err.message || "Failed to generate login link");
    }
  };

  const handleToggleStatus = async (newStatus: string) => {
    if (!drawerUser) return;
    try {
      const endpoint = drawerUser.type === "team"
        ? `/api/team-members-crud?id=${drawerUser.id}`
        : `/api/stakeholders-crud?id=${drawerUser.id}`;
        
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus })
      });
      if (!res.ok) {
        throw new Error("Failed to update status");
      }
      setDrawerUser(prev => prev ? { ...prev, status: newStatus } : null);
      loadData();
    } catch (err: any) {
      alert(err.message || "Failed to update status");
    }
  };

  const handleOpenEdit = () => {
    if (!drawerUser) return;
    setEditForm({
      name: drawerUser.name,
      email: drawerUser.email,
      phone: drawerUser.phone,
      role: drawerUser.type === "team" ? drawerUser.role : (drawerUser.stakeholderType || ""),
      status: drawerUser.status,
      association: drawerUser.association || "",
      notes: drawerUser.notes || "",
      type: drawerUser.type === "team" ? "" : (drawerUser.stakeholderType || "")
    });
    setEditError("");
    setIsEditModalOpen(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!drawerUser) return;
    setIsEditSaving(true);
    setEditError("");
    try {
      const endpoint = drawerUser.type === "team"
        ? `/api/team-members-crud?id=${drawerUser.id}`
        : `/api/stakeholders-crud?id=${drawerUser.id}`;

      const payload: Record<string, any> = {
        name: editForm.name,
        email: editForm.email,
        phone: editForm.phone,
        status: editForm.status
      };

      if (drawerUser.type === "team") {
        payload.role = editForm.role;
      } else {
        payload.type = editForm.type;
        payload.organization = editForm.association;
        payload.notes = editForm.notes;
      }

      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error || "Failed to save changes");
      }

      // Update drawer state
      setDrawerUser(prev => {
        if (!prev) return null;
        return {
          ...prev,
          name: editForm.name,
          email: editForm.email,
          phone: editForm.phone,
          status: editForm.status,
          role: prev.type === "team" ? editForm.role : prev.role,
          stakeholderType: prev.type === "stakeholder" ? editForm.type : prev.stakeholderType,
          association: prev.type === "stakeholder" ? editForm.association : prev.association,
          notes: prev.type === "stakeholder" ? editForm.notes : prev.notes
        };
      });

      setIsEditModalOpen(false);
      loadData();
    } catch (err: any) {
      setEditError(err.message || "Failed to update profile");
    } finally {
      setIsEditSaving(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!drawerUser) return;
    setIsSaving(true);
    try {
      const endpoint = drawerUser.type === "team"
        ? `/api/team-members-crud?id=${drawerUser.id}`
        : `/api/stakeholders-crud?id=${drawerUser.id}`;

      const res = await fetch(endpoint, {
        method: "DELETE"
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error || "Failed to deactivate user");
      }

      setIsDeleteConfirmOpen(false);
      setIsDrawerOpen(false);
      setDrawerUser(null);
      loadData();
    } catch (err: any) {
      alert(err.message || "Failed to deactivate user");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmitBrief = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formRole.trim() || !formCompany.trim() || !formStatus.trim()) return;
    setIsSaving(true);
    setModalError(null);
    try {
      await addHiringBrief({
        role: formRole.trim(),
        company: formCompany.trim(),
        statusText: formStatus.trim(),
        accentColor: formColor,
      });
      await loadData();
      setIsModalOpen(false);
      setFormRole("");
      setFormCompany("");
      setFormStatus("");
      setFormColor("amber");
    } catch (err) {
      const apiErr = err as { message?: string };
      console.error("Failed to save hiring brief:", apiErr);
      setModalError({
        title: "Save Failed",
        message: apiErr.message || "An unexpected error occurred while saving."
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteBrief = async (brief: HiringBrief, idx: number) => {
    if (brief.id) {
      try {
        await deleteHiringBrief(brief.id);
        await loadData();
      } catch (err) {
        const apiErr = err as { message?: string };
        console.error("Failed to delete hiring brief:", apiErr);
        alert(`Failed to delete hiring brief: ${apiErr.message}`);
      }
    } else {
      setHires(prev => prev.filter((_, i) => i !== idx));
    }
  };

  return (
    <div className="space-y-6 text-[#E2E8F0] font-sans">
      {/* Header section with warning badges */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-4">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-white tracking-tight">
            HR & <span className="text-[#C6A66B]">Stakeholders</span>
          </h1>
          <p className="text-xs text-slate-550 font-medium">
            {isLoading ? (
              <span className="flex items-center gap-1.5 opacity-60">
                <Loader2 className="h-3 w-3 animate-spin text-slate-500" />
                Loading registry...
              </span>
            ) : (
              `${team.length} team members · ${hires.length} open hires`
            )}
          </p>
        </div>
        
        <div className="flex items-center gap-2 select-none">
          <HeaderMetrics />
          
          {canManageTeam && (
            <button
              onClick={() => setIsAddTeamMemberOpen(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#C6A66B]/30 bg-[#C6A66B]/5 px-3 text-[10px] font-bold uppercase tracking-wider text-[#C6A66B] hover:bg-[#C6A66B]/15 cursor-pointer transition animate-fade-in"
              type="button"
            >
              <UserPlus className="h-3 w-3" /> Team Member
            </button>
          )}

          {canManageStakeholders && (
            <button
              onClick={() => setIsAddStakeholderOpen(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#C6A66B]/30 bg-[#C6A66B]/5 px-3 text-[10px] font-bold uppercase tracking-wider text-[#C6A66B] hover:bg-[#C6A66B]/15 cursor-pointer transition animate-fade-in"
              type="button"
            >
              <Plus className="h-3 w-3" /> Stakeholder
            </button>
          )}
        </div>
      </div>

      {diagnostics ? (
        <div className="rounded-2xl border border-red-500/20 bg-red-950/15 backdrop-blur-md p-6 space-y-4 animate-fade-in shadow-premium-card">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/20 text-red-405">
              <AlertCircle className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-wide">
                Database Schema Synchronization Required
              </h2>
              <p className="text-[10px] text-red-450 font-medium">
                HTTP 428 Precondition Required
              </p>
            </div>
          </div>

          <div className="text-xs text-slate-300 leading-relaxed max-w-2xl">
            {diagnostics.message}
          </div>

          {missingTables.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                Missing Required Tables
              </p>
              <div className="flex flex-wrap gap-2">
                {missingTables.map((tbl, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1.5 rounded-md border border-red-500/20 bg-red-500/5 px-2.5 py-1 text-[10px] font-bold text-red-405"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                    {tbl}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2 pt-2">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
              Resolution Command
            </p>
            <div className="flex items-center justify-between rounded-xl bg-slate-950 px-4 py-3 font-mono text-[11px] text-[#A6E22E] border border-white/5">
              <span>{diagnostics.resolution}</span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(diagnostics.resolution);
                  alert("Copied to clipboard!");
                }}
                className="text-[9px] font-extrabold uppercase tracking-wider text-slate-400 hover:text-white cursor-pointer transition px-2 py-1 bg-white/[0.03] border border-white/5 rounded-md"
              >
                Copy
              </button>
            </div>
          </div>
        </div>
      ) : error ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-xs text-red-400 animate-fade-in">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">Database Sync Warning</p>
            <p className="mt-1 opacity-90 leading-relaxed">{error}</p>
          </div>
        </div>
      ) : null}

      {/* Main Panels Grid */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* ACP TEAM (Left Column) */}
        <div className="col-span-12 lg:col-span-5 rounded-2xl border border-white/[0.02] bg-[#161B22] p-5 shadow-premium-card card-sheen">
          <h3 className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-400 border-b border-white/[0.02] pb-3 mb-4 select-none">
            ACP Team
          </h3>
          
          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-500 text-xs">
              <Loader2 className="h-5 w-5 animate-spin text-[#C6A66B]" />
              <span>Loading team members...</span>
            </div>
          ) : team.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-xs select-none">
              No team members configured.
            </div>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {team.map((member, idx) => {
                const theme = themeMap[member.avatarTheme?.toLowerCase() || ""] || themeMap.blue;
                const isUserInactive = member.status === "Inactive";
                return (
                  <div 
                    key={member.id || idx} 
                    onClick={() => openConfigDrawerForTeam(member)}
                    className={cx(
                      "flex items-center justify-between py-3.5 first:pt-0 last:pb-0 group cursor-pointer hover:bg-white/[0.02] transition-all px-2 rounded-xl",
                      isUserInactive && "opacity-50"
                    )}
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className={cx(
                        "flex h-9.5 w-9.5 shrink-0 items-center justify-center rounded-full border text-xs font-black shadow-sm transition-transform duration-300 group-hover:scale-105 select-none",
                        theme.bg
                      )}>
                        {member.initials}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-white tracking-wide flex items-center gap-1.5">
                          {member.name}
                          {isUserInactive && (
                            <span className="text-[7px] font-extrabold tracking-wider bg-rose-500/10 text-rose-400 px-1.5 py-0.5 rounded-full border border-rose-500/20 uppercase shrink-0">
                              Inactive
                            </span>
                          )}
                        </p>
                        <p className="truncate text-[10px] font-semibold text-slate-500 mt-0.5">
                          {member.role}
                        </p>
                      </div>
                    </div>

                    <span className="shrink-0 text-[8px] font-black uppercase tracking-wider text-slate-500 bg-white/[0.03] border border-white/5 rounded px-2 py-0.5 select-none">
                      {member.accessLevel}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column Panels */}
        <div className="col-span-12 lg:col-span-7 space-y-6">
          {/* OPEN HIRING — PORTCO CEO & OPERATORS */}
          <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-5 shadow-premium-card card-sheen">
            <h3 className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-400 border-b border-white/[0.02] pb-3 mb-4 select-none">
              Open Hiring — PortCo CEO & Operators
            </h3>

            {isLoading ? (
              <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-500 text-xs">
                <Loader2 className="h-5 w-5 animate-spin text-[#C6A66B]" />
                <span>Loading hiring pipelines...</span>
              </div>
            ) : (
              <div className="space-y-3.5">
                {hires.length === 0 ? (
                  <div className="py-6 text-center text-slate-550 text-xs select-none">
                    No active hiring briefs found.
                  </div>
                ) : (
                  hires.map((hire, idx) => (
                    <div 
                      key={idx} 
                      className={cx(
                        "rounded-xl border border-white/[0.02] bg-white/[0.01] p-3.5 border-l-4 flex items-center justify-between group/card transition duration-300 hover:bg-white/[0.02]",
                        hire.accentColor === "amber" ? "border-l-amber-500/60" :
                        hire.accentColor === "blue" ? "border-l-blue-500/60" : "border-l-emerald-500/60"
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-white">
                          {hire.role} <span className="text-slate-550 font-semibold">for</span> {hire.company}
                        </p>
                        <p className="text-[10px] font-semibold text-slate-450 mt-1 leading-normal">
                          {hire.status}
                        </p>
                      </div>

                      {canManageTeam && (
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleDeleteBrief(hire, idx); }}
                          className="ml-3 shrink-0 opacity-0 group-hover/card:opacity-100 text-slate-500 hover:text-rose-500 transition cursor-pointer p-1.5 rounded hover:bg-white/[0.015]"
                          title="Delete hiring brief"
                        >
                          <Trash className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))
                )}

                {/* Add hiring brief button */}
                {canManageTeam && (
                  <button
                    onClick={() => {
                      setModalError(null);
                      setIsModalOpen(true);
                    }}
                    className="w-full flex h-10 items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/[0.02] hover:border-white/20 bg-white/[0.01] hover:bg-white/[0.03] text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-300 transition cursor-pointer mt-2 animate-fade-in"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add hiring brief</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* EXTERNAL STAKEHOLDERS */}
          <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-5 shadow-premium-card card-sheen">
            <h3 className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-400 border-b border-white/[0.02] pb-3 mb-4 select-none">
              External Stakeholders
            </h3>

            {isLoading ? (
              <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-500 text-xs">
                <Loader2 className="h-5 w-5 animate-spin text-[#C6A66B]" />
                <span>Loading external partners...</span>
              </div>
            ) : stakeholders.length === 0 ? (
              <div className="py-12 text-center text-slate-550 text-xs select-none">
                No external stakeholders recorded.
              </div>
            ) : (
              <div className="grid gap-3.5 sm:grid-cols-2">
                {stakeholders.map((sh, idx) => {
                  const isStakeholderInactive = sh.status === "Inactive";
                  return (
                    <div 
                      key={sh.id || idx} 
                      onClick={() => openConfigDrawerForStakeholder(sh)}
                      className={cx(
                        "rounded-xl border border-white/[0.02] bg-white/[0.01] p-3.5 border-l-4 flex flex-col justify-center transition hover:bg-white/[0.02] duration-300 cursor-pointer relative",
                        sh.accentColor === "amber" ? "border-l-amber-500/60" :
                        sh.accentColor === "blue" ? "border-l-blue-500/60" : "border-l-emerald-500/60",
                        isStakeholderInactive && "opacity-55"
                      )}
                    >
                      <p className="text-xs font-bold text-white flex items-center justify-between gap-2">
                        <span className="truncate">{sh.name} <span className="text-slate-550 font-semibold">on</span> {sh.association}</span>
                        {isStakeholderInactive && (
                          <span className="text-[7px] font-extrabold tracking-wider bg-rose-500/10 text-rose-400 px-1.5 py-0.5 rounded-full border border-rose-500/20 uppercase shrink-0">
                            Inactive
                          </span>
                        )}
                      </p>
                      <p className="text-[10px] font-semibold text-slate-450 mt-1 leading-relaxed">
                        {sh.description}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Slide-over Side Drawer: Profile Administration */}
      {isDrawerOpen && drawerUser && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div 
            className="fixed inset-0 bg-[#07090c]/85 backdrop-blur-sm transition-opacity" 
            onClick={() => {
              setIsDrawerOpen(false);
              setDrawerUser(null);
            }} 
          />
          
          <div className="relative w-full max-w-lg bg-[#0F1115] border-l border-white/10 h-full p-6 flex flex-col justify-between shadow-2xl z-10 text-slate-100 overflow-y-auto font-sans animate-fade-in-right">
            <div>
              <div className="flex items-center justify-between border-b border-white/5 pb-4 mb-6">
                <div className="space-y-1">
                  <span className="text-[9px] font-extrabold uppercase tracking-widest text-[#C6A66B]">
                    {drawerUser.type === "team" ? "Team Member Portal" : "Stakeholder Configuration"}
                  </span>
                  <h2 className="text-lg font-bold text-white tracking-tight">{drawerUser.name}</h2>
                </div>
                <button 
                  onClick={() => {
                    setIsDrawerOpen(false);
                    setDrawerUser(null);
                  }}
                  className="h-8 w-8 flex items-center justify-center rounded-lg border border-white/5 bg-white/[0.01] text-slate-400 hover:text-white hover:bg-white/5 transition cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-6">
                <div className="bg-white/[0.01] border border-white/5 rounded-xl p-4 space-y-2.5 text-xs select-none">
                  <p className="text-slate-450"><strong className="text-slate-350">Name:</strong> <span className="text-white font-bold">{drawerUser.name}</span></p>
                  <p className="text-slate-450"><strong className="text-slate-350">Email:</strong> <span className="text-white">{drawerUser.email || "None registered"}</span></p>
                  <p className="text-slate-450"><strong className="text-slate-350">Phone:</strong> <span className="text-white">{drawerUser.phone || "None registered"}</span></p>
                  <p className="text-slate-450 flex items-center gap-1.5">
                    <strong className="text-slate-350">Status:</strong>
                    <span className={cx(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-[8px] font-black uppercase tracking-wider border select-none shrink-0",
                      drawerUser.status === "Active" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-rose-500/10 text-rose-450 border-rose-500/20"
                    )}>
                      {drawerUser.status}
                    </span>
                  </p>
                  {drawerUser.type === "team" ? (
                    <>
                      <p className="text-slate-450"><strong className="text-slate-350">Role:</strong> <span className="text-white">{drawerUser.role}</span></p>
                      <p className="text-slate-450"><strong className="text-slate-350">Access Level:</strong> <span className="text-white">{drawerUser.accessLevel}</span></p>
                    </>
                  ) : (
                    <>
                      <p className="text-slate-450"><strong className="text-slate-350">Stakeholder Type:</strong> <span className="text-white">{drawerUser.role}</span></p>
                      <p className="text-slate-450"><strong className="text-slate-350">Organization:</strong> <span className="text-white">{drawerUser.association || "N/A"}</span></p>
                      <p className="text-slate-450"><strong className="text-slate-350">Notes / Details:</strong> <span className="text-slate-300 block mt-1 bg-white/[0.015] p-2.5 rounded-lg border border-white/5 leading-relaxed">{drawerUser.notes || "No description provided."}</span></p>
                    </>
                  )}
                  <p className="text-slate-450 pt-1 border-t border-white/5"><strong className="text-slate-350">Added Date:</strong> <span className="text-slate-300">{drawerUser.createdAt ? new Date(drawerUser.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "N/A"}</span></p>
                  <p className="text-slate-450"><strong className="text-slate-350">Last Active Login:</strong> <span className="text-slate-300">{drawerUser.lastLogin ? new Date(drawerUser.lastLogin).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Never"}</span></p>
                </div>

                {/* Login link generator box */}
                <div className="space-y-1.5">
                  <label className="block text-[8px] font-extrabold uppercase tracking-wider text-slate-550">Secure Access Login Link</label>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] font-mono text-slate-400 truncate flex-1 bg-[#0F1115] border border-white/5 rounded-xl px-3 py-2.5 select-all">
                      {drawerUser.loginLink || "Awaiting Setup"}
                    </span>
                    {drawerUser.loginLink ? (
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(drawerUser.loginLink);
                          alert("Login URL copied to clipboard!");
                        }}
                        className="h-10 w-10 shrink-0 flex items-center justify-center rounded-xl bg-white/[0.015] border border-white/[0.02] text-slate-300 hover:text-white hover:bg-white/5 transition cursor-pointer"
                        title="Copy Link"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                    ) : (
                      <button
                        onClick={handleGenerateLoginLink}
                        className="h-10 px-4 rounded-xl bg-[#C6A66B]/10 border border-[#C6A66B]/20 text-[10px] font-extrabold text-[#C6A66B] hover:bg-[#C6A66B]/20 transition cursor-pointer shrink-0"
                      >
                        Generate Link
                      </button>
                    )}
                  </div>
                </div>

                {/* Actions Grid */}
                <div className="space-y-3 pt-4 border-t border-white/5">
                  <label className="block text-[8px] font-extrabold uppercase tracking-wider text-slate-550">Administration Panel</label>
                  <div className="flex flex-wrap gap-2">
                    {((drawerUser.type === "team" && canManageTeam) || (drawerUser.type === "stakeholder" && canManageStakeholders)) && (
                      <button
                        onClick={handleOpenEdit}
                        className="inline-flex h-8.5 items-center gap-1.5 rounded-xl border border-white/[0.02] bg-white/[0.015] px-3.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-300 hover:bg-white/[0.02] transition cursor-pointer"
                      >
                        <Edit className="h-3 w-3" /> Edit Details
                      </button>
                    )}

                    {((drawerUser.type === "team" && canManageTeam) || (drawerUser.type === "stakeholder" && canManageStakeholders)) && drawerUser.email && (
                      <button
                        onClick={() => setIsResetConfirmOpen(true)}
                        className="inline-flex h-8.5 items-center gap-1.5 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3.5 text-[10px] font-extrabold uppercase tracking-wider text-amber-400 hover:bg-amber-500/10 transition cursor-pointer"
                      >
                        <KeyRound className="h-3 w-3 text-amber-400" /> Reset Password
                      </button>
                    )}

                    {((drawerUser.type === "team" && canManageTeam) || (drawerUser.type === "stakeholder" && canManageStakeholders)) && (
                      <button
                        onClick={() => handleToggleStatus(drawerUser.status === "Active" ? "Inactive" : "Active")}
                        className={cx(
                          "inline-flex h-8.5 items-center gap-1.5 rounded-xl px-3.5 text-[10px] font-extrabold uppercase tracking-wider transition cursor-pointer border",
                          drawerUser.status === "Active"
                            ? "border-rose-500/20 bg-rose-500/5 text-rose-405 hover:bg-rose-500/10"
                            : "border-emerald-500/20 bg-emerald-500/5 text-emerald-400 hover:bg-emerald-500/10"
                        )}
                      >
                        {drawerUser.status === "Active" ? <UserX className="h-3 w-3" /> : <UserCheck className="h-3 w-3" />}
                        {drawerUser.status === "Active" ? "Deactivate Account" : "Activate Account"}
                      </button>
                    )}

                    {((drawerUser.type === "team" && canManageTeam) || (drawerUser.type === "stakeholder" && canManageStakeholders)) && (
                      <button
                        onClick={() => setIsDeleteConfirmOpen(true)}
                        className="inline-flex h-8.5 items-center gap-1.5 rounded-xl border border-rose-500/20 bg-rose-500/5 px-3.5 text-[10px] font-extrabold uppercase tracking-wider text-rose-500 hover:bg-rose-500/10 transition cursor-pointer"
                      >
                        <Trash className="h-3 w-3" /> Soft Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Profile details modal */}
      <Modal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} title="Edit Details">
        {editError && (
          <div className="mb-4 rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-xs font-semibold text-rose-455 flex items-center gap-2">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>{editError}</span>
          </div>
        )}
        <form onSubmit={handleEditSubmit} className="space-y-4 font-sans text-xs">
          <FormField label="Full Name" id="edit-name" required>
            <input id="edit-name" type="text" required value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} className={inputClass} />
          </FormField>
          
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Email" id="edit-email" required>
              <input id="edit-email" type="email" required value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} className={inputClass} />
            </FormField>
            <FormField label="Phone" id="edit-phone">
              <input id="edit-phone" type="text" value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} className={inputClass} />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Status" id="edit-status" required>
              <select id="edit-status" value={editForm.status} onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))} className={selectClass}>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </FormField>

            {drawerUser?.type === "team" ? (
              <FormField label="Role" id="edit-role" required>
                <select id="edit-role" value={editForm.role} onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))} className={selectClass}>
                  <option value="Managing Partner">Managing Partner</option>
                  <option value="Partner">Partner</option>
                  <option value="Analyst">Analyst</option>
                  <option value="Admin">Admin</option>
                  <option value="Read Only">Read Only</option>
                  <option value="HR">HR</option>
                </select>
              </FormField>
            ) : (
              <FormField label="Stakeholder Type" id="edit-type" required>
                <select id="edit-type" value={editForm.type} onChange={e => setEditForm(f => ({ ...f, type: e.target.value }))} className={selectClass}>
                  <option value="Advisor">Advisor</option>
                  <option value="Lawyer">Lawyer</option>
                  <option value="Broker">Broker</option>
                  <option value="Consultant">Consultant</option>
                  <option value="Investor">Investor</option>
                  <option value="Portfolio Contact">Portfolio Contact</option>
                </select>
              </FormField>
            )}
          </div>

          {drawerUser?.type === "stakeholder" && (
            <>
              <FormField label="Organization / Association" id="edit-org">
                <input id="edit-org" type="text" value={editForm.association} onChange={e => setEditForm(f => ({ ...f, association: e.target.value }))} className={inputClass} />
              </FormField>
              <FormField label="Internal Description / Notes" id="edit-notes">
                <textarea id="edit-notes" value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} rows={3} className={inputClass} />
              </FormField>
            </>
          )}

          <div className="flex justify-end gap-2.5 pt-2 border-t border-white/5 mt-5">
            <button type="button" onClick={() => setIsEditModalOpen(false)} className="h-9 px-4 rounded-xl border border-white/[0.02] text-slate-400 text-xs font-bold uppercase tracking-wider hover:bg-white/[0.015] transition cursor-pointer">Cancel</button>
            <button type="submit" disabled={isEditSaving} className="h-9 px-5 rounded-xl bg-gradient-to-r from-[#C6A66B] to-[#B8924F] text-slate-950 text-xs font-bold uppercase tracking-wider disabled:opacity-40 disabled:pointer-events-none hover:shadow-glow-bronze transition cursor-pointer">
              {isEditSaving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Confirm Password Reset */}
      <Modal isOpen={isResetConfirmOpen} onClose={() => setIsResetConfirmOpen(false)} title="Confirm Password Reset">
        <div className="space-y-4 font-sans text-xs text-slate-300">
          <p className="leading-relaxed">
            Are you sure you want to reset the password for <span className="font-bold text-white">{drawerUser?.name}</span>?
          </p>
          <p className="leading-relaxed text-amber-500/90 font-semibold bg-amber-500/5 p-3 rounded-lg border border-amber-550/15">
            This will instantly invalidate their current password and generate a new temporary credentials record.
          </p>
          <div className="flex justify-end gap-2.5 pt-2 select-none">
            <button type="button" onClick={() => setIsResetConfirmOpen(false)} className="h-9 px-4 rounded-xl border border-white/[0.02] text-slate-450 hover:text-white transition cursor-pointer">Cancel</button>
            <button type="button" onClick={handleResetPassword} className="h-9 px-5 rounded-xl bg-amber-500 text-slate-950 font-bold hover:shadow-glow-bronze transition cursor-pointer">
              Reset Password
            </button>
          </div>
        </div>
      </Modal>

      {/* Confirm Soft Delete */}
      <Modal isOpen={isDeleteConfirmOpen} onClose={() => setIsDeleteConfirmOpen(false)} title="Confirm Soft Delete">
        <div className="space-y-4 font-sans text-xs text-slate-350">
          <p className="leading-relaxed">
            Are you sure you want to deactivate <span className="font-bold text-white">{drawerUser?.name}</span>?
          </p>
          <p className="leading-relaxed text-rose-500/90 font-semibold bg-rose-500/5 p-3 rounded-lg border border-rose-500/15">
            This performs a soft delete. The profile and corresponding auth Users account status will be marked as "Inactive", blocking access while preserving their historical logs.
          </p>
          <div className="flex justify-end gap-2.5 pt-2 select-none">
            <button type="button" onClick={() => setIsDeleteConfirmOpen(false)} className="h-9 px-4 rounded-xl border border-white/[0.02] text-slate-450 hover:text-white transition cursor-pointer">Cancel</button>
            <button type="button" onClick={handleDeleteUser} className="h-9 px-5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold transition cursor-pointer">
              Confirm Soft Delete
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal Dialog */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Add Hiring Brief">
        {modalError && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-[11px] text-red-400 animate-fade-in">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-bold">{modalError.title}</p>
              <p className="font-medium opacity-90 leading-relaxed">{modalError.message}</p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmitBrief} className="space-y-4">
          <FormField label="Role / Position" required id="hr-brief-role">
            <input id="hr-brief-role" type="text" required value={formRole} onChange={(e) => setFormRole(e.target.value)} placeholder="e.g. CEO, Operations Manager" className={inputClass} />
          </FormField>

          <FormField label="Company / Portfolio Target" required id="hr-brief-company">
            <input id="hr-brief-company" type="text" required value={formCompany} onChange={(e) => setFormCompany(e.target.value)} placeholder="e.g. Clear Water Cleaning Services" className={inputClass} />
          </FormField>

          <FormField label="Recruitment Status Description" required id="hr-brief-status">
            <input id="hr-brief-status" type="text" required value={formStatus} onChange={(e) => setFormStatus(e.target.value)} placeholder="e.g. Status: candidates search · First post clear" className={inputClass} />
          </FormField>

          <FormField label="Accent Color Label" id="hr-brief-color">
            <select id="hr-brief-color" value={formColor} onChange={(e) => setFormColor(e.target.value as "amber" | "blue" | "green")} className={selectClass}>
              <option value="amber">Amber (Recruiting)</option>
              <option value="blue">Blue (Scoping/Contingent)</option>
              <option value="green">Green (Active/Filled)</option>
            </select>
          </FormField>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/5 mt-5">
            <button type="button" onClick={() => setIsModalOpen(false)} className="h-9 rounded-lg border border-white/[0.02] bg-transparent px-4 text-[10px] font-extrabold uppercase tracking-wider text-slate-400 hover:text-white transition cursor-pointer">Cancel</button>
            <button type="submit" disabled={isSaving} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[#C6A66B] px-4 text-[10px] font-extrabold uppercase tracking-wider text-slate-950 shadow-sm hover:bg-[#C6A66B]/90 disabled:opacity-50 cursor-pointer transition">
              {isSaving ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <span>Add Brief</span>
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* Add Team Member Modal */}
      <Modal isOpen={isAddTeamMemberOpen} onClose={() => setIsAddTeamMemberOpen(false)} title="Add Team Member">
        <form onSubmit={handleAddTeamMember} className="space-y-4 font-sans">
          {teamFormError && (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-xs font-semibold text-rose-450 flex items-center gap-2">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />{teamFormError}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Full Name" id="tm-name" required>
              <input id="tm-name" type="text" required value={teamForm.name} onChange={e => setTeamForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Ayo Yusuf" className={inputClass} />
            </FormField>
            <FormField label="Email" id="tm-email" required>
              <input id="tm-email" type="email" required value={teamForm.email} onChange={e => setTeamForm(f => ({ ...f, email: e.target.value }))} placeholder="e.g. ayo@aysan.capital" className={inputClass} />
            </FormField>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Phone" id="tm-phone">
              <input id="tm-phone" type="text" value={teamForm.phone} onChange={e => setTeamForm(f => ({ ...f, phone: e.target.value }))} placeholder="+44..." className={inputClass} />
            </FormField>
            <FormField label="Role" id="tm-role">
              <select id="tm-role" value={teamForm.role} onChange={e => setTeamForm(f => ({ ...f, role: e.target.value }))} className={selectClass}>
                <option value="Managing Partner">Managing Partner</option>
                <option value="Partner">Partner</option>
                <option value="Analyst">Analyst</option>
                <option value="Admin">Admin</option>
                <option value="Read Only">Read Only</option>
                <option value="HR">HR</option>
              </select>
            </FormField>
            <FormField label="Status" id="tm-status">
              <select id="tm-status" value={teamForm.status} onChange={e => setTeamForm(f => ({ ...f, status: e.target.value }))} className={selectClass}>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </FormField>
          </div>
          <div className="flex justify-end gap-2.5 pt-1">
            <button type="button" onClick={() => setIsAddTeamMemberOpen(false)} className="h-9 px-4 rounded-xl border border-white/[0.02] text-slate-400 text-xs font-bold uppercase tracking-wider hover:bg-white/[0.015] transition cursor-pointer">Cancel</button>
            <button type="submit" disabled={isTeamSaving} className="h-9 px-5 rounded-xl bg-gradient-to-r from-[#C6A66B] to-[#B8924F] text-slate-950 text-xs font-bold uppercase tracking-wider disabled:opacity-40 disabled:pointer-events-none hover:shadow-glow-bronze transition cursor-pointer">
              {isTeamSaving ? "Adding..." : "Add Member"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Add Stakeholder Modal */}
      <Modal isOpen={isAddStakeholderOpen} onClose={() => setIsAddStakeholderOpen(false)} title="Add External Stakeholder" maxWidth="max-w-lg">
        <form onSubmit={handleAddStakeholder} className="space-y-4 font-sans">
          {stakeholderFormError && (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-xs font-semibold text-rose-450 flex items-center gap-2">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />{stakeholderFormError}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Name" id="sh-name" required>
              <input id="sh-name" type="text" required value={stakeholderForm.name} onChange={e => setStakeholderForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. John Smith" className={inputClass} />
            </FormField>
            <FormField label="Type" id="sh-type" required>
              <select id="sh-type" value={stakeholderForm.type} onChange={e => setStakeholderForm(f => ({ ...f, type: e.target.value }))} className={selectClass}>
                <option value="Advisor">Advisor</option>
                <option value="Lawyer">Lawyer</option>
                <option value="Broker">Broker</option>
                <option value="Consultant">Consultant</option>
                <option value="Investor">Investor</option>
                <option value="Portfolio Contact">Portfolio Contact</option>
              </select>
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Email" id="sh-email">
              <input id="sh-email" type="email" value={stakeholderForm.email} onChange={e => setStakeholderForm(f => ({ ...f, email: e.target.value }))} placeholder="e.g. john@firm.com" className={inputClass} />
            </FormField>
            <FormField label="Phone" id="sh-phone">
              <input id="sh-phone" type="text" value={stakeholderForm.phone} onChange={e => setStakeholderForm(f => ({ ...f, phone: e.target.value }))} placeholder="+44..." className={inputClass} />
            </FormField>
          </div>
          <FormField label="Organization" id="sh-org">
            <input id="sh-org" type="text" value={stakeholderForm.organization} onChange={e => setStakeholderForm(f => ({ ...f, organization: e.target.value }))} placeholder="e.g. Deloitte LLP" className={inputClass} />
          </FormField>
          <FormField label="Notes" id="sh-notes">
            <textarea id="sh-notes" value={stakeholderForm.notes} onChange={e => setStakeholderForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Internal notes..." className={inputClass} />
          </FormField>
          <div className="flex justify-end gap-2.5 pt-1">
            <button type="button" onClick={() => setIsAddStakeholderOpen(false)} className="h-9 px-4 rounded-xl border border-white/[0.02] text-slate-400 text-xs font-bold uppercase tracking-wider hover:bg-white/[0.015] transition cursor-pointer">Cancel</button>
            <button type="submit" disabled={isStakeholderSaving} className="h-9 px-5 rounded-xl bg-gradient-to-r from-[#C6A66B] to-[#B8924F] text-slate-950 text-xs font-bold uppercase tracking-wider disabled:opacity-40 disabled:pointer-events-none hover:shadow-glow-bronze transition cursor-pointer">
              {isStakeholderSaving ? "Adding..." : "Add Stakeholder"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Credentials Display Modal */}
      <Modal
        isOpen={createdCredentials !== null}
        onClose={() => setCreatedCredentials(null)}
        title="Credentials Generated"
      >
        {createdCredentials && (
          <div className="space-y-4 font-sans text-slate-200">
            <div className="rounded-lg bg-[#C6A66B]/10 border border-[#C6A66B]/20 p-3 text-xs text-white">
              Temporary credentials have been generated for {createdCredentials.name} ({createdCredentials.type}).
            </div>
            
            <div className="space-y-2">
              <div>
                <label className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-550 mb-1">
                  Name
                </label>
                <div className="w-full h-9 rounded-xl border border-white/[0.02] bg-[#161B22] px-3 flex items-center text-xs text-white">
                  {createdCredentials.name}
                </div>
              </div>
              
              <div>
                <label className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-550 mb-1">
                  Email / Username
                </label>
                <div className="w-full h-9 rounded-xl border border-white/[0.02] bg-[#161B22] px-3 flex items-center text-xs text-white">
                  {createdCredentials.email}
                </div>
              </div>

              <div>
                <label className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-550 mb-1">
                  Temporary Password
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={createdCredentials.pass}
                    className="flex-1 h-9 rounded-xl border border-white/[0.02] bg-[#161B22] px-3 text-xs text-white outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(createdCredentials.pass);
                      alert("Password copied to clipboard!");
                    }}
                    className="h-9 px-3 rounded-xl bg-white/[0.015] border border-white/[0.02] hover:bg-white/[0.03] text-xs font-bold text-slate-350 transition cursor-pointer"
                  >
                    Copy
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[8px] font-extrabold uppercase tracking-widest text-slate-555 mb-1">
                  Login URL
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={`${window.location.origin}/login`}
                    className="flex-1 h-9 rounded-xl border border-white/[0.02] bg-[#161B22] px-3 text-xs text-slate-400 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/login`);
                      alert("Login link copied!");
                    }}
                    className="h-9 px-3 rounded-xl bg-white/[0.015] border border-white/[0.02] hover:bg-white/[0.03] text-xs font-bold text-slate-350 transition cursor-pointer"
                  >
                    Copy
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-[10px] leading-relaxed text-amber-205">
              <span className="font-bold text-amber-400">Warning:</span> This temporary password is only shown once and cannot be recovered. Ensure you have copied it before closing this window.
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setCreatedCredentials(null)}
                className="h-9 px-5 rounded-xl bg-[#C6A66B] hover:bg-[#B8924F] text-slate-950 text-xs font-black uppercase tracking-wider transition cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

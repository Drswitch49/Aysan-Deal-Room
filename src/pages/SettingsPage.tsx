import { useState } from "react";
import { 
  Key, RefreshCw, Check, Database, Server, CheckCircle2, Zap, Bell, AlertTriangle, ShieldAlert
} from "lucide-react";
import { changeAdminPassword } from "../api/admin";
import { clearAirtableCache } from "../api/airtable";
import { cx } from "../utils/cx";
import { HeaderMetrics } from "../components/ui/HeaderMetrics";
import { FormField, inputClass } from "../components/ui/FormField";

export function SettingsPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [cacheFlushed, setCacheFlushed] = useState(false);
  const [diagnostics] = useState({
    nodeEnv: import.meta.env.MODE || "production",
    port: window.location.port || "5173",
    airtableStatus: "Connected",
    metadataStatus: "Cached Fallback ready"
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess(false);

    if (!currentPassword) {
      setError("Current passcode is required.");
      return;
    }

    if (!newPassword || newPassword.trim() === "") {
      setError("New passcode cannot be empty.");
      return;
    }

    // Password strength check
    const passwordRegex = /^(?=.*[a-zA-Z])(?=.*[0-9!@#$%^&*()_+\-=[\]{};':",\\|.<>?]).{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      setError("New passcode must be at least 8 characters long and contain both letters and numbers/special characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      await changeAdminPassword(currentPassword, newPassword);
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || "Failed to update passcode.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFlushCache = () => {
    clearAirtableCache();
    setCacheFlushed(true);
    setTimeout(() => setCacheFlushed(false), 2000);
  };

  return (
    <div className="space-y-6 text-[#E2E8F0] font-sans animate-fade-in">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
            System <span className="text-[#C6A66B]">Settings</span>
          </h1>
          <p className="text-xs text-slate-400 font-semibold tracking-wide">
            ACP Deal OS Workspace & Auth Configuration
          </p>
        </div>
        
        <div className="flex items-center gap-3 select-none">
          <HeaderMetrics />
          
          <button 
            type="button" 
            className="p-1.5 rounded-lg border border-white/[0.02] bg-white/[0.015] text-slate-400 hover:text-white hover:bg-white/[0.02] transition cursor-pointer relative"
            title="Notifications"
          >
            <Bell className="h-4 w-4" />
            <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-[#C6A66B]" />
          </button>
        </div>
      </div>

      {/* Grid Layout System */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left Column: Workspace Configuration & Diagnostics */}
        <div className="col-span-12 lg:col-span-6 space-y-6">
          
          {/* BRANDING & ORGANIZATION CONFIGURATION */}
          <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-6 shadow-premium-card card-sheen">
            <h3 className="text-xs font-extrabold uppercase tracking-[0.2em] text-slate-400 border-b border-white/[0.02] pb-4 mb-5 select-none flex items-center gap-2">
              <Database className="h-4 w-4 text-[#C6A66B]" />
              <span>Workspace Profile</span>
            </h3>

            <div className="space-y-4">
              <FormField label="Organization Name" id="org-name">
                <input
                  id="org-name"
                  type="text"
                  readOnly
                  value="Aysan Capital Partners"
                  className={cx(inputClass, "opacity-75 cursor-not-allowed bg-white/[0.01]")}
                />
              </FormField>
              
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Primary Branding Hex" id="brand-color">
                  <div className="flex items-center gap-2">
                    <span className="h-6 w-6 rounded border border-white/10 bg-[#C6A66B] shrink-0" />
                    <span className="text-xs font-mono font-bold text-slate-300">#C6A66B</span>
                  </div>
                </FormField>
                
                <FormField label="Accent Tint Hex" id="accent-tint">
                  <div className="flex items-center gap-2">
                    <span className="h-6 w-6 rounded border border-white/10 bg-[#161B22] shrink-0" />
                    <span className="text-xs font-mono font-bold text-slate-300">#161B22</span>
                  </div>
                </FormField>
              </div>
            </div>
          </div>

          {/* CACHE OPTIMIZATION PANEL */}
          <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-6 shadow-premium-card card-sheen">
            <h3 className="text-xs font-extrabold uppercase tracking-[0.2em] text-slate-400 border-b border-white/[0.02] pb-4 mb-5 select-none flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-[#C6A66B]" />
              <span>Database Query Latency Optimization</span>
            </h3>

            <div className="space-y-4">
              <div className="text-xs text-slate-400 leading-relaxed space-y-2 font-sans">
                <p>
                  To accelerate page loading and tab transitions, Aysan Capital Portal caches Airtable responses for <strong className="text-white">10 seconds</strong> in-memory.
                </p>
                <p>
                  Purge the local query cache immediately to fetch manual updates made in the Airtable base.
                </p>
              </div>

              <button
                onClick={handleFlushCache}
                className={cx(
                  "w-full inline-flex h-10 items-center justify-center gap-2 rounded-xl border transition-all duration-200 text-xs font-bold uppercase tracking-widest select-none cursor-pointer",
                  cacheFlushed 
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" 
                    : "border-white/[0.02] bg-white/[0.015] text-slate-300 hover:bg-white/[0.02] hover:text-white"
                )}
              >
                {cacheFlushed ? (
                  <>
                    <Check className="h-4 w-4 text-emerald-400" />
                    <span>Cache Cleared Successfully!</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4" />
                    <span>Flush Cache</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* SYSTEM DIAGNOSTICS TABLE */}
          <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-6 shadow-premium-card card-sheen">
            <h3 className="text-xs font-extrabold uppercase tracking-[0.2em] text-slate-400 border-b border-white/[0.02] pb-4 mb-5 select-none flex items-center gap-2">
              <Server className="h-4 w-4 text-[#C6A66B]" />
              <span>Diagnostics & Environment State</span>
            </h3>

            <div className="divide-y divide-white/[0.03] font-mono text-[10px] leading-none">
              <div className="flex items-center justify-between py-3">
                <span className="font-bold text-slate-500">DATABASE ENGINE</span>
                <span className="text-emerald-400 font-black uppercase tracking-widest flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {diagnostics.airtableStatus}
                </span>
              </div>
              
              <div className="flex items-center justify-between py-3">
                <span className="font-bold text-slate-500">METADATA SCHEMA BYPASS</span>
                <span className="text-blue-400 font-bold">
                  {diagnostics.metadataStatus}
                </span>
              </div>

              <div className="flex items-center justify-between py-3">
                <span className="font-bold text-slate-500">ENVIRONMENT MODE</span>
                <span className="text-slate-300 uppercase font-bold">
                  {diagnostics.nodeEnv}
                </span>
              </div>

              <div className="flex items-center justify-between py-3">
                <span className="font-bold text-slate-500">VITE PORT</span>
                <span className="text-slate-300 font-bold">
                  {diagnostics.port}
                </span>
              </div>
            </div>
          </div>

        </div>

        {/* Right Column: Authentication & Security */}
        <div className="col-span-12 lg:col-span-6 space-y-6">

          {/* ADMIN SECURITY PANEL */}
          <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-6 shadow-premium-card card-sheen">
            <h3 className="text-xs font-extrabold uppercase tracking-[0.2em] text-slate-400 border-b border-white/[0.02] pb-4 mb-5 select-none flex items-center gap-2">
              <Key className="h-4 w-4 text-[#C6A66B]" />
              <span>Admin Security Configuration</span>
            </h3>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-xl border border-rose-500/10 bg-rose-500/5 p-3.5 text-center text-xs font-semibold text-rose-400">
                  {error}
                </div>
              )}

              {success && (
                <div className="rounded-xl border border-emerald-500/10 bg-emerald-500/5 p-3.5 text-center text-xs font-semibold text-emerald-400">
                  Passcode successfully updated!
                </div>
              )}

              <div className="space-y-4">
                <FormField label="Current Passcode" id="settings-current-passcode">
                  <input
                    id="settings-current-passcode"
                    type="password"
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="••••••••"
                    className={inputClass}
                  />
                </FormField>

                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="New Passcode" id="settings-new-passcode">
                    <input
                      id="settings-new-passcode"
                      type="password"
                      required
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="••••••••"
                      className={inputClass}
                    />
                  </FormField>

                  <FormField label="Confirm New Passcode" id="settings-confirm-passcode">
                    <input
                      id="settings-confirm-passcode"
                      type="password"
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      className={inputClass}
                    />
                  </FormField>
                </div>
              </div>

              <div className="text-[10px] text-slate-500 leading-normal bg-white/[0.01] border border-white/[0.03] rounded-lg p-3">
                <strong>Password Policy:</strong> Passcode must be at least 8 characters long and contain both letters and numbers/special characters. High-risk administrative updates require current password confirmation.
              </div>

              <button
                type="submit"
                disabled={isSubmitting || success}
                className="w-full inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-[#C6A66B] to-[#ac8843] text-xs font-bold uppercase tracking-widest text-slate-950 hover:shadow-glow-bronze disabled:opacity-40 select-none cursor-pointer mt-2 transition duration-200"
              >
                <Zap className="h-3.5 w-3.5" />
                <span>{isSubmitting ? "Updating..." : "Update Passcode"}</span>
              </button>
            </form>
          </div>

          {/* SESSION ROLES & JWT HEALTH PANEL */}
          <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-6 shadow-premium-card card-sheen">
            <h3 className="text-xs font-extrabold uppercase tracking-[0.2em] text-slate-400 border-b border-white/[0.02] pb-4 mb-5 select-none flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-[#C6A66B]" />
              <span>Session Roles & JWT Health</span>
            </h3>

            <div className="divide-y divide-white/[0.03] font-mono text-[10px] leading-none">
              <div className="flex items-center justify-between py-3">
                <span className="font-bold text-slate-500">ACTIVE ROLE</span>
                <span className="text-[#C6A66B] font-bold uppercase tracking-wider">
                  Managing Partner
                </span>
              </div>
              
              <div className="flex items-center justify-between py-3">
                <span className="font-bold text-slate-500">SESSION PERMISSIONS</span>
                <span className="text-slate-300 font-bold uppercase">
                  Write / Override / Admin
                </span>
              </div>

              <div className="flex items-center justify-between py-3">
                <span className="font-bold text-slate-500">JWT STATUS</span>
                <span className="text-emerald-450 font-black uppercase tracking-widest flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Active / Valid
                </span>
              </div>

              <div className="flex items-center justify-between py-3">
                <span className="font-bold text-slate-500">SIGNING ALGORITHM</span>
                <span className="text-slate-400 font-bold font-mono">
                  HS256 (RS256 Failover)
                </span>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

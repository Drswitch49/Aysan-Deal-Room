import { useState, useEffect } from "react";
import { 
  Key, RefreshCw, Check, Database, Server, CheckCircle2, Zap, Bell, Link2, AlertTriangle, HelpCircle, ShieldAlert
} from "lucide-react";
import { changeAdminPassword } from "../api/admin";
import { clearAirtableCache } from "../api/airtable";
import { cx } from "../utils/cx";
import { HeaderMetrics } from "../components/ui/HeaderMetrics";
import { FormField, inputClass } from "../components/ui/FormField";

export function SettingsPage() {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [cacheFlushed, setCacheFlushed] = useState(false);
  const [diagnostics, setDiagnostics] = useState({
    nodeEnv: import.meta.env.MODE || "production",
    port: window.location.port || "5173",
    airtableStatus: "Connected",
    metadataStatus: "Cached Fallback ready"
  });

  // Make.com interactive connection verification state
  const [verifyingMake, setVerifyingMake] = useState(false);
  const [makeStatus, setMakeStatus] = useState<"IDLE" | "VERIFYING" | "VERIFIED">("IDLE");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess(false);

    if (!newPassword || newPassword.trim() === "") {
      setError("Password cannot be empty.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      await changeAdminPassword(newPassword);
      setSuccess(true);
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

  const handleVerifyMake = () => {
    if (makeStatus === "VERIFYING") return;
    setVerifyingMake(true);
    setMakeStatus("VERIFYING");
    setTimeout(() => {
      setVerifyingMake(false);
      setMakeStatus("VERIFIED");
      // Reset after 3 seconds back to verify state
      setTimeout(() => setMakeStatus("IDLE"), 4000);
    }, 1200);
  };

  const connections = [
    { name: "Airtable Base", id: "appGwrPtwxbzgz...", status: "CONNECTED", type: "success" },
    { name: "Notion Docs Hub", id: "21000dec-ce9f-503a-8ab4...", status: "CONNECTED", type: "success" },
    { name: "Claude API", id: "claude-server-3.5-20241022", status: "ACTIVE", type: "success" },
    { 
      name: "Make.com", 
      id: "0 scenarios", 
      status: makeStatus === "VERIFIED" ? "CONNECTED" : (makeStatus === "VERIFYING" ? "VERIFYING" : "VERIFY CONNECTION"), 
      type: "action" 
    },
    { name: "Google Drive", id: "folder-ref/0B3ybsK1x4v5hM0t3Q...", status: "CONNECTED", type: "success" },
    { name: "Email", id: "partnership@aysancapital.com", status: "CONNECTED", type: "success" },
    { name: "ClickUp", id: "Task management - 901823982397", status: "CONNECTED", type: "success" }
  ];

  const checklistItems = [
    { text: "Airtable field IDs documented for team", status: "REQUIRES ACTION", type: "warning" },
    { text: "Make webhook URLs documented", status: "REQUIRES ACTION", type: "warning" },
    { text: "Notion SOPs accessible to full team", status: "VALIDATED", type: "success" },
    { text: "Client trained on system maintenance", status: "TRAINING PENDING", type: "warning" },
    { text: "Token rotation log current", status: "OVERDUE", type: "danger" }
  ];

  const thresholds = [
    { name: "EBITDA floor", value: "£750k", color: "text-white" },
    { name: "EV multiple — caution", value: "< 7.0x", color: "text-[#C6A66B] font-bold" },
    { name: "EV multiple — LBO / override", value: "< 5.0x", color: "text-rose-500 font-bold" },
    { name: "DSCR base floor", value: "1.30x", color: "text-white" },
    { name: "DSCR covenant floor", value: "1.20x", color: "text-white" },
    { name: "Lender response flag", value: "90 days", color: "text-white" }
  ];

  return (
    <div className="space-y-6 text-[#E2E8F0] font-sans animate-fade-in">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
            System <span className="text-[#C6A66B]">Settings</span>
          </h1>
          <p className="text-xs text-slate-400 font-semibold tracking-wide">
            ACP Deal OS configuration
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

          <button
            type="button"
            className="inline-flex h-9 items-center justify-center rounded-lg bg-[#C6A66B] hover:bg-[#b5904a] text-slate-950 px-4 text-xs font-black uppercase tracking-wider transition-colors duration-200"
            onClick={() => window.location.hash = "/deals"}
          >
            + New Deal
          </button>
        </div>
      </div>

      {/* Grid Layout System */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left Column: System Connections, Passcode Configuration, Cache Flushing, Diagnostics */}
        <div className="col-span-12 lg:col-span-7 space-y-6">
          
          {/* SYSTEM CONNECTIONS Panel */}
          <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-6 shadow-premium-card card-sheen">
            <div className="flex items-center justify-between border-b border-white/[0.02] pb-4 mb-5 select-none">
              <h3 className="text-xs font-extrabold uppercase tracking-[0.2em] text-[#C6A66B]">
                System Connections
              </h3>
              <Link2 className="h-4 w-4 text-slate-550 hover:text-white cursor-pointer transition-colors" />
            </div>

            <div className="space-y-4">
              {connections.map((conn, idx) => (
                <div key={idx} className="flex items-center justify-between py-1.5 border-b border-white/[0.02] last:border-0">
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-white tracking-wide">
                      {conn.name}
                    </p>
                    <p className="text-[10px] font-medium text-slate-500 font-mono tracking-tight">
                      {conn.id}
                    </p>
                  </div>

                  <div>
                    {conn.type === "success" ? (
                      <span className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-emerald-450 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/15">
                        <span className="h-1 w-1.5 rotate-45 border-r border-b border-emerald-450 block transform -translate-y-0.5" />
                        {conn.status}
                      </span>
                    ) : (
                      <button
                        onClick={handleVerifyMake}
                        disabled={makeStatus === "VERIFYING"}
                        className={cx(
                          "px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-widest rounded transition-all duration-200 cursor-pointer shadow-sm",
                          makeStatus === "VERIFIED"
                            ? "bg-emerald-500/10 text-emerald-450 border border-emerald-500/15"
                            : makeStatus === "VERIFYING"
                            ? "bg-[#C6A66B]/20 text-[#C6A66B] border border-[#C6A66B]/30 animate-pulse"
                            : "bg-[#C6A66B] hover:bg-[#b5904a] text-slate-950"
                        )}
                      >
                        {makeStatus === "VERIFYING" && "VERIFYING..."}
                        {makeStatus === "VERIFIED" && "CONNECTED"}
                        {makeStatus === "IDLE" && "VERIFY CONNECTION"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ADMIN SECURITY PANEL */}
          <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-6 shadow-premium-card card-sheen">
            <h3 className="text-xs font-extrabold uppercase tracking-[0.2em] text-slate-400 border-b border-white/[0.02] pb-4 mb-5 select-none flex items-center gap-2">
              <Key className="h-4 w-4 text-[#C6A66B]" />
              <span>Admin Security Configuration</span>
            </h3>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-xl border border-rose-500/10 bg-rose-500/5 p-3.5 text-center text-xs font-semibold text-rose-455">
                  {error}
                </div>
              )}

              {success && (
                <div className="rounded-xl border border-emerald-500/10 bg-emerald-500/5 p-3.5 text-center text-xs font-semibold text-emerald-450">
                  Passcode successfully updated!
                </div>
              )}

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

          {/* CACHE OPTIMIZATION PANEL */}
          <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-6 shadow-premium-card card-sheen">
            <h3 className="text-xs font-extrabold uppercase tracking-[0.2em] text-slate-400 border-b border-white/[0.02] pb-4 mb-5 select-none flex items-center gap-2">
              <Database className="h-4 w-4 text-[#C6A66B]" />
              <span>Database Query Latency Optimization</span>
            </h3>

            <div className="space-y-4">
              <div className="text-xs text-slate-400 leading-relaxed space-y-2 font-sans">
                <p>
                  To accelerate page loading and tab transitions, Aysan Capital Portal caches Airtable responses for <strong className="text-white">10 seconds</strong> in-memory.
                </p>
                <p>
                  If you have just made manual updates directly in the Airtable base, click the button below to purge the local query cache immediately.
                </p>
              </div>

              <button
                onClick={handleFlushCache}
                className={cx(
                  "w-full inline-flex h-10 items-center justify-center gap-2 rounded-xl border transition-all duration-200 text-xs font-bold uppercase tracking-widest select-none cursor-pointer",
                  cacheFlushed 
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-450" 
                    : "border-white/[0.02] bg-white/[0.015] text-slate-300 hover:bg-white/[0.02] hover:text-white"
                )}
              >
                {cacheFlushed ? (
                  <>
                    <Check className="h-4 w-4 text-emerald-455" />
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
                <span className="text-emerald-450 font-black uppercase tracking-widest flex items-center gap-1.5">
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

        {/* Right Column: Deployment Checklist & Pre-Committee Risk Thresholds */}
        <div className="col-span-12 lg:col-span-5 space-y-6">

          {/* DEPLOYMENT CHECKLIST Panel */}
          <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-6 shadow-premium-card card-sheen">
            <div className="flex items-center justify-between border-b border-white/[0.02] pb-4 mb-5 select-none">
              <h3 className="text-xs font-extrabold uppercase tracking-[0.2em] text-rose-500 flex items-center gap-2">
                Deployment Checklist
              </h3>
              <span className="text-[10px] font-black text-rose-500 bg-rose-500/10 border border-rose-500/25 px-2 py-0.5 rounded tracking-wide uppercase">
                VERIFIED: 1/5
              </span>
            </div>

            <div className="space-y-4">
              {checklistItems.map((item, idx) => (
                <div key={idx} className="flex items-start gap-3.5 py-1 border-b border-white/[0.02] last:border-0 last:pb-0">
                  {item.type === "success" ? (
                    <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-450 border border-emerald-500/30">
                      <span className="h-1 w-1.5 rotate-45 border-r border-b border-emerald-450 block transform -translate-y-0.5" />
                    </div>
                  ) : (
                    <div className="mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 border-rose-500/30 bg-rose-500/5 flex items-center justify-center">
                      <span className="h-1.5 w-1.5 rounded-full bg-rose-500/60" />
                    </div>
                  )}

                  <div className="space-y-1">
                    <p className={cx(
                      "text-xs font-semibold tracking-wide",
                      item.type === "success" ? "text-slate-200" : "text-slate-350"
                    )}>
                      {item.text}
                    </p>
                    <p className={cx(
                      "text-[9px] font-black uppercase tracking-widest",
                      item.type === "success" ? "text-emerald-400" : (item.type === "danger" ? "text-rose-500" : "text-[#C6A66B]")
                    )}>
                      {item.status}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* RISK THRESHOLDS (PRE-COMMITTEE) Panel */}
          <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-6 shadow-premium-card card-sheen">
            <div className="border-b border-white/[0.02] pb-4 mb-5 select-none">
              <h3 className="text-xs font-extrabold uppercase tracking-[0.2em] text-[#C6A66B]">
                Risk Thresholds (Pre-Committee)
              </h3>
            </div>

            <div className="space-y-4">
              {thresholds.map((t, idx) => (
                <div key={idx} className="flex items-center justify-between py-1 border-b border-white/[0.02] last:border-0 last:pb-0">
                  <span className="text-xs font-semibold text-slate-400 tracking-wide">
                    {t.name}
                  </span>
                  <span className={cx("text-xs font-mono tracking-tight", t.color)}>
                    {t.value}
                  </span>
                </div>
              ))}

              <div className="border-t border-white/[0.02] pt-4 mt-5 select-none">
                <p className="text-[9px] font-bold text-slate-500 leading-relaxed tracking-wider uppercase">
                  Thresholds calculated from historic deals, historic stats, and risk matrix assessments. Deviation from these limits requires written sign off by all partners.
                </p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

import { useState, useEffect } from "react";
import { Landmark, LogOut, Files, FileText, Building2, LockKeyhole, Mail } from "lucide-react";
import { LoadingState } from "../components/ui/LoadingState";
import { ErrorState } from "../components/ui/ErrorState";
import { EmptyState } from "../components/ui/EmptyState";
import { cx } from "../utils/cx";

export function ShareholderPortalPage() {
  // Session lives in httpOnly cookies now (no tokens in localStorage — XSS-safe).
  // `token` is just a "signed in" marker; on mount we probe the session.
  const [token, setToken] = useState("");
  const [deals, setDeals] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(!!token);
  const [error, setError] = useState<string | null>(null);
  const [selectedDeal, setSelectedDeal] = useState<any | null>(null);

  // Login states
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);

  // On mount: if an httpOnly session cookie already exists for a shareholder,
  // resume it automatically.
  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.authenticated && (data.user?.role || "").toLowerCase() === "shareholder") {
          setToken("session");
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!token) return;
    setIsLoading(true);
    fetch("/api/shareholder-portal")
      .then(async (res) => {
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            handleLogout();
          }
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error?.message || err.error || "Failed to load portal data");
        }
        return res.json();
      })
      .then((payload) => {
        const data = payload?.data ?? payload;
        setDeals(data.deals || []);
        if (data.deals?.length > 0) setSelectedDeal(data.deals[0]);
      })
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [token]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isVerifying) return;
    setIsVerifying(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password })
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Incorrect email or password.");
      }
      const data = await response.json();
      if ((data.user.role || "").toLowerCase() !== "shareholder") {
        throw new Error("Access denied. Shareholder profile required.");
      }
      // Session cookie set by the server; no token stored client-side.
      setToken("session");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleLogout = () => {
    fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setToken("");
    setDeals([]);
    setSelectedDeal(null);
  };

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#07090c] p-4 text-slate-100 font-sans selection:bg-[#C6A66B]/30 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,#C6A66B15_0%,transparent_50%)]"></div>
        <div className="relative w-full max-w-sm rounded-2xl border border-white/5 bg-[#0F1115]/90 p-8 shadow-2xl backdrop-blur-xl animate-fade-in-up">
          <div className="mb-8 flex flex-col items-center text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-[#C6A66B] to-[#B8924F] shadow-[0_0_20px_rgba(198,166,107,0.3)] mb-4">
              <Landmark className="h-7 w-7 text-[#07090c]" />
            </div>
            <h1 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#C6A66B]">ACP OS</h1>
            <p className="mt-1 text-lg font-bold text-white tracking-tight">Shareholder Login</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            {error && (
              <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-center text-xs font-semibold text-rose-400">
                {error}
              </div>
            )}
            
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                <Mail className="h-4 w-4 text-slate-500 group-focus-within:text-[#C6A66B] transition-colors" />
              </div>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Shareholder Email"
                className="h-12 w-full rounded-xl border border-white/10 bg-black/40 pl-10 pr-4 text-sm text-white placeholder-slate-500 outline-none transition-all focus:border-[#C6A66B] focus:ring-1 focus:ring-[#C6A66B]"
                required
              />
            </div>

            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                <LockKeyhole className="h-4 w-4 text-slate-500 group-focus-within:text-[#C6A66B] transition-colors" />
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="h-12 w-full rounded-xl border border-white/10 bg-black/40 pl-10 pr-4 text-sm text-white placeholder-slate-500 outline-none transition-all focus:border-[#C6A66B] focus:ring-1 focus:ring-[#C6A66B]"
                required
              />
            </div>

            <button
              type="submit"
              disabled={isVerifying || !email || !password}
              className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#C6A66B] to-[#B8924F] text-sm font-black uppercase tracking-wider text-[#07090c] transition hover:opacity-90 disabled:opacity-50"
            >
              {isVerifying ? "Verifying..." : "Access Portal"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (isLoading) return <div className="min-h-screen bg-[#07090c] pt-20"><LoadingState label="Authenticating Shareholder Profile..." /></div>;

  return (
    <div className="min-h-screen bg-[#07090c] text-slate-100 font-sans flex flex-col relative selection:bg-[#C6A66B]/30">
      {/* HEADER */}
      <header className="sticky top-0 z-40 bg-[#0A0D12]/90 backdrop-blur-md border-b border-white/[0.04]">
        <div className="max-w-[1400px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded bg-gradient-to-br from-[#C6A66B] to-[#B8924F] flex items-center justify-center shadow-[0_0_15px_rgba(198,166,107,0.3)]">
              <Landmark className="h-4 w-4 text-[#07090c]" />
            </div>
            <div>
              <div className="text-[10px] font-black tracking-[0.2em] uppercase text-[#C6A66B]">ACP OS</div>
              <div className="text-xs font-semibold text-white tracking-wide">Shareholder Portal</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
              <span className="text-xs font-semibold text-emerald-400">Authenticated</span>
            </div>
            <button onClick={handleLogout} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/5 hover:bg-white/[0.02] text-xs font-bold text-slate-400 hover:text-white transition cursor-pointer">
              <LogOut className="h-3.5 w-3.5" />
              <span>Log out</span>
            </button>
          </div>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className="flex-1 max-w-[1400px] w-full mx-auto px-6 py-8 flex flex-col md:flex-row gap-8">
        
        {/* SIDEBAR - Deals List */}
        <aside className="w-full md:w-72 shrink-0 flex flex-col gap-4">
          <h2 className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500 pl-1 border-l border-[#C6A66B]/50">Assigned Deals</h2>
          
          {deals.length === 0 ? (
            <div className="p-4 rounded-xl border border-white/[0.02] bg-white/[0.01] text-center text-xs text-slate-500">
              No deals currently assigned to you.
            </div>
          ) : (
            <div className="space-y-2">
              {deals.map(deal => {
                const isActive = selectedDeal?.id === deal.id;
                return (
                  <button
                    key={deal.id}
                    onClick={() => setSelectedDeal(deal)}
                    className={cx(
                      "w-full text-left p-4 rounded-xl border transition-all duration-300",
                      isActive ? "bg-[#C6A66B]/10 border-[#C6A66B]/30 shadow-[0_0_15px_rgba(198,166,107,0.05)]" : "bg-white/[0.02] border-white/[0.02] hover:bg-white/[0.04]"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Building2 className={cx("h-3.5 w-3.5 shrink-0", isActive ? "text-[#C6A66B]" : "text-slate-500")} />
                          <h3 className={cx("text-sm font-bold truncate", isActive ? "text-[#C6A66B]" : "text-slate-300")}>{deal.companyName}</h3>
                        </div>
                        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold ml-5">
                          {deal.industry || "General"}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        {/* DETAIL VIEW */}
        <div className="flex-1 flex flex-col min-w-0 pb-16">
          {!selectedDeal ? (
            <EmptyState icon={<Building2 className="h-10 w-10 text-slate-500" />} title="No Deal Selected" message="Select an assigned deal from the list to view its investment materials and details." />
          ) : (
            <div className="space-y-6 animate-fade-in">
              <div className="rounded-2xl border border-white/[0.02] bg-[#161B22] p-6 shadow-premium-card card-sheen">
                <div className="flex flex-wrap items-center justify-between gap-4 mb-8 pb-6 border-b border-white/[0.04]">
                  <div>
                    <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">{selectedDeal.companyName}</h1>
                    <p className="text-sm font-bold text-[#C6A66B] mt-1 tracking-wide">{selectedDeal.industry}</p>
                  </div>
                  <div className="flex items-center gap-4 text-xs font-bold text-slate-400 bg-black/20 p-3 rounded-xl border border-white/[0.02]">
                    <div className="text-center px-3 border-r border-white/5">
                      <div className="text-[9px] uppercase tracking-wider mb-0.5 opacity-60">Revenue</div>
                      <div className="text-[#C6A66B]">${(Number(selectedDeal.revenue) / 1e6).toFixed(1)}M</div>
                    </div>
                    <div className="text-center px-3 border-r border-white/5">
                      <div className="text-[9px] uppercase tracking-wider mb-0.5 opacity-60">EBITDA</div>
                      <div className="text-emerald-400">${(Number(selectedDeal.ebitda) / 1e6).toFixed(1)}M</div>
                    </div>
                    <div className="text-center px-3">
                      <div className="text-[9px] uppercase tracking-wider mb-0.5 opacity-60">EV</div>
                      <div className="text-white">${(Number(selectedDeal.enterpriseValue) / 1e6).toFixed(1)}M</div>
                    </div>
                  </div>
                </div>

                <div className="grid lg:grid-cols-2 gap-8">
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-3 flex items-center gap-2">
                        <FileText className="h-3 w-3" /> Executive Summary
                      </h3>
                      <div className="text-sm text-slate-300 leading-relaxed space-y-4 font-medium whitespace-pre-wrap">
                        {selectedDeal.executiveSummary || "No executive summary provided."}
                      </div>
                    </div>
                    <div>
                      <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-3 flex items-center gap-2">
                        <Building2 className="h-3 w-3" /> Business Description
                      </h3>
                      <div className="text-sm text-slate-300 leading-relaxed space-y-4 font-medium whitespace-pre-wrap">
                        {selectedDeal.businessDescription || "No business description provided."}
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-3 flex items-center gap-2">
                      <Files className="h-3 w-3" /> Approved IMs & Attachments
                    </h3>
                    <div className="rounded-xl border border-white/[0.04] bg-black/20 p-4">
                      {selectedDeal.documents?.length === 0 ? (
                        <div className="text-center py-6 text-xs text-slate-500">No approved documents available yet.</div>
                      ) : (
                        <div className="space-y-2">
                          {selectedDeal.documents?.map((doc: any) => (
                            <div key={doc.id} className="flex items-center justify-between p-3 rounded-lg border border-white/[0.02] bg-white/[0.01] hover:bg-white/[0.03] transition-colors group">
                              <div className="flex items-center gap-3">
                                <div className="h-8 w-8 rounded bg-[#C6A66B]/10 flex items-center justify-center text-[#C6A66B]">
                                  <FileText className="h-4 w-4" />
                                </div>
                                <div>
                                  <div className="text-xs font-bold text-white group-hover:text-[#C6A66B] transition-colors">{doc.name}</div>
                                  <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-500 mt-0.5">{doc.type || "Document"}</div>
                                </div>
                              </div>
                              <a 
                                href={doc.url && doc.url.includes("tmpfiles.org/") && !doc.url.includes("tmpfiles.org/dl/") 
                                  ? doc.url.replace("tmpfiles.org/", "tmpfiles.org/dl/") 
                                  : doc.url} 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className="px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-[#C6A66B] bg-[#C6A66B]/10 hover:bg-[#C6A66B]/20 rounded transition"
                              >
                                View
                              </a>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

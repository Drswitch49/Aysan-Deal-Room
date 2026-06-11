import { Building2, LockKeyhole, ShieldCheck, Landmark } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { CoverSheet } from "../components/deals/CoverSheet";
import { DocumentChecklist } from "../components/deals/DocumentChecklist";
import { ErrorState } from "../components/ui/ErrorState";
import { LoadingState } from "../components/ui/LoadingState";
import { PageHeader } from "../components/ui/PageHeader";
import { config } from "../config/env";
import { useLenderDeal, useLenderDocuments } from "../hooks/useDealRoomData";
import { isSentToLender } from "../utils/security";

export function LenderDealPage() {
  const { ref } = useParams();
  const decodedRef = useMemo(() => (ref ? decodeURIComponent(ref) : ""), [ref]);
  const [isUnlocked, setIsUnlocked] = useState(false);

  if (!isUnlocked) {
    return <PasswordGate dealRef={decodedRef} onUnlock={() => setIsUnlocked(true)} />;
  }

  return <UnlockedLenderPage dealRef={decodedRef} />;
}

function PasswordGate({ dealRef, onUnlock }: { dealRef: string; onUnlock: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const isConfigured = Boolean(config.lenderRoomPassword);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isConfigured) {
      setError("Lender room password is not configured.");
      return;
    }
    if (password === config.lenderRoomPassword) {
      onUnlock();
      return;
    }
    setError("Incorrect password details.");
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center relative overflow-hidden px-4 py-8 animate-fade-in-up">
      {/* Premium dark mesh backdrop */}
      <div className="absolute inset-0 bg-acp-ink rounded-3xl border border-white/5" />
      <div className="absolute -left-20 -top-20 h-64 w-64 rounded-full bg-acp-bronze/10 blur-[80px] pointer-events-none" />
      <div className="absolute -right-20 -bottom-20 h-64 w-64 rounded-full bg-acp-bronze/5 blur-[85px] pointer-events-none" />

      <form 
        onSubmit={handleSubmit} 
        className="w-full max-w-md relative z-10 rounded-2xl border border-white/[0.02] bg-acp-card backdrop-blur-xl p-8 shadow-2xl"
      >
        <div className="flex flex-col items-center text-center">
          {/* Rotating vault dial graphic around lock icon */}
          <div className="relative mb-6 flex items-center justify-center h-24 w-24">
            <svg 
              className="absolute inset-0 h-full w-full text-acp-bronze/20 animate-[spin_24s_linear_infinite]" 
              viewBox="0 0 100 100"
              style={{ transform: `rotate(${password.length * 15}deg)`, transition: "transform 0.4s ease-out" }}
            >
              <circle cx="50" cy="50" r="45" stroke="currentColor" strokeWidth="1.2" strokeDasharray="6 4" fill="none" />
              <circle cx="50" cy="50" r="38" stroke="currentColor" strokeWidth="0.6" strokeDasharray="2 12" fill="none" />
            </svg>
            <div className="relative z-10 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-acp-bronze to-acp-bronze-dark text-white shadow-lg border border-white/[0.02] group">
              <LockKeyhole className="h-6 w-6 transition-transform duration-500 group-hover:scale-110" aria-hidden="true" />
              {password.length > 0 && (
                <span className="absolute inset-0 rounded-2xl animate-ping bg-acp-bronze/20 opacity-30 pointer-events-none" />
              )}
            </div>
          </div>
          
          <h2 className="font-display text-2xl text-white font-normal italic tracking-wide">
            Aysan Capital Partners
          </h2>
          <p className="mt-1 text-[10px] font-extrabold uppercase tracking-[0.2em] text-acp-bronze">
            Secure Lender Portal
          </p>
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/[0.015] px-3 py-1 text-[10px] font-bold text-slate-400 border border-white/5">
            Reference: {dealRef}
          </div>
        </div>

        <div className="mt-8 space-y-5">
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 text-center">
            <p className="text-[11px] leading-relaxed text-slate-400">
              This environment contains approved lender materials. Input the secure room passcode to proceed.
            </p>
          </div>

          <div>
            <label className="block text-[9px] font-extrabold uppercase tracking-[0.18em] text-slate-500" htmlFor="password">
              Secure Passcode
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              className="mt-2.5 h-11 w-full rounded-xl border border-white/[0.02] bg-white/[0.015] px-4 text-sm text-white placeholder-slate-600 outline-none transition-all duration-300 focus:border-acp-bronze focus:ring-1 focus:ring-acp-bronze"
              autoComplete="current-password"
            />
          </div>

          {error ? (
            <p className="text-center text-xs font-semibold text-rose-400 animate-pulse">{error}</p>
          ) : null}

          <button
            type="submit"
            className="w-full inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-acp-bronze to-acp-bronze-dark px-4 text-xs font-bold uppercase tracking-wider text-white shadow-md hover:shadow-glow-bronze transition-all duration-300 transform hover:-translate-y-0.5"
          >
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Verify and Access
          </button>
        </div>
      </form>
    </div>
  );
}

function UnlockedLenderPage({ dealRef }: { dealRef: string }) {
  const dealState = useLenderDeal(dealRef);
  const documentState = useLenderDocuments(dealRef);
  const isLoading = dealState.isLoading || documentState.isLoading;
  const error = dealState.error ?? documentState.error;
  const approvedDocuments = documentState.data ?? [];

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} />;
  if (!dealState.data) return <PageHeader title="Deal not found" eyebrow={dealRef} />;

  return (
    <div className="space-y-8 animate-fade-in-up">
      <PageHeader 
        title={dealState.data.companyName || dealState.data.dealRef} 
        eyebrow={`Lender Portal / ${dealState.data.dealRef}`} 
      />
      
      {/* Private disclaimer */}
      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 px-6 py-4 shadow-sm">
        <div className="flex items-start gap-3">
          <Landmark className="h-5 w-5 text-acp-bronze mt-0.5" />
          <div>
            <h4 className="text-xs font-bold text-amber-200 uppercase tracking-wider">Confidential Investor Material</h4>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
              The contents of this portal are strictly private and subject to non-disclosure compliance guidelines. Unauthorized distribution or sharing is restricted.
            </p>
          </div>
        </div>
      </div>

      <CoverSheet deal={dealState.data} audience="lender" />
      
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.015] border border-white/[0.02] text-acp-bronze shadow-sm">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <h2 className="text-sm font-bold uppercase tracking-wider text-white">Approved Documents</h2>
        </div>
        <DocumentChecklist documents={approvedDocuments} audience="lender" />
      </section>
    </div>
  );
}

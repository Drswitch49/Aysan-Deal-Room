import { FormEvent, useState } from "react";
import { LockKeyhole, ShieldCheck, Key, ArrowLeft, CheckCircle2, Mail, Loader2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";

type AdminGuardProps = {
  children: React.ReactNode;
};

export function AdminGuard({ children }: AdminGuardProps) {
  const { isAuthenticated, isLoading, checkSession } = useAuth();
  
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);

  // Recovery States
  const [isResetting, setIsResetting] = useState(false);
  const [masterPasscode, setMasterPasscode] = useState("");
  const [newPasscode, setNewPasscode] = useState("");
  const [confirmPasscode, setConfirmPasscode] = useState("");
  const [resetError, setResetError] = useState("");
  const [resetSuccess, setResetSuccess] = useState(false);
  const [isResetSubmitting, setIsResetSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isVerifying) return;
    setIsVerifying(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email: email.trim(), password })
      });
      
      if (response.ok) {
        const data = await response.json();
        if (["admin", "analyst", "hr", "stakeholder", "managing partner", "partner"].includes((data.user.role || "").toLowerCase())) {
          await checkSession();
          setError("");
        } else {
          setError("Forbidden: Access restricted to authorized platform users.");
        }
      } else {
        const errData = await response.json();
        setError(errData.error || "Incorrect email or password.");
      }
    } catch (err) {
      setError("Failed to connect. Please verify your connection.");
    } finally {
      setIsVerifying(false);
    }
  }

  async function handleResetSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isResetSubmitting) return;

    setResetError("");
    setResetSuccess(false);

    if (!masterPasscode.trim()) {
      setResetError("Master recovery passcode is required.");
      return;
    }

    if (!newPasscode.trim()) {
      setResetError("New passcode cannot be empty.");
      return;
    }

    if (newPasscode !== confirmPasscode) {
      setResetError("New passcodes do not match.");
      return;
    }

    setIsResetSubmitting(true);

    try {
      // Master-passcode recovery was removed with the legacy auth system —
      // password resets now happen through Supabase (an owner resets the account).
      throw new Error(
        "Master-passcode recovery is no longer available. Ask an owner to reset your account password in Supabase."
      );

      // eslint-disable-next-line no-unreachable
      const loginRes = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email: "admin@aysancapital.com", password: newPasscode })
      });

      if (loginRes.ok) {
        setTimeout(() => {
          checkSession();
          setIsResetting(false);
          setMasterPasscode("");
          setNewPasscode("");
          setConfirmPasscode("");
          setResetSuccess(false);
        }, 1500);
      } else {
        throw new Error("Reset succeeded but automatic login failed. Please log in manually.");
      }
    } catch (err: any) {
      setResetError(err.message || "Failed to reset passcode. Verify master passcode.");
    } finally {
      setIsResetSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0F1115] flex items-center justify-center relative overflow-hidden">
        <div className="absolute -left-20 -top-20 h-80 w-80 rounded-full bg-acp-bronze/5 blur-[100px] pointer-events-none" />
        <div className="absolute -right-20 -bottom-20 h-80 w-80 rounded-full bg-acp-bronze/5 blur-[100px] pointer-events-none" />
        <div className="flex flex-col items-center gap-4 text-slate-400">
          <Loader2 className="h-8 w-8 animate-spin text-acp-bronze" />
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">Checking credentials...</p>
        </div>
      </div>
    );
  }

  if (isAuthenticated) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-[#0F1115] flex items-center justify-center p-4 relative overflow-hidden">
      {/* Decorative ambient glows */}
      <div className="absolute -left-20 -top-20 h-80 w-80 rounded-full bg-acp-bronze/5 blur-[100px] pointer-events-none" />
      <div className="absolute -right-20 -bottom-20 h-80 w-80 rounded-full bg-acp-bronze/5 blur-[100px] pointer-events-none" />

      {isResetting ? (
        <form
          onSubmit={handleResetSubmit}
          className="w-full max-w-md relative z-10 rounded-2xl border border-white/[0.02] bg-[#161B22] backdrop-blur-xl p-8 shadow-2xl card-sheen"
        >
          {/* Recovery Form Header */}
          <div className="flex flex-col items-center text-center">
            <div className="relative mb-6 flex items-center justify-center h-20 w-20">
              <svg
                className="absolute inset-0 h-full w-full text-acp-bronze/20 animate-[spin_30s_linear_infinite]"
                viewBox="0 0 100 100"
              >
                <circle cx="50" cy="50" r="45" stroke="currentColor" strokeWidth="1" strokeDasharray="6 4" fill="none" />
              </svg>
              <div className="relative z-10 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-acp-bronze to-acp-bronze-dark text-white shadow-lg border border-white/[0.02]">
                <Key className="h-5 w-5" aria-hidden="true" />
              </div>
            </div>

            <h2 className="font-display text-2xl text-white font-normal italic tracking-wide">
              Aysan Capital Partners
            </h2>
            <p className="mt-1 text-[10px] font-extrabold uppercase tracking-[0.2em] text-acp-bronze">
              Passcode Recovery
            </p>
          </div>

          <div className="mt-8 space-y-5">
            {resetSuccess ? (
              <div className="rounded-xl border border-emerald-500/10 bg-emerald-500/5 p-5 text-center flex flex-col items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <p className="text-xs font-semibold text-emerald-400">
                  Passcode reset successful! Automatically entering the control panel...
                </p>
              </div>
            ) : (
              <>
                <div className="rounded-xl border border-white/5 bg-white/[0.01] p-4 text-center">
                  <p className="text-[11px] leading-relaxed text-slate-400">
                    To reset the custom passcode, enter the Master Recovery Passcode and your new admin passcode below.
                  </p>
                </div>

                {resetError && (
                  <p className="text-center text-xs font-semibold text-rose-450 animate-pulse">{resetError}</p>
                )}

                <div>
                  <label className="block text-[9px] font-extrabold uppercase tracking-[0.18em] text-slate-400" htmlFor="master-passcode">
                    Master Recovery Passcode
                  </label>
                  <input
                    id="master-passcode"
                    type="password"
                    value={masterPasscode}
                    onChange={(e) => setMasterPasscode(e.target.value)}
                    placeholder="••••••••"
                    className="mt-2 h-11 w-full rounded-xl border border-white/[0.02] bg-white/[0.015] px-4 text-sm text-white placeholder-slate-650 outline-none transition-all duration-300 focus:border-acp-bronze focus:ring-1 focus:ring-acp-bronze"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[9px] font-extrabold uppercase tracking-[0.18em] text-slate-400" htmlFor="new-passcode">
                    New Admin Passcode
                  </label>
                  <input
                    id="new-passcode"
                    type="password"
                    value={newPasscode}
                    onChange={(e) => setNewPasscode(e.target.value)}
                    placeholder="••••••••"
                    className="mt-2 h-11 w-full rounded-xl border border-white/[0.02] bg-white/[0.015] px-4 text-sm text-white placeholder-slate-650 outline-none transition-all duration-300 focus:border-acp-bronze focus:ring-1 focus:ring-acp-bronze"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[9px] font-extrabold uppercase tracking-[0.18em] text-slate-400" htmlFor="confirm-passcode">
                    Confirm New Passcode
                  </label>
                  <input
                    id="confirm-passcode"
                    type="password"
                    value={confirmPasscode}
                    onChange={(e) => setConfirmPasscode(e.target.value)}
                    placeholder="••••••••"
                    className="mt-2 h-11 w-full rounded-xl border border-white/[0.02] bg-white/[0.015] px-4 text-sm text-white placeholder-slate-650 outline-none transition-all duration-300 focus:border-acp-bronze focus:ring-1 focus:ring-acp-bronze"
                    required
                  />
                </div>

                <div className="flex flex-col gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={isResetSubmitting}
                    className="w-full inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-acp-bronze to-acp-bronze-dark px-4 text-xs font-bold uppercase tracking-wider text-white shadow-md hover:shadow-glow-bronze transition-all duration-300 transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                    {isResetSubmitting ? "Resetting Passcode..." : "Reset and Enter"}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsResetting(false);
                      setResetError("");
                    }}
                    className="w-full inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/[0.02] bg-white/[0.015] px-4 text-xs font-bold uppercase tracking-wider text-slate-300 hover:text-white transition-all duration-300 cursor-pointer"
                  >
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    Back to Login
                  </button>
                </div>
              </>
            )}
          </div>
        </form>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-md relative z-10 rounded-2xl border border-white/[0.02] bg-[#161B22] backdrop-blur-xl p-8 shadow-2xl card-sheen"
        >
          {/* Header */}
          <div className="flex flex-col items-center text-center">
            <div className="relative mb-6 flex items-center justify-center h-20 w-20">
              <svg
                className="absolute inset-0 h-full w-full text-acp-bronze/20 animate-[spin_30s_linear_infinite]"
                viewBox="0 0 100 100"
                style={{ transform: `rotate(${password.length * 12}deg)`, transition: "transform 0.4s ease-out" }}
              >
                <circle cx="50" cy="50" r="45" stroke="currentColor" strokeWidth="1" strokeDasharray="6 4" fill="none" />
              </svg>
              <div className="relative z-10 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-acp-bronze to-acp-bronze-dark text-white shadow-lg border border-white/[0.02]">
                <LockKeyhole className="h-5 w-5" aria-hidden="true" />
              </div>
            </div>

            <h2 className="font-display text-2xl text-white font-normal italic tracking-wide">
              Aysan Capital Partners
            </h2>
            <p className="mt-1 text-[10px] font-extrabold uppercase tracking-[0.2em] text-acp-bronze">
              Admin Control Panel
            </p>
          </div>

          <div className="mt-8 space-y-5">
            <div className="rounded-xl border border-white/5 bg-white/[0.01] p-4 text-center">
              <p className="text-[11px] leading-relaxed text-slate-400">
                This area contains sensitive operational records and deal flow tools. Input credentials to proceed.
              </p>
            </div>

            <div>
              <label className="block text-[9px] font-extrabold uppercase tracking-[0.18em] text-slate-400 mb-2" htmlFor="admin-email">
                Email Address
              </label>
              <div className="relative">
                <input
                  id="admin-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@aysancapital.com"
                  className="h-11 w-full rounded-xl border border-white/[0.02] bg-white/[0.015] pl-10 pr-4 text-sm text-white placeholder-slate-650 outline-none transition-all duration-300 focus:border-acp-bronze focus:ring-1 focus:ring-acp-bronze"
                  required
                  autoComplete="email"
                />
                <Mail className="absolute left-3.5 top-3.5 h-4 w-4 text-slate-500" />
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="block text-[9px] font-extrabold uppercase tracking-[0.18em] text-slate-400" htmlFor="admin-password">
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setIsResetting(true);
                    setError("");
                  }}
                  className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-acp-bronze hover:underline transition cursor-pointer"
                >
                  Forgot Password?
                </button>
              </div>
              <input
                id="admin-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-11 w-full rounded-xl border border-white/[0.02] bg-white/[0.015] px-4 text-sm text-white placeholder-slate-650 outline-none transition-all duration-300 focus:border-acp-bronze focus:ring-1 focus:ring-acp-bronze"
                autoComplete="current-password"
                required
              />
            </div>

            {error ? (
              <p className="text-center text-xs font-semibold text-rose-450 animate-pulse">{error}</p>
            ) : null}

            <button
              type="submit"
              disabled={isVerifying}
              className="w-full inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-acp-bronze to-acp-bronze-dark px-4 text-xs font-bold uppercase tracking-wider text-white shadow-md hover:shadow-glow-bronze transition-all duration-300 transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              {isVerifying ? "Verifying..." : "Verify and Access"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

import { FormEvent, useState, useEffect } from "react";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { config } from "../../config/env";

type AdminGuardProps = {
  children: React.ReactNode;
};

export function AdminGuard({ children }: AdminGuardProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  useEffect(() => {
    const isAuthed = sessionStorage.getItem("admin_authenticated");
    if (isAuthed === "true") {
      setIsAuthorized(true);
    }
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isVerifying) return;
    setIsVerifying(true);
    setError("");

    const requiredPass = config.lenderRoomPassword || "acp-deal-room";

    if (password === requiredPass) {
      sessionStorage.setItem("admin_authenticated", "true");
      sessionStorage.setItem("admin_passcode", password);
      setIsAuthorized(true);
      setError("");
      setIsVerifying(false);
      return;
    }

    try {
      const response = await fetch("/api/admin/lenders", {
        headers: {
          "x-admin-passcode": password
        }
      });
      if (response.ok) {
        sessionStorage.setItem("admin_authenticated", "true");
        sessionStorage.setItem("admin_passcode", password);
        setIsAuthorized(true);
        setError("");
      } else {
        setError("Incorrect administrator password.");
      }
    } catch (err) {
      setError("Failed to connect. Please verify your connection.");
    } finally {
      setIsVerifying(false);
    }
  }

  if (isAuthorized) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-[#0A0A0B] flex items-center justify-center p-4 relative overflow-hidden">
      {/* Decorative ambient glows */}
      <div className="absolute -left-20 -top-20 h-80 w-80 rounded-full bg-acp-bronze/5 blur-[100px] pointer-events-none" />
      <div className="absolute -right-20 -bottom-20 h-80 w-80 rounded-full bg-acp-bronze/5 blur-[100px] pointer-events-none" />

      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md relative z-10 rounded-2xl border border-white/10 bg-[#0D0D0E] backdrop-blur-xl p-8 shadow-2xl card-sheen"
      >
        <div className="flex flex-col items-center text-center">
          <div className="relative mb-6 flex items-center justify-center h-20 w-20">
            <svg
              className="absolute inset-0 h-full w-full text-acp-bronze/20 animate-[spin_30s_linear_infinite]"
              viewBox="0 0 100 100"
              style={{ transform: `rotate(${password.length * 12}deg)`, transition: "transform 0.4s ease-out" }}
            >
              <circle cx="50" cy="50" r="45" stroke="currentColor" strokeWidth="1" strokeDasharray="6 4" fill="none" />
            </svg>
            <div className="relative z-10 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-acp-bronze to-acp-bronze-dark text-white shadow-lg border border-white/10">
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
              This area contains sensitive operational records and deal flow tools. Input the administrator passcode to proceed.
            </p>
          </div>

          <div>
            <label className="block text-[9px] font-extrabold uppercase tracking-[0.18em] text-slate-555" htmlFor="admin-password">
              Admin Password
            </label>
            <input
              id="admin-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="mt-2.5 h-11 w-full rounded-xl border border-white/10 bg-white/5 px-4 text-sm text-white placeholder-slate-650 outline-none transition-all duration-300 focus:border-acp-bronze focus:ring-1 focus:ring-acp-bronze"
              autoComplete="current-password"
            />
          </div>

          {error ? (
            <p className="text-center text-xs font-semibold text-rose-400 animate-pulse">{error}</p>
          ) : null}

          <button
            type="submit"
            disabled={isVerifying}
            className="w-full inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-acp-bronze to-acp-bronze-dark px-4 text-xs font-bold uppercase tracking-wider text-white shadow-md hover:shadow-glow-bronze transition-all duration-300 transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            {isVerifying ? "Verifying..." : "Verify and Access"}
          </button>
        </div>
      </form>
    </div>
  );
}

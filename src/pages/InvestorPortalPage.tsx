/**
 * Capital Partner Portal (Build Pack Sections 10 and 11).
 *
 * The whole screen answers four questions and nothing else: what have I
 * committed, what has been drawn, what has come back, and is the business
 * covering its debt. Everything shown is an actual with a provenance badge, and
 * anything not yet known says when it will be.
 *
 * What is deliberately absent: IRR, multiple, yield, hold period, target
 * return, any forecast, any other partner's rows, any CFS code, lender or
 * seller. Those columns do not exist in the views this page reads, so no change
 * here can put one on the screen.
 *
 * Onboarding runs before the shell: a partner signing in with the temporary
 * password we emailed must choose their own, then accept the terms, before any
 * holding is visible.
 */
import { FormEvent, InputHTMLAttributes, useCallback, useEffect, useState } from "react";
import {
  Activity as ActivityIcon,
  Building2,
  Eye,
  EyeOff,
  FileText,
  Landmark,
  LayoutGrid,
  LogOut,
  UserRound,
} from "lucide-react";
import {
  acceptTerms,
  getAccount,
  getAcquisition,
  getActivity,
  getDashboard,
  getDocuments,
  requestPasswordReset,
  resetPassword,
  setPassword,
  type PortalAccount,
  type PortalAcquisition,
  type PortalAcquisitionDetail,
  type PortalActivity,
  type PortalDashboard,
  type PortalDocument,
} from "../api/investorPortal";
import { clearApiCache } from "../api/http";
import { COPY, AMORT_LABEL, activityLine, formatDate, gbp, pct } from "../lib/portal/format";
import {
  ActivityItem,
  CoveragePill,
  DocRow,
  DocOpenButton,
  MetricRow,
  PortalEmpty,
  PortalFooter,
  PortalStatCard,
  ProvenanceBadge,
  RailRow,
  ReadOnlyBanner,
} from "../components/portal/PortalUI";
import { LoadingState } from "../components/ui/LoadingState";
import { ErrorState } from "../components/ui/ErrorState";
import { cx } from "../utils/cx";
import { clearRealtimeAuth } from "../lib/supabase";

type View = "dashboard" | "acquisitions" | "documents" | "activity" | "account";

const NAV: Array<{ key: View; label: string; short: string; icon: typeof LayoutGrid }> = [
  { key: "dashboard", label: "Dashboard", short: "Home", icon: LayoutGrid },
  { key: "acquisitions", label: "Acquisitions", short: "Holdings", icon: Building2 },
  { key: "documents", label: "Documents", short: "Docs", icon: FileText },
  { key: "activity", label: "Activity", short: "Activity", icon: ActivityIcon },
];

export function InvestorPortalPage() {
  const [signedIn, setSignedIn] = useState(false);
  const [checking, setChecking] = useState(true);
  const [account, setAccount] = useState<PortalAccount | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [openDeal, setOpenDeal] = useState<string | null>(null);

  // Resume an existing session. Only an investor account belongs here; a staff
  // or lender cookie is ignored rather than half-loading a portal they cannot
  // read anyway.
  useEffect(() => {
    fetch("/api/auth/session", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.authenticated && String(data.user?.role ?? "").toLowerCase() === "investor") {
          setSignedIn(true);
        }
      })
      .catch(() => undefined)
      .finally(() => setChecking(false));
  }, []);

  const loadAccount = useCallback(async () => {
    const next = await getAccount({ noCache: true });
    setAccount(next);
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    loadAccount().catch(() => setSignedIn(false));
  }, [signedIn, loadAccount]);

  const handleSignOut = useCallback(() => {
    fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    void clearRealtimeAuth();
    clearApiCache();
    setSignedIn(false);
    setAccount(null);
    setView("dashboard");
    setOpenDeal(null);
  }, []);

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0e1420]">
        <LoadingState label="Loading the portal" />
      </div>
    );
  }

  if (!signedIn) return <PortalLogin onSignedIn={() => setSignedIn(true)} />;
  if (!account) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0e1420]">
        <LoadingState label="Loading your record" />
      </div>
    );
  }

  // Onboarding gates, in order. Neither can be skipped: both are re-read from
  // the server after each step rather than assumed from local state.
  if (account.must_change_password) {
    return (
      <SetPasswordScreen
        name={account.name}
        email={account.email}
        recovery={account.recovery_pending}
        onDone={loadAccount}
      />
    );
  }
  if ((account.terms_version ?? 0) < account.current_terms_version) {
    return <TermsScreen version={account.current_terms_version} onDone={loadAccount} />;
  }

  return (
    <PortalShell
      account={account}
      view={view}
      onView={(v) => {
        setView(v);
        setOpenDeal(null);
      }}
      onSignOut={handleSignOut}
    >
      {view === "dashboard" && (
        <DashboardView
          onOpenAcquisition={(key) => {
            setOpenDeal(key);
            setView("acquisitions");
          }}
          onSeeAllActivity={() => setView("activity")}
        />
      )}
      {view === "acquisitions" &&
        (openDeal ? (
          <AcquisitionDetail dealKey={openDeal} onBack={() => setOpenDeal(null)} />
        ) : (
          <AcquisitionsView onOpen={setOpenDeal} />
        ))}
      {view === "documents" && <DocumentsView />}
      {view === "activity" && <ActivityView />}
      {view === "account" && <AccountView account={account} onSignOut={handleSignOut} onChanged={loadAccount} />}
    </PortalShell>
  );
}

// ==========================================================================
//  Auth and onboarding
// ==========================================================================

const AuthCard = ({ title, step, children }: { title: string; step?: string; children: React.ReactNode }) => (
  <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0e1420] p-4 text-slate-100">
    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,#c9a25715_0%,transparent_55%)]" />
    <div className="relative w-full max-w-md rounded-2xl border border-white/5 bg-[#161d2c]/95 p-8 shadow-2xl">
      <div className="mb-7 flex flex-col items-center text-center">
        <div className="mb-4 flex h-13 w-13 items-center justify-center rounded-xl bg-gradient-to-br from-[#c9a257] to-[#b8924f] p-3">
          <Landmark className="h-6 w-6 text-[#0e1420]" />
        </div>
        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#c9a257]">
          Aysan Capital Partners
        </p>
        <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Partner Portal</p>
        {step ? <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{step}</p> : null}
        <h1 className="mt-2 font-display text-2xl font-semibold text-white">{title}</h1>
      </div>
      {children}
    </div>
  </div>
);

const fieldClass =
  "w-full rounded border border-white/10 bg-[#0a0f18] px-3 py-2.5 text-sm text-white outline-none transition focus:border-[#c9a257] focus:ring-2 focus:ring-[#c9a257]/40";
const labelClass = "mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400";
const buttonClass =
  "w-full rounded bg-[#c9a257] px-4 py-2.5 text-sm font-semibold text-[#0e1420] transition hover:bg-[#d4b06a] disabled:cursor-not-allowed disabled:opacity-50";
const errorClass =
  "rounded border border-rose-500/25 bg-rose-500/10 px-3 py-2.5 text-center text-xs font-medium text-rose-300";

/** A password input with a show/hide toggle, so a partner can check what they typed. */
function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className">) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={visible ? "text" : "password"} className={`${fieldClass} pr-11`} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        title={visible ? "Hide password" : "Show password"}
        className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-slate-500 transition hover:text-[#c9a257]"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function PortalLogin({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPasswordValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);

  if (forgot) return <ForgotPassword initialEmail={email} onBack={() => setForgot(false)} />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (res.status === 429) throw new Error(COPY.loginRateLimit);
      if (!res.ok) throw new Error(COPY.loginError);

      const data = await res.json();
      // A correct password for a non-partner account is still a refusal here,
      // and the cookies it just set are cleared so the next page load cannot
      // walk past this check.
      if (String(data.user?.role ?? "").toLowerCase() !== "investor") {
        await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
        throw new Error(COPY.loginError);
      }
      clearApiCache();
      onSignedIn();
    } catch (err: any) {
      setError(err?.message || COPY.loginError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Sign in">
      <form onSubmit={submit} className="space-y-4">
        {error ? <div className={errorClass}>{error}</div> : null}
        <div>
          <label className={labelClass} htmlFor="portal-email">
            Email
          </label>
          <input
            id="portal-email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={fieldClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="portal-password">
            Password
          </label>
          <PasswordInput
            id="portal-password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPasswordValue(e.target.value)}
          />
        </div>
        <button type="submit" disabled={busy} className={buttonClass}>
          {busy ? "Signing in…" : "Continue"}
        </button>
      </form>
      <p className="mt-5 text-center">
        <button
          type="button"
          onClick={() => setForgot(true)}
          className="text-[11px] font-semibold text-[#c9a257] hover:underline"
        >
          Forgotten your password?
        </button>
      </p>
      <p className="mt-5 text-center text-[11px] leading-relaxed text-slate-500">{COPY.loginNote}</p>
    </AuthCard>
  );
}

/**
 * The reply never changes, whoever the address belongs to. Telling a stranger
 * that an address does or does not have portal access would tell them whether
 * that person is one of ACP's capital partners.
 */
function ForgotPassword({ initialEmail, onBack }: { initialEmail: string; onBack: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await requestPasswordReset(email.trim());
    } catch {
      // Deliberately ignored: a failure here must not become a different answer.
    } finally {
      setSent(true);
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Reset your password">
      {sent ? (
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-slate-300">{COPY.resetSent}</p>
          <p className="text-[11px] leading-relaxed text-slate-500">
            The link is good for one hour. If it does not arrive, email{" "}
            <a href={`mailto:${COPY.contact}`} className="text-[#c9a257] hover:underline">
              {COPY.contact}
            </a>
            .
          </p>
          <button type="button" onClick={onBack} className={buttonClass}>
            Back to sign in
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-xs leading-relaxed text-slate-400">
            Enter the email address your portal access was issued to and we will send you a reset link.
          </p>
          <div>
            <label className={labelClass} htmlFor="forgot-email">
              Email
            </label>
            <input
              id="forgot-email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={fieldClass}
            />
          </div>
          <button type="submit" disabled={busy} className={buttonClass}>
            {busy ? "Sending…" : "Send reset link"}
          </button>
          <button
            type="button"
            onClick={onBack}
            className="w-full text-center text-[11px] text-slate-500 hover:text-slate-300"
          >
            Back to sign in
          </button>
        </form>
      )}
    </AuthCard>
  );
}

function SetPasswordScreen({
  name,
  email,
  recovery,
  onDone,
}: {
  name: string;
  email: string;
  /** Arrived on a reset link: they do not know the current password, and the
   *  server accepts a change without it inside a short window. */
  recovery: boolean;
  onDone: () => Promise<void>;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (next !== confirm) {
      setError("Those passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (recovery) await resetPassword(next);
      else await setPassword(current, next);
      await onDone();
    } catch (err: any) {
      setError(err?.message || "That did not work. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title={recovery ? "Choose a new password" : `Welcome, ${name || "partner"}`}
      step={recovery ? undefined : "Step 1 of 2"}
    >
      <form onSubmit={submit} className="space-y-4">
        {error ? <div className={errorClass}>{error}</div> : null}
        <p className="text-xs leading-relaxed text-slate-400">
          {recovery ? (
            <>
              Choose a new password for <span className="text-slate-200">{email}</span>.
            </>
          ) : (
            <>
              Set your own password for <span className="text-slate-200">{email}</span>. The password we emailed you is
              temporary.
            </>
          )}
        </p>
        {recovery ? null : (
          <div>
            <label className={labelClass} htmlFor="cur-pw">
              Temporary password
            </label>
            <PasswordInput
              id="cur-pw"
              autoComplete="current-password"
              required
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
        )}
        <div>
          <label className={labelClass} htmlFor="new-pw">
            New password
          </label>
          <PasswordInput
            id="new-pw"
            autoComplete="new-password"
            required
            minLength={12}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="confirm-pw">
            Confirm password
          </label>
          <PasswordInput
            id="confirm-pw"
            autoComplete="new-password"
            required
            minLength={12}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <p className="text-[11px] leading-relaxed text-slate-500">
          At least 12 characters. Use a password you do not use elsewhere.
        </p>
        <button type="submit" disabled={busy} className={buttonClass}>
          {busy ? "Saving…" : "Continue"}
        </button>
      </form>
    </AuthCard>
  );
}

function TermsScreen({ version, onDone }: { version: number; onDone: () => Promise<void> }) {
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await acceptTerms(version);
      await onDone();
    } catch (err: any) {
      setError(err?.message || "That did not work. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Before you continue" step="Step 2 of 2">
      <div className="space-y-4">
        {error ? <div className={errorClass}>{error}</div> : null}
        <p className="text-xs leading-relaxed text-slate-400">
          This portal shows actuals only. ACP publishes no forecasts, target returns or dates. Investment in unlisted
          companies places your capital at risk and is illiquid.
        </p>
        <label className="flex cursor-pointer items-start gap-3 rounded border border-white/10 bg-[#0a0f18] p-3">
          <input
            type="checkbox"
            checked={ticked}
            onChange={(e) => setTicked(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[#c9a257]"
          />
          <span className="text-xs leading-relaxed text-slate-300">
            I have read and accept the portal terms and privacy notice.
          </span>
        </label>
        <button type="button" onClick={submit} disabled={!ticked || busy} className={buttonClass}>
          {busy ? "Saving…" : "Enter portal"}
        </button>
      </div>
    </AuthCard>
  );
}

// ==========================================================================
//  Shell
// ==========================================================================

function PortalShell({
  account,
  view,
  onView,
  onSignOut,
  children,
}: {
  account: PortalAccount;
  view: View;
  onView: (v: View) => void;
  onSignOut: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#0e1420] text-slate-100">
      <header className="sticky top-0 z-20 border-b border-white/5 bg-[#0a0f18]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-4 px-4 py-3">
          <p className="truncate text-[10px] font-black uppercase tracking-[0.18em] text-[#c9a257]">
            Aysan Capital Partners
            <span className="ml-2 hidden text-slate-500 sm:inline">· Partner Portal</span>
          </p>
          <button
            type="button"
            onClick={() => onView("account")}
            className={cx(
              "flex items-center gap-2 rounded px-2 py-1 text-xs transition hover:bg-white/5",
              view === "account" ? "text-[#c9a257]" : "text-slate-300",
            )}
          >
            <UserRound className="h-4 w-4" />
            <span className="max-w-[10rem] truncate">{account.name}</span>
          </button>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1280px] gap-6 px-4 pb-24 pt-6 md:pb-8">
        <nav className="hidden w-48 shrink-0 md:block">
          <ul className="sticky top-24 space-y-1">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = view === item.key;
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    onClick={() => onView(item.key)}
                    className={cx(
                      "flex w-full items-center gap-2.5 rounded px-3 py-2 text-left text-sm transition",
                      active
                        ? "bg-[#c9a257]/10 font-semibold text-[#c9a257]"
                        : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </button>
                </li>
              );
            })}
            <li className="pt-3">
              <button
                type="button"
                onClick={onSignOut}
                className="flex w-full items-center gap-2.5 rounded px-3 py-2 text-left text-sm text-slate-500 transition hover:bg-white/5 hover:text-slate-300"
              >
                <LogOut className="h-4 w-4 shrink-0" />
                Sign out
              </button>
            </li>
          </ul>
        </nav>

        <main className="min-w-0 flex-1">
          {account.read_only ? (
            <div className="mb-5">
              <ReadOnlyBanner until={account.read_only_until} />
            </div>
          ) : null}
          {children}
          <PortalFooter />
        </main>
      </div>

      {/* Under 768px the side nav becomes a bottom bar. */}
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-white/5 bg-[#0a0f18]/95 backdrop-blur md:hidden">
        <ul className="mx-auto flex max-w-lg">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = view === item.key;
            return (
              <li key={item.key} className="flex-1">
                <button
                  type="button"
                  onClick={() => onView(item.key)}
                  className={cx(
                    "flex w-full flex-col items-center gap-1 py-2.5 text-[10px] font-semibold transition",
                    active ? "text-[#c9a257]" : "text-slate-500",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.short}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

const PageTitle = ({ children }: { children: React.ReactNode }) => (
  <h1 className="mb-5 font-display text-[28px] font-semibold leading-tight text-white">{children}</h1>
);

const Panel = ({ title, children }: { title?: string; children: React.ReactNode }) => (
  <section className="rounded-lg border border-white/5 bg-[#161B22] p-5">
    {title ? <h2 className="mb-3 text-sm font-semibold text-white">{title}</h2> : null}
    {children}
  </section>
);

/** Shared loader for the views below. */
function useAsync<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    load()
      .then((value) => live && setData(value))
      .catch((err) => live && setError(err?.message || "Something went wrong loading this."))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, setData };
}

// ==========================================================================
//  Dashboard
// ==========================================================================

function DashboardView({
  onOpenAcquisition,
  onSeeAllActivity,
}: {
  onOpenAcquisition: (dealKey: string) => void;
  onSeeAllActivity: () => void;
}) {
  const { data, error, loading } = useAsync<PortalDashboard>(() => getDashboard({ noCache: true }), []);

  if (loading) return <LoadingState label="Loading your portfolio" />;
  if (error) return <ErrorState error={new Error(error)} />;
  if (!data) return null;

  const { summary, acquisitions, activity, capital_activity: transactions } = data;
  const hasHoldings = acquisitions.length > 0;
  const hasDistribution = transactions.some((t) => t.type === "distribution" && t.settled);

  return (
    <>
      <PageTitle>Welcome back, {data.partner.name}</PageTitle>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <PortalStatCard label="Committed" value={gbp(summary.committed_pence)} provenance="verified" />
        <PortalStatCard label="Drawn" value={gbp(summary.drawn_pence)} provenance="verified" />
        <PortalStatCard label="Distributed" value={gbp(summary.distributed_pence)} provenance="verified" />
        <PortalStatCard label="Acquisitions" value={String(summary.acquisitions)} hint="held" />
      </div>

      {!hasHoldings ? (
        <div className="mt-5">
          <PortalEmpty
            title="Your portfolio will appear here once your first acquisition completes."
            body="Commitments, capital calls, distributions and quarterly reports are recorded as they happen."
            icon={<Building2 className="h-6 w-6" />}
          />
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="Capital activity">
          {hasDistribution ? (
            <ul className="divide-y divide-white/5">
              {transactions
                .filter((t) => t.settled)
                .slice(0, 8)
                .map((t) => (
                  <li key={t.id} className="flex items-center justify-between py-2.5 text-sm">
                    <span className="text-slate-300">
                      {t.type === "call" ? "Capital call" : "Distribution"} · {formatDate(t.txn_date)}
                    </span>
                    <span className="tabular-nums text-white">{gbp(t.amount_pence)}</span>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="py-8 text-center text-xs leading-relaxed text-slate-500">{COPY.chartEmpty}</p>
          )}
        </Panel>

        <Panel title="Recent activity">
          {activity.length ? (
            <>
              <div>
                {activity.map((item) => (
                  <ActivityItem
                    key={item.id}
                    eventType={item.event_type}
                    payload={item.payload}
                    createdAt={item.created_at}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={onSeeAllActivity}
                className="mt-3 text-xs font-semibold text-[#c9a257] hover:underline"
              >
                View all activity
              </button>
            </>
          ) : (
            <p className="py-8 text-center text-xs text-slate-500">
              Activity appears here as commitments, calls and reports are recorded.
            </p>
          )}
        </Panel>
      </div>

      {hasHoldings ? (
        <div className="mt-5">
          <Panel title="Your acquisitions">
            <AcquisitionTable rows={acquisitions} onOpen={onOpenAcquisition} />
          </Panel>
        </div>
      ) : null}
    </>
  );
}

function AcquisitionTable({
  rows,
  onOpen,
}: {
  rows: PortalAcquisition[];
  onOpen: (dealKey: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left">
        <thead>
          <tr className="border-b border-white/5 text-[10px] uppercase tracking-[0.12em] text-slate-500">
            <th className="py-2 font-semibold">Acquisition</th>
            <th className="py-2 font-semibold">Coverage</th>
            <th className="py-2 text-right font-semibold">Your commitment</th>
            <th className="py-2 text-right font-semibold">Next report</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.commitment_id}
              onClick={() => onOpen(row.deal_key)}
              className="cursor-pointer border-b border-white/5 transition last:border-b-0 hover:bg-white/[0.03]"
            >
              <td className="py-3 pr-3 text-sm text-slate-200">
                {row.display_name ?? "Acquisition"}
                {row.sector || row.region ? (
                  <span className="block text-[11px] text-slate-500">
                    {[row.sector, row.region].filter(Boolean).join(" · ")}
                  </span>
                ) : null}
              </td>
              <td className="py-3 pr-3">
                <CoveragePill status={row.dscr_status} />
              </td>
              <td className="py-3 pr-3 text-right text-sm tabular-nums text-white">{gbp(row.committed_pence)}</td>
              <td className="py-3 text-right text-sm text-slate-400">{formatDate(row.next_report_date) || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ==========================================================================
//  Acquisitions
// ==========================================================================

function AcquisitionsView({ onOpen }: { onOpen: (dealKey: string) => void }) {
  const { data, error, loading } = useAsync<PortalDashboard>(() => getDashboard(), []);

  if (loading) return <LoadingState label="Loading your acquisitions" />;
  if (error) return <ErrorState error={new Error(error)} />;
  if (!data) return null;

  const held = data.acquisitions.filter((a) => a.commitment_status !== "bought_back");
  const past = data.acquisitions.filter((a) => a.commitment_status === "bought_back");

  return (
    <>
      <PageTitle>Acquisitions</PageTitle>
      {held.length === 0 ? (
        <PortalEmpty
          title="No acquisitions yet."
          body="Your holdings appear here once a commitment completes. Each one shows what you committed, what has been drawn, and whether the business is covering its debt."
          icon={<Building2 className="h-6 w-6" />}
        />
      ) : (
        <div className="grid gap-4">
          {held.map((row) => (
            <AcquisitionCard key={row.commitment_id} row={row} onOpen={onOpen} />
          ))}
        </div>
      )}

      {past.length ? (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-slate-400">Past holdings</h2>
          <div className="grid gap-4">
            {past.map((row) => (
              <AcquisitionCard key={row.commitment_id} row={row} onOpen={onOpen} />
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

function AcquisitionCard({ row, onOpen }: { row: PortalAcquisition; onOpen: (key: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(row.deal_key)}
      className="w-full rounded-lg border border-white/5 bg-[#161B22] p-5 text-left transition hover:border-[#c9a257]/30"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-lg font-semibold text-white">{row.display_name ?? "Acquisition"}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {[row.sector, row.region].filter(Boolean).join(" · ")}
            {row.completed_at ? ` · Completed ${formatDate(row.completed_at)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {row.commitment_status === "converted" ? (
            <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] font-semibold text-slate-400">
              Converted to holdco
            </span>
          ) : null}
          <CoveragePill status={row.dscr_status} />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Figure label="Committed" value={gbp(row.committed_pence)} />
        <Figure label="Ownership" value={row.ownership_bp !== null ? pct(row.ownership_bp) : "—"} />
        <Figure label="Contracted revenue" value={row.contracted_bp_verified !== null ? pct(row.contracted_bp_verified) : "—"} />
        <Figure label="Next report" value={formatDate(row.next_report_date) || "—"} />
      </div>
    </button>
  );
}

const Figure = ({ label, value }: { label: string; value: string }) => (
  <div>
    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
    <p className="mt-1 text-sm tabular-nums text-white">{value}</p>
  </div>
);

const TABS = ["overview", "business", "documents", "reporting", "covenants"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = {
  overview: "Overview",
  business: "The Business",
  documents: "Documents",
  reporting: "Reporting",
  covenants: "Covenants",
};

function AcquisitionDetail({ dealKey, onBack }: { dealKey: string; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>("overview");
  const { data, error, loading } = useAsync<PortalAcquisitionDetail>(
    () => getAcquisition(dealKey, { noCache: true }),
    [dealKey],
  );

  if (loading) return <LoadingState label="Loading the acquisition" />;
  if (error) return <ErrorState error={new Error(error)} />;
  if (!data) return null;

  const a = data.acquisition;
  const latestReport = data.reports.find((r) => r.published_at);

  return (
    <>
      <button type="button" onClick={onBack} className="mb-2 text-xs text-slate-500 hover:text-slate-300">
        ← Acquisitions
      </button>
      <PageTitle>{a.display_name ?? "Acquisition"}</PageTitle>

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-white/5">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cx(
              "shrink-0 border-b-2 px-3 py-2 text-sm transition",
              tab === t
                ? "border-[#c9a257] font-semibold text-[#c9a257]"
                : "border-transparent text-slate-400 hover:text-slate-200",
            )}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <div className="min-w-0">
          {tab === "overview" ? (
            <Panel>
              <MetricRow
                label="Debt service coverage vs covenant"
                value={<CoveragePill status={a.dscr_status} />}
                provenance="cfo_certified"
              />
              <MetricRow
                label="Contracted revenue share"
                value={a.contracted_bp_verified !== null ? pct(a.contracted_bp_verified) : "Not yet reported"}
                provenance={a.contracted_bp_verified !== null ? "verified_ledger" : "pending"}
              />
              <MetricRow
                label="Senior debt amortisation"
                value={AMORT_LABEL[a.amort_status] ?? a.amort_status}
                provenance="filed"
              />
              <MetricRow
                label="Distributions paid to date"
                value={gbp(
                  data.transactions
                    .filter((t) => t.type === "distribution" && t.settled)
                    .reduce((s, t) => s + Number(t.amount_pence), 0),
                )}
                provenance="verified"
              />
              <MetricRow label="Next quarterly report" value={formatDate(a.next_report_date) || "Not yet scheduled"} />
              <p className="mt-4 text-[11px] leading-relaxed text-slate-500">{COPY.dealActuals}</p>
            </Panel>
          ) : null}

          {tab === "business" ? (
            <Panel title="The business">
              {a.summary || a.business_description ? (
                <p className="whitespace-pre-line text-sm leading-relaxed text-slate-300">
                  {a.summary || a.business_description}
                </p>
              ) : (
                <PortalEmpty
                  title="This section is being written."
                  body="A description of the business, the statutory obligation it serves and what ACP has installed since completion will appear here."
                />
              )}
              {a.customer_types?.length ? (
                <div className="mt-5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Customers</p>
                  <p className="mt-1 text-sm text-slate-300">{a.customer_types.join(", ")}</p>
                </div>
              ) : null}
              <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
                {a.sector ? <Figure label="Sector" value={a.sector} /> : null}
                {a.headcount_band ? <Figure label="Headcount" value={a.headcount_band} /> : null}
                {a.founded_year ? <Figure label="Founded" value={String(a.founded_year)} /> : null}
                {a.region ? <Figure label="Region" value={a.region} /> : null}
              </div>
              {a.milestones?.length ? (
                <div className="mt-6">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                    Since completion
                  </p>
                  <ul className="space-y-2">
                    {a.milestones.map((m, i) => (
                      <li key={`${m.date}-${i}`} className="text-sm text-slate-300">
                        <span className="text-slate-500">{formatDate(m.date)}</span> · {m.text}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Panel>
          ) : null}

          {tab === "documents" ? (
            <Panel title="Documents">
              {data.documents.length ? (
                <>
                  {data.documents.map((d) => (
                    <DocRow
                      key={d.id}
                      id={d.id}
                      title={d.title}
                      docType={d.doc_type}
                      date={d.published_at}
                      available={d.available}
                      publishesOn={d.publishes_on}
                      viewOnly={d.view_only}
                      hasFile={d.has_file}
                    />
                  ))}
                  <p className="mt-3 text-[11px] text-slate-500">{COPY.docsNote}</p>
                </>
              ) : (
                <PortalEmpty
                  title="No documents yet."
                  body="Your subscription agreement, the SPV shareholders' agreement and each quarterly report appear here as they are executed and published."
                />
              )}
            </Panel>
          ) : null}

          {tab === "reporting" ? (
            <Panel title="Reporting">
              {data.reports.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-left">
                    <thead>
                      <tr className="border-b border-white/5 text-[10px] uppercase tracking-[0.12em] text-slate-500">
                        <th className="py-2 font-semibold">Period</th>
                        <th className="py-2 font-semibold">Published</th>
                        <th className="py-2 font-semibold">Trading summary</th>
                        <th className="py-2 font-semibold">Coverage</th>
                        <th className="py-2 font-semibold">Files</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.reports.map((r) => (
                        <tr key={r.id} className="border-b border-white/5 last:border-b-0">
                          <td className="py-3 pr-3 text-sm text-slate-200">{r.period_label}</td>
                          <td className="py-3 pr-3 text-sm text-slate-400">
                            {r.published_at ? (
                              formatDate(r.published_at)
                            ) : (
                              <span className="font-semibold text-[#c9a257]">
                                Publishes {formatDate(r.publishes_on)}
                              </span>
                            )}
                          </td>
                          <td className="py-3 pr-3 text-sm text-slate-300">{r.trading_summary ?? "—"}</td>
                          <td className="py-3 pr-3">
                            {r.coverage_at_period ? <CoveragePill status={r.coverage_at_period} /> : "—"}
                          </td>
                          <td className="py-3">
                            {r.published_at && (r.report_document_id || r.certificate_document_id) ? (
                              <div className="flex flex-wrap gap-1.5">
                                {r.report_document_id ? <DocOpenButton id={r.report_document_id} label="Report" /> : null}
                                {r.certificate_document_id ? (
                                  <DocOpenButton id={r.certificate_document_id} label="Certificate" />
                                ) : null}
                              </div>
                            ) : (
                              <span className="text-xs text-slate-500">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <PortalEmpty
                  title="The first report has not been scheduled yet."
                  body="Reporting is quarterly. Each period shows the date it publishes, a trading summary written by ACP, and the coverage status at period end."
                />
              )}
            </Panel>
          ) : null}

          {tab === "covenants" ? (
            <Panel title="Covenants">
              <div className="flex items-center gap-3">
                <CoveragePill status={a.dscr_status} />
                <ProvenanceBadge kind="cfo_certified" />
              </div>
              <p className="mt-3 text-sm leading-relaxed text-slate-300">
                {
                  ({
                    above_floor:
                      "Above floor: debt service coverage cleared the covenant floor at the last certified test.",
                    watch:
                      "Watch: coverage cleared the floor with limited headroom. Distributions are unlikely until headroom recovers.",
                    breach:
                      "Breach: coverage fell below the covenant floor. No distributions are permitted. The quarterly report explains the position and the actions under way.",
                    not_yet_reported:
                      "Not yet reported: the first certified coverage test follows the first full quarter after completion.",
                  } as Record<string, string>)[a.dscr_status]
                }
              </p>
              <p className="mt-2 text-[11px] text-slate-500">
                The coverage figure itself is in the covenant certificate, which is where it is certified.
              </p>

              {data.coverage_history.length ? (
                <div className="mt-6">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">History</p>
                  <ul className="space-y-2">
                    {data.coverage_history.map((h, i) => (
                      <li key={`${h.set_at}-${i}`} className="flex items-center gap-3 text-sm">
                        <CoveragePill status={h.status} />
                        <span className="text-slate-500">{formatDate(h.set_at)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Panel>
          ) : null}
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-lg border border-white/5 bg-[#161B22] p-5">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Your position</p>
            <RailRow label="Instrument" value={a.instrument === "spv_equity_conversion" ? "SPV equity" : a.instrument} />
            <RailRow label="Conversion right" value="Holdco" />
            <RailRow label="Your commitment" value={gbp(a.committed_pence)} />
            <RailRow
              label="Drawn"
              value={gbp(
                data.transactions.filter((t) => t.type === "call" && t.settled).reduce((s, t) => s + Number(t.amount_pence), 0),
              )}
            />
            <RailRow label="Ownership" value={a.ownership_bp !== null ? pct(a.ownership_bp) : "—"} />
            <RailRow label="Reporting" value="Quarterly" />
            <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
              {latestReport
                ? `Latest report: ${latestReport.period_label}, published ${formatDate(latestReport.published_at)}.`
                : `First report publishes ${formatDate(a.next_report_date) || "when scheduled"}.`}
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}

// ==========================================================================
//  Documents, activity, account
// ==========================================================================

function DocumentsView() {
  const { data, error, loading } = useAsync<{ rows: PortalDocument[] }>(() => getDocuments(), []);
  const [filter, setFilter] = useState<string>("all");

  if (loading) return <LoadingState label="Loading your documents" />;
  if (error) return <ErrorState error={new Error(error)} />;
  if (!data) return null;

  const groups = new Map<string, PortalDocument[]>();
  for (const doc of data.rows) {
    const key = doc.partner_display_name ?? "Your documents";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(doc);
  }
  const names = Array.from(groups.keys());
  const shown = filter === "all" ? names : names.filter((n) => n === filter);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <PageTitle>Documents</PageTitle>
        {names.length > 1 ? (
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded border border-white/10 bg-[#0a0f18] px-3 py-2 text-xs text-slate-300"
          >
            <option value="all">All acquisitions</option>
            {names.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {data.rows.length === 0 ? (
        <PortalEmpty
          title="No documents yet."
          body="Your subscription agreement, certification and each quarterly report appear here as they are executed and published."
          icon={<FileText className="h-6 w-6" />}
        />
      ) : (
        <div className="space-y-5">
          {shown.map((name) => (
            <Panel key={name} title={name}>
              {groups.get(name)!.map((d) => (
                <DocRow
                  key={d.id}
                  id={d.id}
                  title={d.title}
                  docType={d.doc_type}
                  date={d.published_at}
                  available={d.available}
                  publishesOn={d.publishes_on}
                  viewOnly={d.view_only}
                  hasFile={d.has_file}
                />
              ))}
            </Panel>
          ))}
          <p className="text-[11px] text-slate-500">{COPY.docsNote}</p>
        </div>
      )}
    </>
  );
}

function ActivityView() {
  const [page, setPage] = useState(1);
  const { data, error, loading } = useAsync<{ rows: PortalActivity[]; total: number; page_size: number }>(
    () => getActivity(page),
    [page],
  );

  if (loading) return <LoadingState label="Loading your activity" />;
  if (error) return <ErrorState error={new Error(error)} />;
  if (!data) return null;

  const pages = Math.max(1, Math.ceil(data.total / data.page_size));
  const visible = data.rows.filter((r) => activityLine(r.event_type, r.payload));

  return (
    <>
      <PageTitle>Activity</PageTitle>
      {visible.length === 0 ? (
        <PortalEmpty
          title="Nothing recorded yet."
          body="Every commitment, capital call, distribution and published report is written here as it happens."
          icon={<ActivityIcon className="h-6 w-6" />}
        />
      ) : (
        <Panel>
          {visible.map((item) => (
            <ActivityItem
              key={item.id}
              eventType={item.event_type}
              payload={item.payload}
              createdAt={item.created_at}
            />
          ))}
        </Panel>
      )}

      {pages > 1 ? (
        <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded border border-white/10 px-3 py-1.5 disabled:opacity-40"
          >
            Previous
          </button>
          <span>
            Page {page} of {pages}
          </span>
          <button
            type="button"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded border border-white/10 px-3 py-1.5 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      ) : null}
    </>
  );
}

function AccountView({
  account,
  onSignOut,
  onChanged,
}: {
  account: PortalAccount;
  onSignOut: () => void;
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (next !== confirm) {
      setMessage({ tone: "bad", text: "Those passwords do not match." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await setPassword(current, next);
      await onChanged();
      setMessage({ tone: "ok", text: "Your password has been changed." });
      setCurrent("");
      setNext("");
      setConfirm("");
      setOpen(false);
    } catch (err: any) {
      setMessage({ tone: "bad", text: err?.message || "That did not work." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageTitle>Account</PageTitle>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Your details">
          <RailRow label="Name" value={account.name} />
          <RailRow label="Email" value={account.email} />
          <RailRow
            label="Certification"
            value={
              account.certified_now && account.certification_date
                ? `Valid to ${formatDate(addYear(account.certification_date))}`
                : account.certification_status === "expired"
                  ? "Expired"
                  : "Not currently valid"
            }
          />
          <p className="mt-4 text-[11px] text-slate-500">{COPY.accountUpdate}</p>
        </Panel>

        <Panel title="Security">
          {message ? (
            <div
              className={cx(
                "mb-3 rounded border px-3 py-2 text-xs",
                message.tone === "ok"
                  ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                  : "border-rose-500/25 bg-rose-500/10 text-rose-300",
              )}
            >
              {message.text}
            </div>
          ) : null}

          {open ? (
            <form onSubmit={submit} className="space-y-3">
              <div>
                <label className={labelClass} htmlFor="acc-cur">
                  Current password
                </label>
                <PasswordInput
                  id="acc-cur"
                  required
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="acc-new">
                  New password
                </label>
                <PasswordInput
                  id="acc-new"
                  required
                  minLength={12}
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="acc-confirm">
                  Confirm new password
                </label>
                <PasswordInput
                  id="acc-confirm"
                  required
                  minLength={12}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={busy} className={buttonClass}>
                  {busy ? "Saving…" : "Change password"}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded border border-white/10 px-4 py-2.5 text-sm text-slate-300"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="rounded border border-white/10 px-4 py-2 text-sm text-slate-200 transition hover:border-[#c9a257]/40"
            >
              Change password
            </button>
          )}

          <div className="mt-6 border-t border-white/5 pt-4">
            <button
              type="button"
              onClick={onSignOut}
              className="flex items-center gap-2 text-sm text-slate-400 transition hover:text-slate-200"
            >
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        </Panel>
      </div>
    </>
  );
}

/** Certification lapses twelve months after it was signed (rule R6). */
function addYear(date: string): string {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString();
}


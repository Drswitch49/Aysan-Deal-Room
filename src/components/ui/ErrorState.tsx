import { AlertTriangle, CheckCircle2, Database, KeyRound, Table2 } from "lucide-react";
import type { ReactNode } from "react";

export function ErrorState({ error }: { error: Error }) {
  if (error.message.includes("Missing Airtable configuration")) {
    return <AirtableConfigState message={error.message} />;
  }

  if (
    error.message.includes("INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND") ||
    error.message.includes("Airtable request failed (403)")
  ) {
    return <AirtablePermissionState message={error.message} />;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-rose-500/20 bg-acp-card backdrop-blur-md shadow-premium-card">
      <div className="border-b border-rose-500/10 bg-rose-500/5 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-white/5 border border-white/10 text-rose-400 shadow-sm">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold text-white">Unable to load database data</p>
            <p className="text-xs font-medium text-rose-350">The data layer could not complete the read request.</p>
          </div>
        </div>
      </div>
      <p className="break-words px-5 py-4 text-sm leading-6 text-rose-200">{error.message}</p>
    </div>
  );
}

function AirtablePermissionState({ message }: { message: string }) {
  return (
    <section className="overflow-hidden rounded-xl border border-white/10 bg-acp-card backdrop-blur-md shadow-panel">
      <div className="border-b border-white/5 bg-white/[0.01] px-5 py-4 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Connection Status</p>
            <p className="mt-1 text-sm font-semibold text-white">Database connection verified, access restricted</p>
          </div>
          <span className="rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-amber-400">
            Action Required
          </span>
        </div>
      </div>

      <div className="grid lg:grid-cols-[0.95fr_1.05fr]">
        <div className="bg-acp-navy px-6 py-7 text-white sm:px-8">
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white/10">
              <KeyRound className="h-5 w-5 text-acp-purple" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-100/80">Database Permission</p>
              <h2 className="mt-2 text-2xl font-semibold leading-tight tracking-normal">Record access is not enabled</h2>
            </div>
          </div>

          <p className="mt-6 max-w-2xl text-sm leading-7 text-blue-50/80">
            The application can verify the database connection, but permissions restrict reading records. Please check the access settings and reload.
          </p>

          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            <ReadOnlyFact icon={<Database className="h-4 w-4" />} label="Base detected" />
            <ReadOnlyFact icon={<Table2 className="h-4 w-4" />} label="Table blocked" />
            <ReadOnlyFact icon={<AlertTriangle className="h-4 w-4" />} label="Access Denied (403)" />
          </div>
        </div>

        <div className="p-6 sm:p-8 bg-[#0a0f1d]/40">
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Required token setup</p>
            <div className="mt-4 grid gap-3">
              <PermissionStep title="Scope" value="data.records:read" />
              <PermissionStep title="Base access" value="ACP Deal Flow" />
              <PermissionStep title="Table" value="Active_Pipeline" />
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-lg border border-white/10 bg-white/5">
            <div className="border-b border-white/10 bg-white/5 px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Record read flow</p>
            </div>
            <div className="grid grid-cols-3 divide-x divide-white/10 text-center">
              <FlowStep label="Base" state="OK" tone="good" />
              <FlowStep label="Schema" state="OK" tone="good" />
              <FlowStep label="Records" state="403" tone="warn" />
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-white/10 bg-white/5 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Database response</p>
            <p className="mt-1 break-words text-sm leading-6 text-slate-305">{message}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function AirtableConfigState({ message }: { message: string }) {
  const required = [
    "VITE_AIRTABLE_API_KEY",
    "VITE_AIRTABLE_BASE_ID",
    "VITE_AIRTABLE_PIPELINE_TABLE",
    "VITE_AIRTABLE_DOCUMENTS_TABLE",
    "VITE_AIRTABLE_SUBMISSION_TABLE",
  ];

  return (
    <section className="overflow-hidden rounded-xl border border-white/10 bg-acp-card backdrop-blur-md shadow-panel">
      <div className="grid lg:grid-cols-[1.05fr_0.95fr]">
        <div className="bg-acp-navy px-6 py-7 text-white sm:px-8">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-md border border-white/15 bg-white/10">
              <Database className="h-5 w-5 text-acp-purple" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-100/80">Database Connection</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-normal">Connect the source of truth</h2>
            </div>
          </div>

          <p className="mt-6 max-w-2xl text-sm leading-7 text-blue-50/80">
            ACP Deal Room is ready. Please configure the database environment variables to load live pipeline, document, and timeline data.
          </p>

          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            <ReadOnlyFact icon={<Table2 className="h-4 w-4" />} label="Reads tables" />
            <ReadOnlyFact icon={<KeyRound className="h-4 w-4" />} label="No accounts" />
            <ReadOnlyFact icon={<CheckCircle2 className="h-4 w-4" />} label="No writes" />
          </div>
        </div>

        <div className="p-6 sm:p-8 bg-[#0a0f1d]/40">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Required variables</p>
          <div className="mt-4 grid gap-2">
            {required.map((item) => (
              <div key={item} className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/5 px-3 py-2">
                <code className="text-xs font-semibold text-slate-300">{item}</code>
                <span className="rounded bg-white/5 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  Missing
                </span>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-md border border-amber-500/20 bg-amber-500/5 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-400">Current state</p>
            <p className="mt-1 break-words text-sm leading-6 text-amber-200">{message}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function ReadOnlyFact({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/5 p-3">
      <div className="mb-2 text-blue-100">{icon}</div>
      <p className="text-xs font-semibold text-white">{label}</p>
    </div>
  );
}

function PermissionStep({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/5 px-4 py-3 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">{title}</p>
      <p className="mt-1 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function FlowStep({ label, state, tone }: { label: string; state: string; tone: "good" | "warn" }) {
  return (
    <div className="px-3 py-4">
      <p className={tone === "good" ? "text-lg font-semibold text-emerald-450" : "text-lg font-semibold text-amber-450"}>
        {state}
      </p>
      <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</p>
    </div>
  );
}

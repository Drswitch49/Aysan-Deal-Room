import { Landmark, MapPin, TrendingUp, HelpCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { PipelineDeal } from "../../types/deal";
import { redactCapitalStructureForLender } from "../../utils/security";
import { Table, Td, Th } from "../ui/Table";
import { cx } from "../../utils/cx";

type CoverSheetProps = {
  deal: PipelineDeal;
  audience: "internal" | "lender";
};

// Colors for visual debt stack segment colors
const STACK_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  "Senior Debt": { bg: "bg-acp-blue", text: "text-acp-blue", dot: "bg-acp-blue" },
  "Subordinated Debt": { bg: "bg-indigo-500", text: "text-indigo-600", dot: "bg-indigo-500" },
  "Equity": { bg: "bg-acp-purple", text: "text-acp-purple-dark", dot: "bg-acp-purple" },
  "Seller Note": { bg: "bg-rose-500", text: "text-rose-600", dot: "bg-rose-500" },
};

function parseAmount(amountStr: string): number {
  if (!amountStr) return 0;
  // Strip non-numeric chars except decimals
  const cleaned = amountStr.replace(/[^0-9.]/g, "");
  return parseFloat(cleaned) || 0;
}

export function CoverSheet({ deal, audience }: CoverSheetProps) {
  const capitalStructure =
    audience === "lender" ? redactCapitalStructureForLender(deal.capitalStructure) : deal.capitalStructure;

  // Calculate proportional data for visual stack
  const stackWithValues = capitalStructure.map(row => ({
    ...row,
    parsedVal: parseAmount(row.amount),
  }));
  const totalStackVal = stackWithValues.reduce((sum, item) => sum + item.parsedVal, 0);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.15fr]">
      {/* Company card */}
      <section className="rounded-2xl border border-white/[0.06] bg-[#0d0c1d] backdrop-blur-md p-6 shadow-premium-card hover:border-white/15 card-sheen transition-all duration-300">
        <SectionTitle icon={<MapPin className="h-5 w-5" />} title="Company Details" />
        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          <Field label="Company Name" value={deal.companyName} emphasis />
          <Field label="Location" value={deal.location} />
          <Field label="Sector / Industry" value={deal.sector} />
          {audience === "internal" ? <Field label="Sponsoring Broker" value={deal.broker} /> : null}
        </dl>
      </section>

      {/* Transaction card */}
      <section className="rounded-2xl border border-white/[0.06] bg-[#0d0c1d] backdrop-blur-md p-6 shadow-premium-card hover:border-white/15 card-sheen transition-all duration-300">
        <SectionTitle icon={<TrendingUp className="h-5 w-5" />} title="Transaction Overview" />
        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          <Field label="Enterprise Value (EV)" value={deal.ev} emphasis />
          <Field label="DSCR Base" value={deal.dscrBase} />
          <Field label="DSCR Stress" value={deal.dscrStress} />
          {audience === "internal" ? <Field label="Vendor Names" value={deal.vendorNames} /> : null}
          <Field label="Post-Completion Roles" value={deal.postCompletionRoles} className="sm:col-span-2" />
          {audience === "internal" ? <Field label="ACP Lead Executive" value={deal.lenderAssigned} className="sm:col-span-2" /> : null}
        </dl>
      </section>

      {/* Capital Structure */}
      <section className="lg:col-span-2 space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <SectionTitle icon={<Landmark className="h-5 w-5" />} title="Funding & Capital Structure" />
          {audience === "lender" && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 border border-white/10 px-3 py-1 text-[10px] font-bold text-slate-400">
              <HelpCircle className="h-3 w-3" /> Note: Proportions shown, exact amounts hidden for confidentiality
            </span>
          )}
        </div>

        {/* Visual Stack Chart */}
        {capitalStructure.length > 0 && totalStackVal > 0 ? (
          <div className="rounded-2xl border border-white/[0.06] bg-[#0d0c1d] backdrop-blur-md p-6 shadow-premium-card card-sheen">
            <h3 className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-slate-400 mb-4">Funding breakdown</h3>
            <div className="h-4 w-full flex rounded-full overflow-hidden bg-white/5 border border-white/[0.06] shadow-inner">
              {stackWithValues.map((row) => {
                const percentage = totalStackVal > 0 ? (row.parsedVal / totalStackVal) * 100 : 0;
                if (percentage === 0) return null;
                const colors = STACK_COLORS[row.label] || { bg: "bg-slate-400", text: "text-slate-400", dot: "bg-slate-400" };
                
                return (
                  <div
                    key={row.label}
                    className={`${colors.bg} h-full transition-all duration-500 relative group`}
                    style={{ width: `${percentage}%` }}
                    title={`${row.label}: ${row.amount} (${Math.round(percentage)}%)`}
                  >
                    <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                );
              })}
            </div>
            
            {/* Visual Stack Legend */}
            <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4">
              {stackWithValues.map((row) => {
                const percentage = totalStackVal > 0 ? (row.parsedVal / totalStackVal) * 100 : 0;
                const colors = STACK_COLORS[row.label] || { bg: "bg-slate-400", text: "text-slate-400", dot: "bg-slate-400" };
                return (
                  <div key={row.label} className="flex items-start gap-2.5 p-3 rounded-xl bg-white/5 border border-white/[0.06] hover:bg-white/[0.08] hover:border-white/20 transition-all duration-300">
                    <span className={`h-2.5 w-2.5 rounded-full ${colors.dot} mt-1`} />
                    <div className="min-w-0">
                      <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">{row.label}</p>
                      <p className="mt-0.5 text-xs font-extrabold text-white">
                        {audience === "lender" ? "Redacted" : row.amount || "Not specified"}
                      </p>
                      {row.provider && (
                        <p className="text-[10px] text-slate-400 font-bold mt-0.5 truncate" title={row.provider}>
                          {row.provider}
                        </p>
                      )}
                      {percentage > 0 && (
                        <p className={`text-[9px] font-extrabold ${colors.text} uppercase tracking-wider mt-1`}>{Math.round(percentage)}% of stack</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {capitalStructure.length > 0 ? (
          <Table>
            <thead>
              <tr className="border-b border-white/5 bg-white/[0.01]">
                <Th>Leverage Layer</Th>
                <Th>Provider</Th>
                <Th>Amount</Th>
                {audience === "internal" ? <Th>Internal Notes</Th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 bg-white/[0.01]">
              {capitalStructure.map((row) => {
                const colors = STACK_COLORS[row.label] || { bg: "bg-slate-400", text: "text-slate-400", dot: "bg-slate-400" };
                return (
                  <tr key={row.label} className="transition hover:bg-white/[0.02]">
                    <Td className="font-semibold text-white">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${colors.dot}`} />
                        <span className="text-sm font-semibold">{row.label}</span>
                      </div>
                    </Td>
                    <Td>
                      <span className="font-medium text-slate-300">{row.provider || "Not specified"}</span>
                    </Td>
                    <Td>
                      <span className="font-bold text-white">{row.amount || "Not specified"}</span>
                    </Td>
                    {audience === "internal" ? (
                      <Td className="text-slate-450 font-medium max-w-xs">{row.notes || "None"}</Td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-8 text-center text-sm text-slate-400 shadow-soft">
            No capital structure data is available for this deal.
          </div>
        )}
      </section>
    </div>
  );
}

function SectionTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 border border-white/[0.06] text-acp-purple shadow-sm">
        {icon}
      </span>
      <h2 className="text-sm font-bold uppercase tracking-wider text-white">{title}</h2>
    </div>
  );
}

function Field({ label, value, emphasis = false, className = "" }: { label: string; value: string; emphasis?: boolean; className?: string }) {
  return (
    <div className={cx("rounded-xl border border-white/[0.04] bg-white/[0.01] px-4 py-3.5 hover:bg-white/[0.04] hover:border-white/[0.08] transition-colors", className)}>
      <dt className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-400">{label}</dt>
      <dd className={cx("mt-1.5 text-xs font-semibold leading-relaxed", emphasis ? "text-white font-bold" : "text-slate-300")}>
        {value || "Not specified"}
      </dd>
    </div>
  );
}

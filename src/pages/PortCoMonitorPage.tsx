import { useState } from "react";
import { 
  AlertCircle, Plus, MoreVertical, ShieldAlert, CheckCircle2, ChevronLeft, ChevronRight 
} from "lucide-react";
import { cx } from "../utils/cx";
import { HeaderMetrics } from "../components/ui/HeaderMetrics";

export function PortCoMonitorPage() {
  const [activeSlide, setActiveSlide] = useState(0);

  // Preview PortCo metrics
  const portCoPreview = {
    companyName: "Clear Water Cleaning Services Ltd",
    statusBadge: "DSCR Green",
    statusColor: "green",
    metaText: "Acquired ( TBC ) · Commercial Cleaning · Kent · 11.5% platform",
    metrics: [
      {
        label: "REVENUE MTD",
        value: "£148k",
        subtext: "+4% vs target",
        subtextColor: "green"
      },
      {
        label: "EBITDA MTD",
        value: "£16k",
        subtext: "-3% vs target",
        subtextColor: "red"
      },
      {
        label: "DSCR ACTUAL",
        value: "1.41x",
        subtext: "Green Tier",
        subtextColor: "green"
      },
      {
        label: "HEADCOUNT",
        value: "14",
        subtext: "No change",
        subtextColor: "grey"
      },
      {
        label: "DEBTOR DAYS",
        value: "32 days",
        subtext: "Target < 30 days",
        subtextColor: "amber"
      },
      {
        label: "TOP CLIENT CONCENTRATION",
        value: "31%",
        subtext: "Review: > 25%",
        subtextColor: "red"
      },
      {
        label: "VLN DEPLOYMENT",
        value: "On track",
        subtext: "Month 0 of 36",
        subtextColor: "grey"
      }
    ]
  };

  return (
    <div className="space-y-6 text-[#E2E8F0] font-sans">
      {/* Title block with badges */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-4">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-white tracking-tight">
            PortCo <span className="text-[#C5A059]">Monitor</span>
          </h1>
          <p className="text-xs text-slate-550 font-medium">
            No live portfolio companies — activates on first close
          </p>
        </div>
        
        <div className="flex items-center gap-2 select-none">
          <HeaderMetrics />
          
          <div className="flex items-center gap-1">
            <button
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-300 shadow-sm hover:bg-white/10 hover:text-white cursor-pointer transition"
            >
              <Plus className="h-3.5 w-3.5 -ml-0.5" />
              <span>New Deal</span>
            </button>
            <button
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer transition"
              title="More Options"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Warning alert banner */}
      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-start gap-3 text-amber-500 shadow-md">
        <AlertCircle className="h-4.5 w-4.5 shrink-0 mt-0.5 text-amber-500" />
        <p className="text-xs font-semibold leading-relaxed">
          No portfolio companies live yet. Dashboard activates on first close. <span className="font-extrabold text-amber-400">TargetC within 8 weeks.</span>
        </p>
      </div>

      {/* PORTFOLIO COMPANY VIEW — PREVIEW Title */}
      <div className="pt-2 select-none">
        <h3 className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-slate-500">
          Portfolio Company View — Preview
        </h3>
      </div>

      {/* Preview Card */}
      <div className="space-y-4">
        <div className="rounded-3xl border border-white/[0.06] bg-[#0E121A] p-6 sm:p-8 shadow-premium-card card-sheen relative overflow-hidden">
          {/* Top Sheen Ambient Gradient */}
          <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-bl from-emerald-500/5 to-transparent pointer-events-none blur-3xl" />
          
          <div className="relative z-10 space-y-8">
            {/* Card Header */}
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div className="space-y-1.5">
                <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                  {portCoPreview.companyName}
                </h2>
                <p className="text-xs text-slate-500 font-semibold">
                  {portCoPreview.metaText}
                </p>
              </div>

              <span className="inline-flex self-start items-center rounded-full bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-450 select-none">
                {portCoPreview.statusBadge}
              </span>
            </div>

            {/* Metrics Panel Grid */}
            <div className="space-y-4">
              {/* Row 1: MTD Financials & Health (4 Columns) */}
              <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                {portCoPreview.metrics.slice(0, 4).map((metric, idx) => (
                  <div 
                    key={idx} 
                    className="rounded-2xl border border-white/[0.04] bg-white/[0.01] p-4.5 space-y-1 select-none hover:border-white/10 transition-colors"
                  >
                    <p className="text-[9px] font-extrabold uppercase tracking-wider text-slate-550">
                      {metric.label}
                    </p>
                    <p className="text-2xl font-black text-white tracking-tight">
                      {metric.value}
                    </p>
                    <p className={cx(
                      "text-[10px] font-bold leading-none mt-1",
                      metric.subtextColor === "green" ? "text-emerald-450" :
                      metric.subtextColor === "red" ? "text-rose-500" :
                      metric.subtextColor === "amber" ? "text-amber-500" : "text-slate-500"
                    )}>
                      {metric.subtext}
                    </p>
                  </div>
                ))}
              </div>

              {/* Row 2: Secondary / Structural metrics (3 Columns) */}
              <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
                {portCoPreview.metrics.slice(4).map((metric, idx) => (
                  <div 
                    key={idx} 
                    className="rounded-2xl border border-white/[0.04] bg-white/[0.01] p-4.5 space-y-1 select-none hover:border-white/10 transition-colors"
                  >
                    <p className="text-[9px] font-extrabold uppercase tracking-wider text-slate-550">
                      {metric.label}
                    </p>
                    <p className="text-xl font-black text-white tracking-tight">
                      {metric.value}
                    </p>
                    <p className={cx(
                      "text-[10px] font-bold leading-none mt-1",
                      metric.subtextColor === "green" ? "text-emerald-450" :
                      metric.subtextColor === "red" ? "text-rose-500" :
                      metric.subtextColor === "amber" ? "text-amber-500" : "text-slate-500"
                    )}>
                      {metric.subtext}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Carousel indicators dots */}
        <div className="flex items-center justify-center gap-1.5 pt-2 select-none">
          <span 
            className="h-1.5 w-1.5 rounded-full bg-[#C5A059] cursor-pointer transition-all"
            onClick={() => setActiveSlide(0)} 
          />
          <span 
            className="h-1.5 w-1.5 rounded-full bg-slate-700 hover:bg-slate-500 cursor-pointer transition-all"
            onClick={() => setActiveSlide(1)} 
          />
          <span 
            className="h-1.5 w-1.5 rounded-full bg-slate-700 hover:bg-slate-500 cursor-pointer transition-all"
            onClick={() => setActiveSlide(2)} 
          />
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect, useMemo } from "react";
import {
  AlertCircle,
  ShieldAlert,
  CheckCircle2,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Activity,
  AlertTriangle,
  Heart,
  ClipboardCheck,
  Building2,
  MapPin,
  Sparkles,
  Plus,
} from "lucide-react";
import { cx } from "../utils/cx";
import { fetchPortfolioData, triggerPortfolioAnalysis, getJobStatus } from "../api/admin";
import { StatCard } from "../components/ui/StatCard";
import { Modal } from "../components/ui/Modal";
import { FormField, inputClass, selectClass, textareaClass } from "../components/ui/FormField";
import type { PortfolioMetricRecord, PortfolioAlertRecord, PortfolioHealthRecord } from "../../lib/portfolio/db";

// ─── Inline Premium Sparkline ──────────────────────────────────────────────────
function Sparkline({
  data,
  width = 120,
  height = 36,
  strokeColor = "#3B82F6",
}: {
  data: number[];
  width?: number;
  height?: number;
  strokeColor?: string;
}) {
  if (!data || data.length < 2) {
    return <span className="text-[10px] text-slate-500 font-semibold select-none">Flat line</span>;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min === 0 ? 1 : max - min;
  const padding = 2;

  const pointsArray = data.map((val, index) => {
    const x = (index / (data.length - 1)) * (width - padding * 2) + padding;
    const y = height - (((val - min) / range) * (height - padding * 2) + padding);
    return { x, y };
  });

  const pointsStr = pointsArray.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const lastPoint = pointsArray[pointsArray.length - 1];

  return (
    <div className="flex items-center">
      <svg width={width} height={height} className="overflow-visible">
        <defs>
          <linearGradient id={`grad-${strokeColor.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity="0.15" />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d={`M ${pointsArray[0].x.toFixed(1)} ${height} L ${pointsStr} L ${lastPoint.x.toFixed(1)} ${height} Z`}
          fill={`url(#grad-${strokeColor.replace("#", "")})`}
        />
        <polyline
          fill="none"
          stroke={strokeColor}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={pointsStr}
        />
        <circle
          cx={lastPoint.x.toFixed(1)}
          cy={lastPoint.y.toFixed(1)}
          r="3"
          fill={strokeColor}
          stroke="#161B22"
          strokeWidth="1.5"
        />
      </svg>
    </div>
  );
}

// ─── Inline Health Gauge ──────────────────────────────────────────────────────
function HealthGauge({ score }: { score: number }) {
  const radius = 32;
  const stroke = 5;
  const normalizedRadius = radius - stroke * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  let color = "stroke-emerald-500";
  if (score < 60) color = "stroke-rose-500";
  else if (score < 80) color = "stroke-amber-500";

  return (
    <div className="relative flex items-center justify-center select-none">
      <svg height={radius * 2} width={radius * 2}>
        <circle
          className="stroke-white/10"
          fill="transparent"
          strokeWidth={stroke}
          r={normalizedRadius}
          cx={radius}
          cy={radius}
        />
        <circle
          className={cx("transition-all duration-500 ease-out", color)}
          fill="transparent"
          strokeWidth={stroke}
          strokeDasharray={circumference + " " + circumference}
          style={{ strokeDashoffset }}
          strokeLinecap="round"
          r={normalizedRadius}
          cx={radius}
          cy={radius}
          transform={`rotate(-90 ${radius} ${radius})`}
        />
      </svg>
      <span className="absolute text-xs font-black text-white">{score}</span>
    </div>
  );
}

interface PortfolioCompanyRecord {
  id: string;
  companyName: string;
  industry: string;
  location: string;
  status: string;
  revenue: number;
  ebitda: number;
  debt: number;
  headcount: number;
  cash: number;
  currentRatio: number;
  dscr: number;
  operationalKpis: string;
  documentActivity: string;
  notes: string;
  createdAt: string;
}

export function PortCoMonitorPage() {
  const [metrics, setMetrics] = useState<PortfolioMetricRecord[]>([]);
  const [alerts, setAlerts] = useState<PortfolioAlertRecord[]>([]);
  const [healths, setHealths] = useState<PortfolioHealthRecord[]>([]);
  const [companies, setCompanies] = useState<PortfolioCompanyRecord[]>([]);
  const [summaryBriefing, setSummaryBriefing] = useState<string>("");
  const [healthIndex, setHealthIndex] = useState<number>(100);

  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processStatusText, setProcessStatusText] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const [isLocalFallbackActive, setIsLocalFallbackActive] = useState(false);

  // Search, Filters & Sorting States
  const [searchQuery, setSearchQuery] = useState("");
  const [riskFilter, setRiskFilter] = useState("All");
  const [sectorFilter, setSectorFilter] = useState("All");
  const [sortBy, setSortBy] = useState("health_desc");
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});

  const toggleCardExpansion = (id: string) => {
    setExpandedCards((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Add Portfolio Company modal states
  const [isAddCompanyOpen, setIsAddCompanyOpen] = useState(false);
  const [companyForm, setCompanyForm] = useState({
    companyName: "", industry: "", location: "", status: "Active" as string,
    revenue: "", ebitda: "", debt: "", headcount: "", notes: "",
    cash: "", currentRatio: "", dscr: "", operationalKpis: "", documentActivity: ""
  });
  const [isCompanySaving, setIsCompanySaving] = useState(false);
  const [companyError, setCompanyError] = useState("");

  // Edit Portfolio Company modal states
  const [isEditCompanyOpen, setIsEditCompanyOpen] = useState(false);
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
  const [editCompanyForm, setEditCompanyForm] = useState({
    companyName: "", industry: "", location: "", status: "Active" as string,
    revenue: "", ebitda: "", debt: "", headcount: "", notes: "",
    cash: "", currentRatio: "", dscr: "", operationalKpis: "", documentActivity: ""
  });
  const [isEditSaving, setIsEditSaving] = useState(false);
  const [editCompanyError, setEditCompanyError] = useState("");

  const openEditCompany = (comp: any) => {
    setEditingCompanyId(comp.companyId);
    setEditCompanyForm({
      companyName: comp.companyName || "",
      industry: comp.crud?.industry || comp.sector || "",
      location: comp.crud?.location || comp.location || "",
      status: comp.crud?.status || "Active",
      revenue: comp.crud?.revenue !== undefined ? String(comp.crud.revenue) : String(comp.latestMetric?.revenue || ""),
      ebitda: comp.crud?.ebitda !== undefined ? String(comp.crud.ebitda) : String(comp.latestMetric?.ebitda || ""),
      debt: comp.crud?.debt !== undefined ? String(comp.crud.debt) : "",
      headcount: comp.crud?.headcount !== undefined ? String(comp.crud.headcount) : String(comp.latestMetric?.headcount || ""),
      cash: comp.crud?.cash !== undefined ? String(comp.crud.cash) : "",
      currentRatio: comp.crud?.currentRatio !== undefined ? String(comp.crud.currentRatio) : "",
      dscr: comp.crud?.dscr !== undefined ? String(comp.crud.dscr) : String(comp.latestMetric?.dscr || ""),
      operationalKpis: comp.crud?.operationalKpis || "",
      documentActivity: comp.crud?.documentActivity || "",
      notes: comp.crud?.notes || comp.notes || ""
    });
    setEditCompanyError("");
    setIsEditCompanyOpen(true);
  };

  const handleEditCompanySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editCompanyForm.companyName.trim() || !editCompanyForm.industry.trim() || !editCompanyForm.location.trim()) {
      setEditCompanyError("Company Name, Industry and Location are required.");
      return;
    }
    setIsEditSaving(true);
    setEditCompanyError("");
    try {
      const resp = await fetch(`/api/portfolio-companies-crud?id=${editingCompanyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: editCompanyForm.companyName.trim(),
          industry: editCompanyForm.industry.trim(),
          location: editCompanyForm.location.trim(),
          status: editCompanyForm.status,
          revenue: editCompanyForm.revenue ? Number(editCompanyForm.revenue) : null,
          ebitda: editCompanyForm.ebitda ? Number(editCompanyForm.ebitda) : null,
          debt: editCompanyForm.debt ? Number(editCompanyForm.debt) : null,
          headcount: editCompanyForm.headcount ? Number(editCompanyForm.headcount) : null,
          cash: editCompanyForm.cash ? Number(editCompanyForm.cash) : null,
          currentRatio: editCompanyForm.currentRatio ? Number(editCompanyForm.currentRatio) : null,
          dscr: editCompanyForm.dscr ? Number(editCompanyForm.dscr) : null,
          operationalKpis: editCompanyForm.operationalKpis.trim() || null,
          documentActivity: editCompanyForm.documentActivity.trim() || null,
          notes: editCompanyForm.notes.trim() || null,
        }),
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({ error: `Server error (${resp.status})` }));
        throw new Error(errData.error || "Failed to update company");
      }
      setIsEditCompanyOpen(false);
      loadPortfolioData();
    } catch (err: any) {
      setEditCompanyError(err.message || "Failed to update portfolio company");
    } finally {
      setIsEditSaving(false);
    }
  };

  const handleAddCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyForm.companyName.trim() || !companyForm.industry.trim() || !companyForm.location.trim()) {
      setCompanyError("Company Name, Industry and Location are required.");
      return;
    }
    setIsCompanySaving(true);
    setCompanyError("");
    try {
      const resp = await fetch("/api/portfolio-companies-crud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: companyForm.companyName.trim(),
          industry: companyForm.industry.trim(),
          location: companyForm.location.trim(),
          status: companyForm.status,
          revenue: companyForm.revenue ? Number(companyForm.revenue) : undefined,
          ebitda: companyForm.ebitda ? Number(companyForm.ebitda) : undefined,
          debt: companyForm.debt ? Number(companyForm.debt) : undefined,
          headcount: companyForm.headcount ? Number(companyForm.headcount) : undefined,
          cash: companyForm.cash ? Number(companyForm.cash) : undefined,
          currentRatio: companyForm.currentRatio ? Number(companyForm.currentRatio) : undefined,
          dscr: companyForm.dscr ? Number(companyForm.dscr) : undefined,
          operationalKpis: companyForm.operationalKpis.trim() || undefined,
          documentActivity: companyForm.documentActivity.trim() || undefined,
          notes: companyForm.notes.trim() || undefined,
        }),
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({ error: `Server error (${resp.status})` }));
        throw new Error(errData.error || "Failed to create company");
      }

      setCompanyForm({
        companyName: "", industry: "", location: "", status: "Active",
        revenue: "", ebitda: "", debt: "", headcount: "", notes: "",
        cash: "", currentRatio: "", dscr: "", operationalKpis: "", documentActivity: ""
      });
      setIsAddCompanyOpen(false);
      loadPortfolioData();
    } catch (err: any) {
      setCompanyError(err.message || "Failed to create portfolio company");
    } finally {
      setIsCompanySaving(false);
    }
  };

  // Load portfolio data
  const loadPortfolioData = async () => {
    try {
      setErrorMessage("");
      const res = await fetchPortfolioData();
      if (res.success) {
        setMetrics(res.metrics || []);
        setAlerts(res.alerts || []);
        setHealths(res.healths || []);
        setCompanies(res.companies || []);
        setSummaryBriefing(res.summaryBriefing || "");
        setHealthIndex(res.healthIndex ?? 100);
        setIsLocalFallbackActive(!!res.isFallbackActive);
      }
    } catch (err: any) {
      console.error("Error fetching portfolio data:", err);
      setErrorMessage(err.message || "Failed to load portfolio statistics.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPortfolioData();
  }, []);

  // Poll status checker
  const pollStatus = (intervalId: any) => {
    getJobStatus("Portfolio_Health", "status")
      .then((statusRes) => {
        if (statusRes.isComplete) {
          clearInterval(intervalId);
          setIsProcessing(false);
          loadPortfolioData();
        } else if (statusRes.isFailed) {
          clearInterval(intervalId);
          setIsProcessing(false);
          setErrorMessage(statusRes.error || "Portfolio analysis background task failed.");
          loadPortfolioData();
        } else {
          setProcessStatusText("Analyzing historical trends & calculating health scores...");
        }
      })
      .catch((err) => {
        console.warn("Status polling error:", err);
      });
  };

  // Run portfolio analysis manually
  const handleRunAnalysis = async () => {
    if (isProcessing) return;
    try {
      setIsProcessing(true);
      setErrorMessage("");
      setProcessStatusText("Queueing analysis task...");
      
      const triggerRes = await triggerPortfolioAnalysis();
      if (triggerRes.success) {
        // Start polling immediately every 2 seconds
        const id = setInterval(() => pollStatus(id), 2000);
        pollStatus(id);
      }
    } catch (err: any) {
      console.error("Failed to run analysis:", err);
      setErrorMessage(err.message || "Failed to queue analysis task.");
      setIsProcessing(false);
    }
  };

  // Unique portfolio companies — merged from BOTH analytics (health records) AND CRUD-created companies
  const portfolioCompanies = useMemo(() => {
    const map = new Map<string, any>();
    // 1. Add companies from health analytics pipeline
    healths.forEach((h) => {
      map.set(h.companyId, { companyId: h.companyId, companyName: h.companyName });
    });
    // 2. Merge CRUD-created companies (Portfolio_Companies table)
    companies.forEach((c) => {
      if (!map.has(c.id)) {
        map.set(c.id, { ...c, companyId: c.id });
      }
    });
    return Array.from(map.values());
  }, [healths, companies]);

  // Unique sectors from metrics
  const uniqueSectors = useMemo(() => {
    const list = new Set<string>();
    metrics.forEach((m) => {
      const type = m.recurringRevenue ? "SaaS" : "Services";
      list.add(type);
    });
    return ["All", ...Array.from(list)];
  }, [metrics]);

  // Filter & Search & Sort pipeline companies
  const filteredAndSortedCompanies = useMemo(() => {
    const enriched = portfolioCompanies.map((comp) => {
      const crudComp = companies.find((c) => c.id === comp.companyId);

      const health = healths.find((h) => h.companyId === comp.companyId) || {
        portfolioScore: 100,
        riskLevel: "low" as const,
        trendSummary: "New company added. Stable parameters.",
        activeAlerts: 0,
        updatedAt: new Date().toISOString(),
      };

      const compMetrics = metrics
        .filter((m) => m.companyId === comp.companyId)
        .sort((a, b) => a.reportingPeriod.localeCompare(b.reportingPeriod));

      let latestMetric = compMetrics[compMetrics.length - 1];
      if (!latestMetric && crudComp) {
        latestMetric = {
          companyId: crudComp.id,
          companyName: crudComp.companyName,
          reportingPeriod: "New",
          revenue: crudComp.revenue || 0,
          ebitda: crudComp.ebitda || 0,
          dscr: crudComp.dscr || 0,
          leverage: crudComp.ebitda ? Number((crudComp.debt / crudComp.ebitda).toFixed(2)) : 0,
          headcount: crudComp.headcount || 0,
          churnRate: 0,
          recurringRevenue: 0,
        };
      } else if (!latestMetric) {
        latestMetric = {
          companyId: comp.companyId,
          companyName: comp.companyName,
          reportingPeriod: "",
          revenue: 0,
          ebitda: 0,
          dscr: 0,
          leverage: 0,
          headcount: 0,
          churnRate: 0,
          recurringRevenue: 0,
        };
      }

      const sector = latestMetric.recurringRevenue ? "SaaS" : "Services";

      return {
        ...comp,
        health,
        compMetrics,
        latestMetric,
        sector,
        crud: crudComp,
      };
    });

    // 1. Search Query filter
    let result = enriched;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (c) =>
          c.companyName.toLowerCase().includes(q) ||
          c.companyId.toLowerCase().includes(q)
      );
    }

    // 2. Risk filter
    if (riskFilter !== "All") {
      result = result.filter((c) => c.health.riskLevel.toLowerCase() === riskFilter.toLowerCase());
    }

    // 3. Sector filter
    if (sectorFilter !== "All") {
      result = result.filter((c) => c.sector.toLowerCase() === sectorFilter.toLowerCase());
    }

    // 4. Sorting
    result.sort((a, b) => {
      if (sortBy === "health_desc") {
        return b.health.portfolioScore - a.health.portfolioScore;
      }
      if (sortBy === "health_asc") {
        return a.health.portfolioScore - b.health.portfolioScore;
      }
      if (sortBy === "revenue_desc") {
        return (b.latestMetric.revenue || 0) - (a.latestMetric.revenue || 0);
      }
      if (sortBy === "ebitda_desc") {
        return (b.latestMetric.ebitda || 0) - (a.latestMetric.ebitda || 0);
      }
      if (sortBy === "name_asc") {
        return a.companyName.localeCompare(b.companyName);
      }
      return 0;
    });

    return result;
  }, [portfolioCompanies, healths, metrics, searchQuery, riskFilter, sectorFilter, sortBy]);

  // Total active alerts categorizations
  const activeAlerts = useMemo(() => {
    return alerts.filter((a) => !a.resolvedAt);
  }, [alerts]);

  const criticalAlertsCount = useMemo(() => {
    return activeAlerts.filter((a) => a.severity === "critical").length;
  }, [activeAlerts]);

  const mediumAlertsCount = useMemo(() => {
    return activeAlerts.filter((a) => a.severity === "medium").length;
  }, [activeAlerts]);

  // Reporting status description
  const reportingStatusText = useMemo(() => {
    const staleCount = activeAlerts.filter((a) => a.alertType === "reporting").length;
    if (staleCount === 0) return "All Reporting Active";
    return `${staleCount} Cadence Overdue`;
  }, [activeAlerts]);

  if (isLoading) {
    return (
      <div className="flex h-[400px] flex-col items-center justify-center space-y-4 text-slate-400">
        <RefreshCw className="h-8 w-8 animate-spin text-[#C6A66B]" />
        <p className="text-sm font-semibold tracking-wide">Loading portfolio intelligence feed...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-[#E2E8F0] font-sans">
      {/* Title Block & Control */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-4">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            PortCo <span className="text-[#C6A66B]">Intelligence Monitor</span>
            {isLocalFallbackActive && (
              <span className="inline-flex items-center rounded bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-500">
                Fallback Database
              </span>
            )}
          </h1>
          <p className="text-xs text-slate-400 font-semibold leading-relaxed">
            Live operational portfolio metrics aggregation, deterministic alerts, and AI reviews.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsAddCompanyOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/[0.02] bg-white/[0.02] px-3.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-white cursor-pointer transition"
            type="button"
          >
            <Plus className="h-3.5 w-3.5" /> Add Company
          </button>
          <button
            onClick={handleRunAnalysis}
            disabled={isProcessing}
            className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/[0.02] bg-[#C6A66B]/10 hover:bg-[#C6A66B]/20 px-4 text-xs font-extrabold uppercase tracking-wider text-[#C6A66B] shadow-sm cursor-pointer disabled:opacity-50 transition"
          >
            <RefreshCw className={cx("h-3.5 w-3.5", isProcessing && "animate-spin")} />
            <span>{isProcessing ? "Analyzing..." : "Run Portfolio Analysis"}</span>
          </button>
        </div>
      </div>

      {/* Global Errors / Processing States */}
      {errorMessage && (
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 flex items-start gap-3 text-rose-500 shadow-md">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5 text-rose-500" />
          <p className="text-xs font-semibold leading-relaxed">{errorMessage}</p>
        </div>
      )}

      {isProcessing && (
        <div className="rounded-3xl border border-white/[0.02] bg-[#161B22]/50 p-6 flex flex-col items-center justify-center text-center space-y-4 animate-pulse relative overflow-hidden backdrop-blur-sm">
          <RefreshCw className="h-7 w-7 animate-spin text-[#C6A66B]" />
          <div className="space-y-1">
            <p className="text-sm font-black text-white">{processStatusText}</p>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-extrabold">Inngest Worker Pipeline Active</p>
          </div>
        </div>
      )}

      {!isProcessing && (
        <>
          {/* Top KPI Cards Grid */}
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 select-none">
            {/* Health Index */}
            <div className="group block rounded-2xl p-6 select-none premium-card card-sheen flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-[9.5px] font-bold uppercase tracking-widest text-slate-400 group-hover:text-slate-350 transition-colors flex items-center gap-1.5">
                  <Heart className="h-3.5 w-3.5 text-rose-500 animate-pulse" />
                  Health Index
                </p>
                <div className="text-2xl font-semibold tracking-tight mt-1 text-white">
                  {healthIndex}%
                </div>
                <p className="text-[9.5px] font-semibold text-slate-500 mt-2 tracking-wide leading-none">
                  Portfolio-wide avg
                </p>
              </div>
              <div className="shrink-0 pt-0.5">
                <HealthGauge score={healthIndex} />
              </div>
            </div>

            {/* Total PortCos */}
            <StatCard
              label="Active PortCos"
              value={portfolioCompanies.length}
              subLabel="Under monitoring"
              icon={<Building2 className="h-4.5 w-4.5" />}
              tone="default"
            />

            {/* Active Alerts */}
            <StatCard
              label="Active Alerts"
              value={activeAlerts.length}
              subLabel={`${criticalAlertsCount} critical · ${mediumAlertsCount} medium`}
              icon={<AlertTriangle className="h-4.5 w-4.5" />}
              tone={activeAlerts.length > 0 ? "rose" : "emerald"}
            />

            {/* Reporting Status */}
            <StatCard
              label="Reporting Status"
              value={reportingStatusText}
              subLabel="Monthly metrics check"
              icon={<ClipboardCheck className="h-4.5 w-4.5" />}
              tone="default"
            />
          </div>

          {/* Claude Portfolio Briefing & Alert Center */}
          <div className="grid gap-6 grid-cols-1 lg:grid-cols-3">
            {/* Claude Summary Briefing */}
            <div className="lg:col-span-2 rounded-3xl border border-[#C6A66B]/20 bg-gradient-to-br from-[#161B22] to-[#121622] p-6 shadow-premium-card relative overflow-hidden flex flex-col justify-between">
              <div className="absolute top-0 right-0 w-64 h-64 bg-[#C6A66B]/5 blur-3xl pointer-events-none" />
              <div className="relative z-10 space-y-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4.5 w-4.5 text-[#C6A66B]" />
                  <h3 className="text-xs font-extrabold uppercase tracking-widest text-slate-350">
                    Claude AI Review & Briefing
                  </h3>
                </div>
                <div className="text-xs font-semibold leading-relaxed text-slate-300 space-y-3 whitespace-pre-line">
                  {summaryBriefing ? (
                    summaryBriefing
                  ) : (
                    <p className="text-slate-500 italic select-none">
                      No summary review generated. Trigger a manual portfolio analysis to request a new review briefing from Claude AI.
                    </p>
                  )}
                </div>
              </div>
              <div className="pt-4 border-t border-white/5 text-[9px] font-bold text-slate-500 uppercase tracking-widest relative z-10 flex items-center justify-between select-none">
                <span>Asset Management Committee</span>
                <span>Aysan Capital Partners</span>
              </div>
            </div>

            {/* Alert Center */}
            <div className="rounded-3xl border border-white/[0.02] bg-[#161B22] p-6 shadow-premium-card space-y-4 max-h-[350px] overflow-y-auto">
              <div className="flex items-center gap-2 pb-2 border-b border-white/5">
                <ShieldAlert className="h-4.5 w-4.5 text-rose-500" />
                <h3 className="text-xs font-extrabold uppercase tracking-widest text-white">
                  Alert Center
                </h3>
              </div>

              {activeAlerts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-500 space-y-2 select-none">
                  <CheckCircle2 className="h-8 w-8 text-emerald-500/40" />
                  <p className="text-[10px] uppercase tracking-wider font-extrabold">All covenants clear</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {activeAlerts.map((alert, idx) => (
                    <div
                       key={idx}
                       className={cx(
                        "rounded-xl border p-3.5 space-y-1 transition",
                        alert.severity === "critical"
                          ? "border-rose-500/20 bg-rose-500/5 hover:border-rose-500/35"
                          : "border-amber-500/20 bg-amber-500/5 hover:border-amber-500/35"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black text-white tracking-tight">
                          {alert.companyName}
                        </span>
                        <span
                          className={cx(
                            "text-[8px] font-extrabold uppercase tracking-widest px-1.5 py-0.5 rounded",
                            alert.severity === "critical"
                              ? "bg-rose-500/10 text-rose-400"
                              : "bg-amber-500/10 text-amber-400"
                          )}
                        >
                          {alert.severity}
                        </span>
                      </div>
                      <p className="text-[11px] font-semibold text-slate-300 leading-normal">
                        {alert.explanation}
                      </p>
                      <p className="text-[9px] text-slate-500 font-bold tracking-wider uppercase pt-1 select-none">
                        {new Date(alert.triggeredAt).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                        })}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Controls & Performance Cards Section */}
          <div className="space-y-6">
            <div className="border-b border-white/5 pb-2 select-none flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <h3 className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-slate-500">
                Portfolio Company Performance Cards
              </h3>
            </div>

            {/* Search & Filter Controls */}
            <div className="flex flex-col md:flex-row gap-3 items-center justify-between bg-white/[0.01] border border-white/[0.02] p-4 rounded-2xl select-none">
              <div className="relative w-full md:w-72">
                <span className="absolute inset-y-0 left-3 flex items-center text-slate-500">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </span>
                <input
                  type="text"
                  placeholder="Search PortCo..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-9 rounded-xl border border-white/[0.04] bg-[#0B0B0C] pl-9 pr-3 text-xs text-white placeholder-slate-500 outline-none focus:border-[#C6A66B] transition shadow-inner"
                />
              </div>

              <div className="flex flex-wrap gap-2.5 w-full md:w-auto">
                {/* Risk Filter */}
                <select
                  value={riskFilter}
                  onChange={(e) => setRiskFilter(e.target.value)}
                  className="h-9 rounded-xl border border-white/[0.04] bg-[#0B0B0C] px-3 text-xs text-slate-300 outline-none focus:border-[#C6A66B] transition cursor-pointer shadow-inner"
                >
                  <option value="All">All Risks</option>
                  <option value="low">Low Risk</option>
                  <option value="medium">Medium Risk</option>
                  <option value="high">High Risk</option>
                </select>

                {/* Sector Filter */}
                <select
                  value={sectorFilter}
                  onChange={(e) => setSectorFilter(e.target.value)}
                  className="h-9 rounded-xl border border-white/[0.04] bg-[#0B0B0C] px-3 text-xs text-slate-300 outline-none focus:border-[#C6A66B] transition cursor-pointer shadow-inner"
                >
                  {uniqueSectors.map((sec) => (
                    <option key={sec} value={sec}>
                      {sec === "All" ? "All Sectors" : sec}
                    </option>
                  ))}
                </select>

                {/* Sort options */}
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="h-9 rounded-xl border border-white/[0.04] bg-[#0B0B0C] px-3 text-xs text-slate-300 outline-none focus:border-[#C6A66B] transition cursor-pointer shadow-inner"
                >
                  <option value="health_desc">Sort: Health H-to-L</option>
                  <option value="health_asc">Sort: Health L-to-H</option>
                  <option value="revenue_desc">Sort: Revenue Size</option>
                  <option value="ebitda_desc">Sort: EBITDA Size</option>
                  <option value="name_asc">Sort: Alphabetical</option>
                </select>
              </div>
            </div>

            {/* Performance Cards List */}
            <div className="grid gap-6 grid-cols-1">
              {filteredAndSortedCompanies.map((comp) => {
                const isExpanded = !!expandedCards[comp.companyId];
                const health = comp.health;
                const latestMetric = comp.latestMetric;
                const revenues = comp.compMetrics.map((m: any) => m.revenue);
                const dscrs = comp.compMetrics.map((m: any) => m.dscr);

                return (
                  <div
                    key={comp.companyId}
                    className={cx(
                      "rounded-3xl border p-6 sm:p-8 shadow-premium-card relative overflow-hidden transition-all duration-300",
                      health.riskLevel === "high"
                        ? "border-rose-500/20 bg-gradient-to-br from-[#161B22] to-[#201517]"
                        : health.riskLevel === "medium"
                        ? "border-amber-500/20 bg-gradient-to-br from-[#161B22] to-[#201d15]"
                        : "border-white/[0.02] bg-[#161B22] card-sheen"
                    )}
                  >
                    <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-bl from-white/[0.01] to-transparent pointer-events-none blur-3xl" />

                    <div className="relative z-10 space-y-5">
                      {/* Card Header */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-4">
                        <div className="space-y-1.5">
                          <h2 className="text-lg sm:text-xl font-black text-white tracking-tight flex items-center gap-2">
                            {comp.companyName}
                          </h2>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-450 text-[10px] font-extrabold uppercase tracking-wide">
                            <span className="flex items-center gap-1">
                              <Building2 className="h-3 w-3 text-slate-500" />
                              {comp.sector}
                            </span>
                            <span className="text-white/10 select-none">|</span>
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3 text-slate-500" />
                              {comp.crud?.location || comp.location || "United Kingdom"}
                            </span>
                            <span className="text-white/10 select-none">|</span>
                            <span>Reporting Period: {latestMetric.reportingPeriod || "N/A"}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 select-none">
                          <button
                            type="button"
                            onClick={() => openEditCompany(comp)}
                            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl border border-white/[0.04] bg-white/[0.015] hover:bg-white/[0.03] text-[10px] font-extrabold uppercase tracking-wider text-slate-400 hover:text-white transition cursor-pointer"
                          >
                            Edit Company
                          </button>
                          <span
                            className={cx(
                              "inline-flex items-center rounded-full border px-3 py-0.5 text-[9px] font-black uppercase tracking-wider select-none",
                              health.riskLevel === "low"
                                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-450"
                                : health.riskLevel === "medium"
                                ? "bg-amber-500/10 border-amber-500/20 text-amber-450"
                                : "bg-rose-500/10 border-rose-500/20 text-rose-500"
                            )}
                          >
                            Score: {health.portfolioScore}/100 ({health.riskLevel} risk)
                          </span>
                        </div>
                      </div>

                      {/* Main Metrics Panels - 3 Core Covenants */}
                      <div className="grid gap-4 grid-cols-1 md:grid-cols-3 select-none">
                        {/* Revenue */}
                        <div className="rounded-2xl border border-white/[0.02] bg-white/[0.01] p-4.5 space-y-1 hover:border-white/[0.04] transition-colors">
                          <p className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500">
                            Revenue (MTD)
                          </p>
                          <p className="text-xl font-black text-white tracking-tight">
                            £{latestMetric.revenue ? (latestMetric.revenue / 1000).toFixed(0) + "k" : "—"}
                          </p>
                          <div className="pt-2 flex items-center justify-between gap-2">
                            <span className="text-[9px] font-bold text-slate-500">MoM Trend</span>
                            <Sparkline data={revenues} strokeColor="#3B82F6" />
                          </div>
                        </div>

                        {/* DSCR */}
                        <div className="rounded-2xl border border-white/[0.02] bg-white/[0.01] p-4.5 space-y-1 hover:border-white/[0.04] transition-colors">
                          <p className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500">
                            DSCR actual
                          </p>
                          <p className={cx(
                            "text-xl font-black tracking-tight",
                            latestMetric.dscr < 1.2 ? "text-rose-500" :
                            latestMetric.dscr < 1.3 ? "text-amber-500" : "text-white"
                          )}>
                            {latestMetric.dscr ? latestMetric.dscr.toFixed(2) + "x" : "—"}
                          </p>
                          <div className="pt-2 flex items-center justify-between gap-2">
                            <span className="text-[9px] font-bold text-slate-500">Trend</span>
                            <Sparkline data={dscrs} strokeColor="#C6A66B" />
                          </div>
                        </div>

                        {/* Leverage */}
                        <div className="rounded-2xl border border-white/[0.02] bg-white/[0.01] p-4.5 space-y-1 hover:border-white/[0.04] transition-colors">
                          <p className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500">
                            Leverage ratio
                          </p>
                          <p className={cx(
                            "text-xl font-black tracking-tight",
                            latestMetric.leverage > 4.5 ? "text-rose-500" :
                            latestMetric.leverage > 3.5 ? "text-amber-500" : "text-white"
                          )}>
                            {latestMetric.leverage ? latestMetric.leverage.toFixed(1) + "x" : "—"}
                          </p>
                          <p className="text-[10px] text-slate-500 font-bold uppercase pt-1">Target: &lt; 3.5x</p>
                        </div>
                      </div>

                      {/* Collapsible Detailed Metrics Drawer */}
                      {isExpanded && (
                        <div className="grid gap-4 grid-cols-1 md:grid-cols-3 pt-4 border-t border-white/5 animate-fade-in-up">
                          {/* EBITDA */}
                          <div className="rounded-2xl border border-white/[0.02] bg-white/[0.005] p-4.5 space-y-1">
                            <p className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500">
                              EBITDA (MTD)
                            </p>
                            <p className="text-xl font-black text-white tracking-tight">
                              £{latestMetric.ebitda ? (latestMetric.ebitda / 1000).toFixed(1) + "k" : "—"}
                            </p>
                            <p className="text-[10px] text-slate-500 font-bold uppercase pt-1">
                              Margin: {latestMetric.revenue ? ((latestMetric.ebitda / latestMetric.revenue) * 100).toFixed(1) + "%" : "—"}
                            </p>
                          </div>

                          {/* Headcount */}
                          <div className="rounded-2xl border border-white/[0.02] bg-white/[0.005] p-4.5 space-y-1">
                            <p className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500">
                              Headcount
                            </p>
                            <p className="text-xl font-black text-white tracking-tight">
                              {latestMetric.headcount || "—"}
                            </p>
                            <p className="text-[10px] text-slate-500 font-bold uppercase pt-1">Full-time staff</p>
                          </div>

                          {/* Churn Rate */}
                          <div className="rounded-2xl border border-white/[0.02] bg-white/[0.005] p-4.5 space-y-1">
                            <p className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500">
                              Customer Churn
                            </p>
                            <p className={cx(
                              "text-xl font-black tracking-tight",
                              latestMetric.churnRate !== undefined && latestMetric.churnRate > 3.0 ? "text-rose-500" : "text-white"
                            )}>
                              {latestMetric.churnRate !== undefined ? latestMetric.churnRate.toFixed(1) + "%" : "0.0%"}
                            </p>
                            <p className="text-[10px] text-slate-550 font-semibold uppercase pt-1">Target: &lt; 1.5%</p>
                          </div>

                          {/* Cash */}
                          <div className="rounded-2xl border border-white/[0.02] bg-white/[0.005] p-4.5 space-y-1">
                            <p className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500">
                              Cash Reserves
                            </p>
                            <p className="text-xl font-black text-white tracking-tight">
                              £{comp.crud?.cash ? (comp.crud.cash / 1000).toFixed(0) + "k" : "—"}
                            </p>
                            <p className="text-[10px] text-slate-550 font-semibold uppercase pt-1">Available Liquidity</p>
                          </div>

                          {/* Current Ratio */}
                          <div className="rounded-2xl border border-white/[0.02] bg-white/[0.005] p-4.5 space-y-1">
                            <p className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500">
                              Current Ratio
                            </p>
                            <p className="text-xl font-black text-white tracking-tight">
                              {comp.crud?.currentRatio ? comp.crud.currentRatio.toFixed(2) + "x" : "—"}
                            </p>
                            <p className="text-[10px] text-slate-550 font-semibold uppercase pt-1">Target: &gt; 1.5x</p>
                          </div>

                          {/* DSCR (Crud) */}
                          <div className="rounded-2xl border border-white/[0.02] bg-white/[0.005] p-4.5 space-y-1">
                            <p className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500">
                              DSCR (Database)
                            </p>
                            <p className="text-xl font-black text-white tracking-tight">
                              {comp.crud?.dscr ? comp.crud.dscr.toFixed(2) + "x" : "—"}
                            </p>
                            <p className="text-[10px] text-slate-550 font-semibold uppercase pt-1">Target: &gt; 1.25x</p>
                          </div>

                          {/* Operational KPI Inputs */}
                          <div className="md:col-span-3 rounded-2xl border border-white/[0.02] bg-white/[0.005] p-4.5 space-y-1">
                            <p className="text-[9px] font-extrabold uppercase tracking-widest text-[#C6A66B]">
                              Operational KPI Inputs
                            </p>
                            <p className="text-xs text-slate-300 font-semibold leading-relaxed whitespace-pre-wrap mt-1">
                              {comp.crud?.operationalKpis || "No operational KPIs entered."}
                            </p>
                          </div>

                          {/* Document Activity Inputs */}
                          <div className="md:col-span-3 rounded-2xl border border-white/[0.02] bg-white/[0.005] p-4.5 space-y-1">
                            <p className="text-[9px] font-extrabold uppercase tracking-widest text-[#C6A66B]">
                              Document Activity Inputs
                            </p>
                            <p className="text-xs text-slate-300 font-semibold leading-relaxed whitespace-pre-wrap mt-1">
                              {comp.crud?.documentActivity || "No document activity inputs."}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Expand / Collapse Control Button */}
                      <button
                        onClick={() => toggleCardExpansion(comp.companyId)}
                        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-white/[0.02] bg-white/[0.005] hover:bg-white/[0.015] text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-white transition cursor-pointer select-none"
                      >
                        <span>{isExpanded ? "Collapse Parameters" : "View Operational Parameters"}</span>
                        <svg
                          className={cx("h-3 w-3 transform transition-transform duration-200", isExpanded && "rotate-180")}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      {/* Trend Summary Description text */}
                      <div className="rounded-2xl border border-white/[0.02] bg-white/[0.005] px-5 py-3.5 flex items-center justify-between text-xs font-semibold leading-relaxed text-slate-455 select-none">
                        <span className="flex items-center gap-2">
                          <Activity className="h-3.5 w-3.5 text-slate-500" />
                          <span>{health.trendSummary}</span>
                        </span>
                        {comp.compMetrics.length >= 4 && (
                          <div className="flex items-center gap-2 font-bold uppercase tracking-wider text-[9px]">
                            {comp.compMetrics[comp.compMetrics.length - 1].revenue >= comp.compMetrics[comp.compMetrics.length - 4].revenue ? (
                              <span className="text-emerald-450 flex items-center gap-0.5">
                                <TrendingUp className="h-3 w-3" />
                                QoQ Growth
                              </span>
                            ) : (
                              <span className="text-rose-500 flex items-center gap-0.5">
                                <TrendingDown className="h-3 w-3" />
                                QoQ Contraction
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {filteredAndSortedCompanies.length === 0 && (
                <div className="rounded-3xl border border-white/[0.02] bg-[#161B22] p-12 text-center text-xs font-semibold text-slate-550 select-none">
                  No portfolio companies found matching your filters.
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Add Portfolio Company Modal */}
      <Modal isOpen={isAddCompanyOpen} onClose={() => setIsAddCompanyOpen(false)} title="Add Portfolio Company" maxWidth="max-w-2xl">
        <form onSubmit={handleAddCompany} className="space-y-4 font-sans max-h-[75vh] overflow-y-auto pr-1">
          {companyError && (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-xs font-semibold text-rose-400 flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{companyError}
            </div>
          )}
          <div className="space-y-3">
            <p className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500">Company Information</p>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Company Name" id="pc-name" required>
                <input id="pc-name" type="text" required value={companyForm.companyName} onChange={e => setCompanyForm(f => ({...f, companyName: e.target.value}))} placeholder="e.g. Clear Water Services Ltd" className={inputClass} />
              </FormField>
              <FormField label="Industry" id="pc-industry" required>
                <input id="pc-industry" type="text" required value={companyForm.industry} onChange={e => setCompanyForm(f => ({...f, industry: e.target.value}))} placeholder="e.g. Facilities Management" className={inputClass} />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Location" id="pc-location" required>
                <input id="pc-location" type="text" required value={companyForm.location} onChange={e => setCompanyForm(f => ({...f, location: e.target.value}))} placeholder="e.g. London, UK" className={inputClass} />
              </FormField>
              <FormField label="Status" id="pc-status">
                <select id="pc-status" value={companyForm.status} onChange={e => setCompanyForm(f => ({...f, status: e.target.value}))} className={selectClass}>
                  <option value="Active">Active</option>
                  <option value="In Transition">In Transition</option>
                  <option value="Exited">Exited</option>
                </select>
              </FormField>
            </div>
          </div>
          <div className="space-y-3">
            <p className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500">Financials (£)</p>
            <div className="grid grid-cols-4 gap-3">
              <FormField label="Revenue" id="pc-revenue">
                <input id="pc-revenue" type="number" step="any" value={companyForm.revenue} onChange={e => setCompanyForm(f => ({...f, revenue: e.target.value}))} className={inputClass} />
              </FormField>
              <FormField label="EBITDA" id="pc-ebitda">
                <input id="pc-ebitda" type="number" step="any" value={companyForm.ebitda} onChange={e => setCompanyForm(f => ({...f, ebitda: e.target.value}))} className={inputClass} />
              </FormField>
              <FormField label="Debt" id="pc-debt">
                <input id="pc-debt" type="number" step="any" value={companyForm.debt} onChange={e => setCompanyForm(f => ({...f, debt: e.target.value}))} className={inputClass} />
              </FormField>
              <FormField label="Headcount" id="pc-headcount">
                <input id="pc-headcount" type="number" step="1" value={companyForm.headcount} onChange={e => setCompanyForm(f => ({...f, headcount: e.target.value}))} className={inputClass} />
              </FormField>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <FormField label="Cash" id="pc-cash">
                <input id="pc-cash" type="number" step="any" value={companyForm.cash} onChange={e => setCompanyForm(f => ({...f, cash: e.target.value}))} className={inputClass} />
              </FormField>
              <FormField label="Current Ratio" id="pc-currentRatio">
                <input id="pc-currentRatio" type="number" step="any" value={companyForm.currentRatio} onChange={e => setCompanyForm(f => ({...f, currentRatio: e.target.value}))} className={inputClass} />
              </FormField>
              <FormField label="DSCR" id="pc-dscr">
                <input id="pc-dscr" type="number" step="any" value={companyForm.dscr} onChange={e => setCompanyForm(f => ({...f, dscr: e.target.value}))} className={inputClass} />
              </FormField>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Operational KPI Inputs" id="pc-operationalKpis">
              <textarea id="pc-operationalKpis" value={companyForm.operationalKpis} onChange={e => setCompanyForm(f => ({...f, operationalKpis: e.target.value}))} rows={2} placeholder="e.g. Sales conversion 15%, customer retention 92%..." className={textareaClass} />
            </FormField>
            <FormField label="Document Activity Inputs" id="pc-documentActivity">
              <textarea id="pc-documentActivity" value={companyForm.documentActivity} onChange={e => setCompanyForm(f => ({...f, documentActivity: e.target.value}))} rows={2} placeholder="e.g. Financial model uploaded 12/06..." className={textareaClass} />
            </FormField>
          </div>
          <FormField label="Notes" id="pc-notes">
            <textarea id="pc-notes" value={companyForm.notes} onChange={e => setCompanyForm(f => ({...f, notes: e.target.value}))} rows={2} placeholder="Internal notes..." className={textareaClass} />
          </FormField>
          <div className="flex justify-end gap-2.5 pt-1">
            <button type="button" onClick={() => setIsAddCompanyOpen(false)} className="h-9 px-4 rounded-xl border border-white/[0.02] text-slate-405 text-xs font-bold uppercase tracking-wider hover:bg-white/[0.015] transition cursor-pointer">Cancel</button>
            <button type="submit" disabled={isCompanySaving} className="h-9 px-5 rounded-xl bg-gradient-to-r from-[#C6A66B] to-[#B8924F] text-slate-950 text-xs font-bold uppercase tracking-wider disabled:opacity-40 disabled:pointer-events-none hover:shadow-glow-bronze transition cursor-pointer">
              {isCompanySaving ? "Adding..." : "Add Company"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Portfolio Company Modal */}
      <Modal isOpen={isEditCompanyOpen} onClose={() => setIsEditCompanyOpen(false)} title="Edit Portfolio Company" maxWidth="max-w-2xl">
        <form onSubmit={handleEditCompanySubmit} className="space-y-4 font-sans max-h-[75vh] overflow-y-auto pr-1">
          {editCompanyError && (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-xs font-semibold text-rose-450 flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{editCompanyError}
            </div>
          )}
          <div className="space-y-3">
            <p className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500">Company Information</p>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Company Name" id="edit-pc-name" required>
                <input id="edit-pc-name" type="text" required value={editCompanyForm.companyName} onChange={e => setEditCompanyForm(f => ({...f, companyName: e.target.value}))} className={inputClass} />
              </FormField>
              <FormField label="Industry" id="edit-pc-industry" required>
                <input id="edit-pc-industry" type="text" required value={editCompanyForm.industry} onChange={e => setEditCompanyForm(f => ({...f, industry: e.target.value}))} className={inputClass} />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Location" id="edit-pc-location" required>
                <input id="edit-pc-location" type="text" required value={editCompanyForm.location} onChange={e => setEditCompanyForm(f => ({...f, location: e.target.value}))} className={inputClass} />
              </FormField>
              <FormField label="Status" id="edit-pc-status">
                <select id="edit-pc-status" value={editCompanyForm.status} onChange={e => setEditCompanyForm(f => ({...f, status: e.target.value}))} className={selectClass}>
                  <option value="Active">Active</option>
                  <option value="In Transition">In Transition</option>
                  <option value="Exited">Exited</option>
                </select>
              </FormField>
            </div>
          </div>
          <div className="space-y-3">
            <p className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500">Financials (£)</p>
            <div className="grid grid-cols-4 gap-3">
              <FormField label="Revenue" id="edit-pc-revenue">
                <input id="edit-pc-revenue" type="number" step="any" value={editCompanyForm.revenue} onChange={e => setEditCompanyForm(f => ({...f, revenue: e.target.value}))} className={inputClass} />
              </FormField>
              <FormField label="EBITDA" id="edit-pc-ebitda">
                <input id="edit-pc-ebitda" type="number" step="any" value={editCompanyForm.ebitda} onChange={e => setEditCompanyForm(f => ({...f, ebitda: e.target.value}))} className={inputClass} />
              </FormField>
              <FormField label="Debt" id="edit-pc-debt">
                <input id="edit-pc-debt" type="number" step="any" value={editCompanyForm.debt} onChange={e => setEditCompanyForm(f => ({...f, debt: e.target.value}))} className={inputClass} />
              </FormField>
              <FormField label="Headcount" id="edit-pc-headcount">
                <input id="edit-pc-headcount" type="number" step="1" value={editCompanyForm.headcount} onChange={e => setEditCompanyForm(f => ({...f, headcount: e.target.value}))} className={inputClass} />
              </FormField>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <FormField label="Cash" id="edit-pc-cash">
                <input id="edit-pc-cash" type="number" step="any" value={editCompanyForm.cash} onChange={e => setEditCompanyForm(f => ({...f, cash: e.target.value}))} className={inputClass} />
              </FormField>
              <FormField label="Current Ratio" id="edit-pc-currentRatio">
                <input id="edit-pc-currentRatio" type="number" step="any" value={editCompanyForm.currentRatio} onChange={e => setEditCompanyForm(f => ({...f, currentRatio: e.target.value}))} className={inputClass} />
              </FormField>
              <FormField label="DSCR" id="edit-pc-dscr">
                <input id="edit-pc-dscr" type="number" step="any" value={editCompanyForm.dscr} onChange={e => setEditCompanyForm(f => ({...f, dscr: e.target.value}))} className={inputClass} />
              </FormField>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Operational KPI Inputs" id="edit-pc-operationalKpis">
              <textarea id="edit-pc-operationalKpis" value={editCompanyForm.operationalKpis} onChange={e => setEditCompanyForm(f => ({...f, operationalKpis: e.target.value}))} rows={2} className={textareaClass} />
            </FormField>
            <FormField label="Document Activity Inputs" id="edit-pc-documentActivity">
              <textarea id="edit-pc-documentActivity" value={editCompanyForm.documentActivity} onChange={e => setEditCompanyForm(f => ({...f, documentActivity: e.target.value}))} rows={2} className={textareaClass} />
            </FormField>
          </div>
          <FormField label="Notes" id="edit-pc-notes">
            <textarea id="edit-pc-notes" value={editCompanyForm.notes} onChange={e => setEditCompanyForm(f => ({...f, notes: e.target.value}))} rows={2} className={textareaClass} />
          </FormField>
          <div className="flex justify-end gap-2.5 pt-1">
            <button type="button" onClick={() => setIsEditCompanyOpen(false)} className="h-9 px-4 rounded-xl border border-white/[0.02] text-slate-405 text-xs font-bold uppercase tracking-wider hover:bg-white/[0.015] transition cursor-pointer">Cancel</button>
            <button type="submit" disabled={isEditSaving} className="h-9 px-5 rounded-xl bg-gradient-to-r from-[#C6A66B] to-[#B8924F] text-slate-950 text-xs font-bold uppercase tracking-wider disabled:opacity-40 disabled:pointer-events-none hover:shadow-glow-bronze transition cursor-pointer">
              {isEditSaving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

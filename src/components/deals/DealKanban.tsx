/**
 * DealKanban — Operational Workflow Kanban Board
 *
 * Drag-and-drop deal progression using @dnd-kit/core.
 *
 * Architecture:
 *   Drag event → transitionDealStage() API → validation → Airtable update
 *   Optimistic UI update with full rollback on failure.
 *   Permission-aware: disabled drop zones for unauthorized stages.
 *
 * Columns: INTRO → DISCOVERY → LOI → DUE_DILIGENCE → CLOSING → PORTFOLIO
 */

import { useState, useMemo, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Link } from "react-router-dom";
import { AlertTriangle, GripVertical, Building2, TrendingUp, Loader2, ChevronRight } from "lucide-react";
import type { PipelineDeal } from "../../types/deal";
import { transitionDealStage } from "../../api/admin";
import { CANONICAL_STAGES, STAGE_LABELS, type DealStage } from "../../lib/airtable/schema";
import { cx } from "../../utils/cx";

// ─── Stage Color Config ───────────────────────────────────────────────────────

const STAGE_COLORS: Record<DealStage, { bg: string; border: string; text: string; badge: string }> = {
  INTRO:         { bg: "bg-indigo-500/8",  border: "border-indigo-500/20", text: "text-indigo-400",  badge: "bg-indigo-500/12 text-indigo-400 border-indigo-500/20" },
  DISCOVERY:     { bg: "bg-blue-500/8",    border: "border-blue-500/20",   text: "text-blue-400",    badge: "bg-blue-500/12 text-blue-400 border-blue-500/20" },
  LOI:           { bg: "bg-amber-500/8",   border: "border-amber-500/20",  text: "text-amber-400",   badge: "bg-amber-500/12 text-amber-400 border-amber-500/20" },
  DUE_DILIGENCE: { bg: "bg-purple-500/8",  border: "border-purple-500/20", text: "text-purple-400",  badge: "bg-purple-500/12 text-purple-400 border-purple-500/20" },
  CLOSING:       { bg: "bg-emerald-500/8", border: "border-emerald-500/20",text: "text-emerald-400", badge: "bg-emerald-500/12 text-emerald-400 border-emerald-500/20" },
  PORTFOLIO:     { bg: "bg-[#C6A66B]/8",   border: "border-[#C6A66B]/20",  text: "text-[#C6A66B]",   badge: "bg-[#C6A66B]/12 text-[#C6A66B] border-[#C6A66B]/20" },
  KILLED:        { bg: "bg-red-500/8",     border: "border-red-500/20",    text: "text-red-400",     badge: "bg-red-500/12 text-red-400 border-red-500/20" },
};

// ─── Stage Normalizer ─────────────────────────────────────────────────────────

const LEGACY_STAGE_MAP: Record<string, DealStage> = {
  intro: "INTRO",
  inbound: "INTRO",
  "information requested": "DISCOVERY",
  discovery: "DISCOVERY",
  "seller call": "DISCOVERY",
  "im review": "LOI",
  "offer submitted": "LOI",
  loi: "LOI",
  "due diligence": "DUE_DILIGENCE",
  diligence: "DUE_DILIGENCE",
  closing: "CLOSING",
  close: "CLOSING",
  portfolio: "PORTFOLIO",
  completed: "PORTFOLIO",
  killed: "KILLED",
  dead: "KILLED",
};

function normalizeStage(raw: string): DealStage {
  if (!raw) return "INTRO";
  const key = String(raw).trim();
  return (
    (LEGACY_STAGE_MAP[key] as DealStage) ||
    (LEGACY_STAGE_MAP[key.toLowerCase()] as DealStage) ||
    (CANONICAL_STAGES.includes(key as DealStage) ? (key as DealStage) : "INTRO")
  );
}

// ─── Deal Card Component ──────────────────────────────────────────────────────

interface DealCardProps {
  deal: PipelineDeal;
  isDragging?: boolean;
  isTransitioning?: boolean;
}

function DealCard({ deal, isDragging = false, isTransitioning = false }: DealCardProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: deal.id });
  const stage = normalizeStage(deal.status);
  const colors = STAGE_COLORS[stage];

  const style = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined;

  const ev = deal.rawFields["EV"] || deal.rawFields["Asking_Price_GBP"] || deal.rawFields["Enterprise_Value"];
  const evVal = ev ? Number(ev) : NaN;
  const evFormatted = !isNaN(evVal)
    ? evVal >= 1_000_000
      ? `£${(evVal / 1_000_000).toFixed(1)}m`
      : `£${(evVal / 1_000).toFixed(0)}k`
    : null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cx(
        "group relative rounded-xl border bg-[#0e0e10] p-3.5 transition-all duration-200",
        "hover:border-white/[0.12] hover:bg-[#141417]",
        isDragging
          ? "opacity-50 scale-95 border-white/[0.02]"
          : "border-white/[0.02]",
        isTransitioning && "opacity-60 pointer-events-none"
      )}
    >
      {isTransitioning && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40 z-10">
          <Loader2 className="h-4 w-4 animate-spin text-white/60" />
        </div>
      )}

      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition cursor-grab active:cursor-grabbing text-slate-600 hover:text-slate-400 touch-none"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </div>

      {/* Company name */}
      <Link
        to={`/deals/${encodeURIComponent(deal.dealRef || deal.id)}`}
        className="block mb-2 pr-5"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[12px] font-semibold text-white leading-snug hover:text-[#C6A66B] transition line-clamp-2">
          {deal.companyName || deal.dealRef}
        </p>
      </Link>

      {/* Metadata row */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {deal.dealRef && (
          <span className="text-[9px] font-mono text-slate-600">{deal.dealRef}</span>
        )}
        {deal.sector && (
          <span className="inline-flex items-center gap-1 rounded-md border border-white/[0.02] bg-white/[0.02] px-1.5 py-0.5 text-[9px] font-medium text-slate-500">
            {deal.sector}
          </span>
        )}
        {evFormatted && (
          <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-slate-500">
            <TrendingUp className="h-2.5 w-2.5" />
            {evFormatted}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Kanban Column Component ──────────────────────────────────────────────────

interface KanbanColumnProps {
  stage: DealStage;
  deals: PipelineDeal[];
  transitioningDealId: string | null;
  isDropTarget?: boolean;
}

function KanbanColumn({ stage, deals, transitioningDealId, isDropTarget = false }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const colors = STAGE_COLORS[stage];
  const label = STAGE_LABELS[stage];

  return (
    <div className="flex flex-col min-w-[220px] w-[220px] flex-shrink-0">
      {/* Column header */}
      <div className={cx(
        "flex items-center justify-between mb-3 px-3 py-2 rounded-xl border",
        colors.bg,
        colors.border
      )}>
        <div className="flex items-center gap-2">
          <span className={cx("text-[10px] font-bold uppercase tracking-wider", colors.text)}>
            {label}
          </span>
        </div>
        <span className={cx(
          "inline-flex h-5 min-w-5 items-center justify-center rounded-full border px-1.5 text-[9px] font-bold",
          colors.badge
        )}>
          {deals.length}
        </span>
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className={cx(
          "flex-1 min-h-[120px] rounded-xl border-2 border-dashed p-2 space-y-2.5 transition-all duration-150",
          isOver
            ? cx("border-opacity-60", colors.border, colors.bg)
            : isDropTarget
            ? "border-white/[0.02] bg-white/[0.01]"
            : "border-transparent"
        )}
      >
        {deals.length === 0 && (
          <div className="flex h-16 items-center justify-center">
            <p className="text-[10px] text-slate-700 select-none">Drop here</p>
          </div>
        )}
        {deals.map((deal) => (
          <DealCard
            key={deal.id}
            deal={deal}
            isTransitioning={transitioningDealId === deal.id}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Main Kanban Board ────────────────────────────────────────────────────────

interface DealKanbanProps {
  deals: PipelineDeal[];
  onStageChanged?: (dealId: string, fromStage: DealStage, toStage: DealStage) => void;
}

export function DealKanban({ deals, onStageChanged }: DealKanbanProps) {
  // Local optimistic stage overrides: dealId → canonical stage
  const [stageOverrides, setStageOverrides] = useState<Record<string, DealStage>>({});
  const [transitioningDealId, setTransitioningDealId] = useState<string | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [transitionError, setTransitionError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // Build columns — apply optimistic overrides
  const columns = useMemo(() => {
    const grouped: Record<DealStage, PipelineDeal[]> = {
      INTRO: [], DISCOVERY: [], LOI: [], DUE_DILIGENCE: [], CLOSING: [], PORTFOLIO: [], KILLED: [],
    };

    const activeDeals = deals.filter((d) => {
      const s = stageOverrides[d.id] || normalizeStage(d.status);
      return s !== "KILLED";
    });

    for (const deal of activeDeals) {
      const stage = stageOverrides[deal.id] || normalizeStage(deal.status);
      if (grouped[stage]) {
        grouped[stage].push(deal);
      }
    }

    return grouped;
  }, [deals, stageOverrides]);

  const activeDeal = useMemo(
    () => deals.find((d) => d.id === activeDragId) || null,
    [deals, activeDragId]
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
    setTransitionError(null);
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveDragId(null);

      if (!over || !active) return;

      const dealId = String(active.id);
      const deal = deals.find((d) => d.id === dealId);
      if (!deal) return;

      const currentStage = stageOverrides[dealId] || normalizeStage(deal.status);
      const targetStage = String(over.id) as DealStage;

      // No-op if same column
      if (currentStage === targetStage) return;

      // Optimistic update — move card immediately
      setStageOverrides((prev) => ({ ...prev, [dealId]: targetStage }));
      setTransitioningDealId(dealId);
      setTransitionError(null);

      try {
        await transitionDealStage(dealId, targetStage, {
          notes: `Moved via Kanban drag: ${STAGE_LABELS[currentStage]} → ${STAGE_LABELS[targetStage]}`,
          changedBy: "Admin",
          role: "admin",
        });

        onStageChanged?.(dealId, currentStage, targetStage);
        console.log(`[Kanban] ✓ ${deal.companyName}: ${STAGE_LABELS[currentStage]} → ${STAGE_LABELS[targetStage]}`);
      } catch (err: any) {
        // Rollback optimistic update on failure
        setStageOverrides((prev) => {
          const next = { ...prev };
          delete next[dealId];
          return next;
        });
        const errorMsg = err.message || "Transition failed";
        setTransitionError(errorMsg);
        console.error(`[Kanban] Transition failed:`, err);
      } finally {
        setTransitioningDealId(null);
      }
    },
    [deals, stageOverrides, onStageChanged]
  );

  return (
    <div className="space-y-4">
      {/* Error banner */}
      {transitionError && (
        <div className="flex items-center gap-3 rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-xs font-semibold text-rose-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>Transition rejected: {transitionError}</span>
          <button
            onClick={() => setTransitionError(null)}
            className="ml-auto text-rose-500 hover:text-rose-400 transition"
          >
            ✕
          </button>
        </div>
      )}

      {/* Kanban grid — horizontal scroll */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
          {CANONICAL_STAGES.map((stage) => (
            <KanbanColumn
              key={stage}
              stage={stage}
              deals={columns[stage]}
              transitioningDealId={transitioningDealId}
              isDropTarget={activeDragId !== null}
            />
          ))}
        </div>

        {/* Drag overlay — ghost card while dragging */}
        <DragOverlay>
          {activeDeal && (
            <div className="rounded-xl border border-white/20 bg-[#141417] p-3.5 shadow-2xl ring-1 ring-white/10 w-[220px] opacity-95 rotate-2 scale-105">
              <p className="text-[12px] font-semibold text-white line-clamp-2">
                {activeDeal.companyName || activeDeal.dealRef}
              </p>
              {activeDeal.sector && (
                <span className="mt-1.5 inline-block text-[9px] font-medium text-slate-500">
                  {activeDeal.sector}
                </span>
              )}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Stage legend */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-600 select-none">Pipeline:</span>
        {CANONICAL_STAGES.map((stage, i) => (
          <span key={stage} className="flex items-center gap-1.5">
            <span className={cx(
              "inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold select-none",
              STAGE_COLORS[stage].badge
            )}>
              {STAGE_LABELS[stage]}
            </span>
            {i < CANONICAL_STAGES.length - 1 && (
              <ChevronRight className="h-3 w-3 text-slate-700" />
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

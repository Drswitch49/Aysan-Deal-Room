/**
* Deal Lifecycle State Machine
*
* This is the canonical source of truth for all deal stage logic.
*
* Architecture:
*   moveDealToStage() is the ONLY valid mechanism for stage transitions.
*   All transitions are validated, permission-checked, audit-logged,
*   and event-emitted via Inngest.
*
* Stage mapping:
*   Legacy Airtable values are normalized to canonical stages on read/write.
*   Existing records are NOT rewritten — backward compatibility is preserved.
*
* Roles:
*   analyst  → INTRO, DISCOVERY
*   manager  → INTRO, DISCOVERY, LOI, DUE_DILIGENCE, KILLED
*   admin    → all stages
*/

import { airtableFetchRecord, airtableUpdate, airtableCreate } from "../_utils/airtable.js";
import { TABLES } from "../../src/lib/airtable/schema.js";
import { emitEvent } from "../_events/emit.js";

// ─── Canonical Stage Definitions ────────────────────────────────────────────

export type DealStage =
  | "INTRO"
  | "DISCOVERY"
  | "LOI"
  | "DUE_DILIGENCE"
  | "CLOSING"
  | "PORTFOLIO"
  | "KILLED";

export type UserRole = "analyst" | "manager" | "admin";

export const DEAL_STAGES: DealStage[] = [
  "INTRO",
  "DISCOVERY",
  "LOI",
  "DUE_DILIGENCE",
  "CLOSING",
  "PORTFOLIO",
];

export const KILLED_STAGE: DealStage = "KILLED";

// ─── Stage Configuration ─────────────────────────────────────────────────────

export interface StageConfig {
  label: string;
  description: string;
  color: string;        // Hex / CSS color for UI
  accentClass: string;  // Tailwind accent for badges
  order: number;        // 0-indexed sequential order
  terminal: boolean;    // No further transitions allowed
  allowedRoles: UserRole[];
}

export const STAGE_CONFIG: Record<DealStage, StageConfig> = {
  INTRO: {
    label: "Intro",
    description: "Initial deal introduction and high-level screening",
    color: "#6366f1",
    accentClass: "indigo",
    order: 0,
    terminal: false,
    allowedRoles: ["analyst", "manager", "admin"],
  },
  DISCOVERY: {
    label: "Discovery",
    description: "Active information gathering and preliminary analysis",
    color: "#3b82f6",
    accentClass: "blue",
    order: 1,
    terminal: false,
    allowedRoles: ["analyst", "manager", "admin"],
  },
  LOI: {
    label: "LOI",
    description: "Letter of Intent issued — deal terms under negotiation",
    color: "#f59e0b",
    accentClass: "amber",
    order: 2,
    terminal: false,
    allowedRoles: ["manager", "admin"],
  },
  DUE_DILIGENCE: {
    label: "Due Diligence",
    description: "Formal due diligence process underway",
    color: "#8b5cf6",
    accentClass: "purple",
    order: 3,
    terminal: false,
    allowedRoles: ["manager", "admin"],
  },
  CLOSING: {
    label: "Closing",
    description: "Completion mechanics and final documentation",
    color: "#10b981",
    accentClass: "emerald",
    order: 4,
    terminal: false,
    allowedRoles: ["admin"],
  },
  PORTFOLIO: {
    label: "Portfolio",
    description: "Deal closed — active portfolio company",
    color: "#c5a059",
    accentClass: "bronze",
    order: 5,
    terminal: true,
    allowedRoles: ["admin"],
  },
  KILLED: {
    label: "Killed",
    description: "Deal terminated — no further action",
    color: "#ef4444",
    accentClass: "red",
    order: -1,
    terminal: true,
    allowedRoles: ["manager", "admin"],
  },
};

// ─── Valid Transition Matrix ──────────────────────────────────────────────────
//
// Defines the exact set of legal state transitions.
// Any transition not listed here is INVALID and will be rejected.

export const VALID_TRANSITIONS: Record<DealStage, DealStage[]> = {
  INTRO: ["DISCOVERY", "KILLED"],
  DISCOVERY: ["INTRO", "LOI", "KILLED"],
  LOI: ["DISCOVERY", "DUE_DILIGENCE", "KILLED"],
  DUE_DILIGENCE: ["LOI", "CLOSING", "KILLED"],
  CLOSING: ["DUE_DILIGENCE", "PORTFOLIO", "KILLED"],
  PORTFOLIO: [],  // Terminal — no further transitions
  KILLED: [],  // Terminal — no further transitions
};

// ─── Legacy Stage Mapping ─────────────────────────────────────────────────────
//
// Maps historical Airtable string values → canonical DealStage.
// Non-destructive: existing records are never rewritten.
// All NEW writes use canonical stage values only.

const LEGACY_TO_CANONICAL: Record<string, DealStage> = {
  // Exact matches (case-insensitive)
  "intro": "INTRO",
  "inbound": "INTRO",
  "information requested": "DISCOVERY",
  "information_requested": "DISCOVERY",
  "discovery": "DISCOVERY",
  "seller call": "DISCOVERY",
  "seller_call": "DISCOVERY",
  "im review": "LOI",
  "im_review": "LOI",
  "offer submitted": "LOI",
  "offer_submitted": "LOI",
  "loi": "LOI",
  "due diligence": "DUE_DILIGENCE",
  "due_diligence": "DUE_DILIGENCE",
  "diligence": "DUE_DILIGENCE",
  "closing": "CLOSING",
  "close": "CLOSING",
  "portfolio": "PORTFOLIO",
  "completed": "PORTFOLIO",
  "closed": "PORTFOLIO",
  "killed": "KILLED",
  "dead": "KILLED",
  "terminated": "KILLED",
  "rejected": "KILLED",
  // Canonical passthrough
  "INTRO": "INTRO",
  "DISCOVERY": "DISCOVERY",
  "LOI": "LOI",
  "DUE_DILIGENCE": "DUE_DILIGENCE",
  "CLOSING": "CLOSING",
  "PORTFOLIO": "PORTFOLIO",
  "KILLED": "KILLED",
};

/**
 * Normalizes any legacy or canonical stage string to a DealStage.
 * Falls back to "INTRO" for unknown values (safe default).
 */
export function normalizeStage(raw: string | undefined | null): DealStage {
  if (!raw) return "INTRO";
  const key = String(raw).trim();
  return (
    LEGACY_TO_CANONICAL[key] ||
    LEGACY_TO_CANONICAL[key.toLowerCase()] ||
    "INTRO"
  );
}

/**
 * Returns the Airtable-safe string value to write for a canonical stage.
 * Uses the stage label (e.g. "Due Diligence") as the Airtable value for
 * human readability in the base view.
 */
export function stageToAirtableValue(stage: DealStage): string {
  return STAGE_CONFIG[stage].label;
}

// ─── Validation ───────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validates whether a stage transition is permitted for the given role.
 * Called before any state change.
 */
export function validateTransition(
  fromStage: DealStage,
  toStage: DealStage,
  role: UserRole
): ValidationResult {
  // Check transition is structurally valid
  const validNextStages = VALID_TRANSITIONS[fromStage];
  if (!validNextStages.includes(toStage)) {
    return {
      valid: false,
      reason: `Invalid transition: ${STAGE_CONFIG[fromStage].label} → ${STAGE_CONFIG[toStage].label}. ` +
        `Valid next stages from ${STAGE_CONFIG[fromStage].label}: ` +
        (validNextStages.length > 0
          ? validNextStages.map((s) => STAGE_CONFIG[s].label).join(", ")
          : "none (terminal stage)"),
    };
  }

  // Check role has permission to move deal into the target stage
  const allowedRoles = STAGE_CONFIG[toStage].allowedRoles;
  if (!allowedRoles.includes(role)) {
    return {
      valid: false,
      reason: `Insufficient permissions: role '${role}' cannot move deals into ${STAGE_CONFIG[toStage].label}. ` +
        `Requires: ${allowedRoles.join(" or ")}`,
    };
  }

  return { valid: true };
}

// ─── Transition Options + Result ─────────────────────────────────────────────

export interface TransitionOptions {
  /** Email or display name of the user performing the transition */
  changedBy: string;
  /** Role of the user performing the transition */
  role: UserRole;
  /** Optional contextual notes for the audit log */
  notes?: string;
}

export interface TransitionResult {
  success: true;
  dealId: string;
  dealRef: string;
  fromStage: DealStage;
  toStage: DealStage;
  auditId: string;
  changedBy: string;
  timestamp: string;
}

// ─── Core Engine: moveDealToStage ─────────────────────────────────────────────
//
// This is the ONLY valid mechanism for deal stage transitions.
// All transitions go through this function — no exceptions.

export async function moveDealToStage(
  dealId: string,
  toStage: DealStage,
  options: TransitionOptions
): Promise<TransitionResult> {
  const { changedBy, role, notes = "" } = options;
  const timestamp = new Date().toISOString();

  // ── 1. Fetch current deal state ────────────────────────────────────────────
  const dealRecord = await airtableFetchRecord(TABLES.PIPELINE, dealId);
  if (!dealRecord) {
    throw Object.assign(new Error(`Deal ${dealId} not found`), { status: 404 });
  }

  const fields = dealRecord.fields as Record<string, any>;
  const rawStage = fields["Stage"] || fields["Status"] || fields["Deal_Status"] || "";
  const dealRef = String(
    fields["REF No."] || fields["ACP REF NO"] || fields["Deal_Ref"] || fields["Deal Name"] || dealId
  );
  const companyName = String(fields["Deal Name"] || fields["Company_Name"] || fields["Company Name"] || "");

  const fromStage = normalizeStage(rawStage);

  // ── 2. Self-transition guard ───────────────────────────────────────────────
  if (fromStage === toStage) {
    throw Object.assign(
      new Error(`Deal is already in stage: ${STAGE_CONFIG[toStage].label}`),
      { status: 400 }
    );
  }

  // ── 3. Validate transition + permissions ──────────────────────────────────
  const validation = validateTransition(fromStage, toStage, role);
  if (!validation.valid) {
    throw Object.assign(new Error(validation.reason!), { status: 422 });
  }

  // ── 4. Update Active_Pipeline record ─────────────────────────────────────
  await airtableUpdate(TABLES.PIPELINE, dealId, {
    Stage: stageToAirtableValue(toStage),
    Stage_Updated_At: timestamp,
    Workflow_Stage: toStage, // Canonical machine-readable field
  });

  // ── 5. Create immutable audit record in Deal_Stage_History ────────────────
  let auditId = `audit-${Date.now()}`;
  try {
    const auditRecord = await airtableCreate(TABLES.STAGE_HISTORY, {
      Deal_ID: [dealId],
      Deal_Ref: dealRef,
      Company_Name: companyName,
      From_Stage: fromStage,
      To_Stage: toStage,
      From_Stage_Label: STAGE_CONFIG[fromStage].label,
      To_Stage_Label: STAGE_CONFIG[toStage].label,
      Changed_By: changedBy,
      Changed_By_Role: role,
      Changed_At: timestamp,
      Notes: notes,
      Transition_Valid: true,
    });
    auditId = auditRecord.id;
  } catch (err: any) {
    // Audit table may not exist yet — log warning but do NOT fail the transition
    console.warn(
      `[Deal Lifecycle] Deal_Stage_History table not found — audit record skipped: ${err.message}`
    );
    console.warn(
      `[Deal Lifecycle] Transition logged: ${dealRef} ${fromStage} → ${toStage} by ${changedBy} at ${timestamp}`
    );
  }

  // ── 6. Emit deal/stage_changed event for Inngest workflows ────────────────
  await emitEvent("deal/stage_changed", {
    dealId,
    dealRef,
    companyName,
    fromStage,
    toStage,
    changedBy,
    changedByRole: role,
    auditId,
    notes,
    timestamp,
  });

  console.log(
    `[Deal Lifecycle] ✓ ${dealRef} | ${STAGE_CONFIG[fromStage].label} → ${STAGE_CONFIG[toStage].label} | by ${changedBy} (${role})`
  );

  return {
    success: true,
    dealId,
    dealRef,
    fromStage,
    toStage,
    auditId,
    changedBy,
    timestamp,
  };
}

// ─── Utility: Get Stage History for a Deal ───────────────────────────────────

export interface StageHistoryEntry {
  id: string;
  dealId: string;
  dealRef: string;
  fromStage: DealStage;
  toStage: DealStage;
  fromStageLabel: string;
  toStageLabel: string;
  changedBy: string;
  changedByRole: string;
  changedAt: string;
  notes: string;
}

export async function getDealStageHistory(dealId: string): Promise<StageHistoryEntry[]> {
  const { airtableFetch } = await import("../_utils/airtable.js");
  const result = await airtableFetch(TABLES.STAGE_HISTORY, {
    filterByFormula: `FIND("${dealId}", {Deal_ID})`,
    sort: [{ field: "Changed_At", direction: "asc" }],
    maxRecords: 100,
  });

  const records = result?.records || [];
  return records.map((r: any) => ({
    id: r.id,
    dealId: Array.isArray(r.fields.Deal_ID) ? r.fields.Deal_ID[0] : (r.fields.Deal_ID || dealId),
    dealRef: r.fields.Deal_Ref || "",
    fromStage: (r.fields.From_Stage || "INTRO") as DealStage,
    toStage: (r.fields.To_Stage || "INTRO") as DealStage,
    fromStageLabel: r.fields.From_Stage_Label || r.fields.From_Stage || "",
    toStageLabel: r.fields.To_Stage_Label || r.fields.To_Stage || "",
    changedBy: r.fields.Changed_By || "System",
    changedByRole: r.fields.Changed_By_Role || "admin",
    changedAt: r.fields.Changed_At || r.createdTime || "",
    notes: r.fields.Notes || "",
  }));
}

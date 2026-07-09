/**
 * Deal Stage Transition API Endpoint
 *
 * POST /api/admin/deals/transition
 *
 * The centralized gateway for all deal stage changes.
 * This is the ONLY endpoint that should mutate deal stage.
 *
 * Body:
 *   dealId    — Airtable record ID of the deal
 *   toStage   — Target canonical stage (INTRO | DISCOVERY | LOI | ...)
 *   notes     — Optional context for the audit log
 *   role      — User role (defaults to "admin" until per-user auth ships)
 *   changedBy — Display name / email of the user (from session)
 *
 * Returns:
 *   201 — { success, dealId, dealRef, fromStage, toStage, auditId, timestamp }
 *   400 — { error } — missing params
 *   404 — { error } — deal not found
 *   422 — { error } — invalid transition or insufficient permissions
 *   500 — { error } — internal error
 */

import { authenticateAdmin } from "../lenders.js";
import {
  moveDealToStage,
  getDealStageHistory,
  validateTransition,
  normalizeStage,
  STAGE_CONFIG,
  DEAL_STAGES,
  type DealStage,
  type UserRole,
} from "../../_services/deal-lifecycle.js";
import { airtableFetch, airtableFetchRecord } from "../../_utils/airtable.js";
import { TABLES } from "../../../src/lib/airtable/schema.js";
import { logAuditTrail } from "../../_utils/audit.js";

export default async function handler(req: any, res: any) {
  try {
    await authenticateAdmin(req);
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // ── GET — fetch stage history for a deal ────────────────────────────────
  if (req.method === "GET") {
    const { dealId } = req.query;
    if (!dealId) {
      return res.status(400).json({ error: "dealId is required" });
    }

    try {
      const history = await getDealStageHistory(String(dealId));
      return res.status(200).json({ success: true, history });
    } catch (err: any) {
      return res.status(err.status || 500).json({ error: err.message });
    }
  }

  // ── POST — execute a stage transition ───────────────────────────────────
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    dealId,
    toStage,
    notes = "",
  } = req.body || {};

  // ── Validation ───────────────────────────────────────────────────────────
  if (!dealId) {
    return res.status(400).json({ error: "dealId is required" });
  }
  if (!toStage) {
    return res.status(400).json({ error: "toStage is required" });
  }

  const FALLBACK_STAGES = [
    "Intro",
    "NDA Signed",
    "Information Requested",
    "LOI Drafted",
    "LOI Submitted",
    "Killed",
    "Due Diligence",
    "IC Decision",
    "IM Review",
    "Seller Call",
    "Offer Submitted"
  ];

  const CANONICAL_TO_AIRTABLE: Record<string, string> = {
    "INTRO": "Intro",
    "DISCOVERY": "Seller Call",
    "LOI": "LOI Drafted",
    "DUE_DILIGENCE": "Due Diligence",
    "CLOSING": "Offer Submitted",
    "PORTFOLIO": "Offer Submitted",
    "KILLED": "Killed"
  };

  const cleanStageInput = toStage.toUpperCase();
  const targetName = CANONICAL_TO_AIRTABLE[cleanStageInput] || toStage;

  const matchedStage = FALLBACK_STAGES.find(s => s.toLowerCase() === targetName.toLowerCase());
  if (!matchedStage) {
    return res.status(400).json({
      error: `Invalid stage '${toStage}'. Valid stages: ${FALLBACK_STAGES.join(", ")}`,
    });
  }

  const userRole = req.user.role;
  const validRoles = ["analyst", "manager", "admin", "managing partner", "partner", "super admin", "owner"];
  const cleanRole = (userRole || "").toLowerCase();
  if (!validRoles.includes(cleanRole)) {
    return res.status(400).json({
      error: `Invalid role '${userRole}' in database permissions. Valid roles: ${validRoles.join(", ")}`,
    });
  }

  // Normalize role to canonical roles ("analyst" | "manager" | "admin") for transition validator
  let canonicalRole: "analyst" | "manager" | "admin" = "admin";
  if (cleanRole === "analyst") {
    canonicalRole = "analyst";
  } else if (cleanRole === "manager") {
    canonicalRole = "manager";
  } else {
    canonicalRole = "admin"; // super admin, owner, managing partner, partner are normalized to admin
  }

  // ── Execute Transition ───────────────────────────────────────────────────
  try {
    const result = await moveDealToStage(dealId, matchedStage, {
      changedBy: req.user.email,
      role: canonicalRole,
      notes: String(notes || ""),
    });

    // Immutable Audit Log
    await logAuditTrail(
      "TRANSITION_DEAL_STAGE",
      req.user.email,
      req.user.role,
      dealId,
      `Transitioned deal ${dealId} to stage: ${matchedStage}. Notes: ${notes}`
    );

    return res.status(201).json(result);
  } catch (err: any) {
    const status = err.status || 500;
    const error = err.message || "Transition failed";
    console.error(`[Transition API] ${status} — ${error}`);
    return res.status(status).json({ error });
  }
}

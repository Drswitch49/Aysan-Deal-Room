/**
 * Deal Lifecycle Inngest Workflows
 *
 * Reacts to DEAL_STAGE_CHANGED events and drives downstream automation.
 *
 * Architecture:
 *   Stage transition fires → emits deal/stage_changed → these workflows respond
 *   Heavy processing is fully async — HTTP requests return immediately.
 *
 * Per-stage automations:
 *   DISCOVERY      → trigger OSINT enrichment
 *   LOI            → request LOI document pack from document checklist
 *   DUE_DILIGENCE  → trigger full DD document request + OSINT refresh
 *   CLOSING        → notify portfolio team
 *   PORTFOLIO      → archive deal + mark as active portfolio company
 *   KILLED         → archive deal + flag lender notifications
 */

import { inngest } from "../_utils/inngest.js";
import { airtableFetch, airtableUpdate, airtableCreate } from "../_utils/airtable.js";
import { TABLES } from "../../src/lib/airtable/schema.js";

// ─── Deal Created → Initialize ───────────────────────────────────────────────

export const onDealCreated = inngest.createFunction(
  {
    id: "on-deal-created",
    name: "Deal Created → Initialize",
    retries: 2,
    triggers: [{ event: "deal/created" }],
  },
  async ({ event, step }) => {
    const { dealId, dealRef, companyName } = event.data;

    await step.run("initialize-workflow-state", async () => {
      // Ensure Stage_Updated_At and Workflow_Stage are initialized
      try {
        await airtableUpdate(TABLES.PIPELINE, dealId, {
          Stage_Updated_At: new Date().toISOString(),
          Workflow_Stage: "INTRO",
        });
      } catch (err: any) {
        console.warn(`[deal-workflows] Could not initialize workflow state for ${dealRef}:`, err.message);
      }
    });

    await step.run("log-deal-creation", async () => {
      try {
        await airtableCreate(TABLES.STAGE_HISTORY, {
          Deal_ID: [dealId],
          Deal_Ref: dealRef,
          Company_Name: companyName,
          From_Stage: "—",
          To_Stage: "INTRO",
          From_Stage_Label: "—",
          To_Stage_Label: "Intro",
          Changed_By: "System",
          Changed_By_Role: "admin",
          Changed_At: new Date().toISOString(),
          Notes: "Deal created — initial stage set to Intro",
          Transition_Valid: true,
        });
      } catch {
        console.info(`[deal-workflows] Deal_Stage_History not found — skipping creation log for ${dealRef}`);
      }
    });

    return { dealId, dealRef, initialized: true };
  }
);

// ─── Deal Stage Changed → Orchestration Engine ───────────────────────────────
//
// This is the central reactor for all stage transitions.
// Each stage entry triggers specific downstream automations.

export const onDealStageChanged = inngest.createFunction(
  {
    id: "on-deal-stage-changed",
    name: "Deal Stage Changed → Orchestrate",
    retries: 2,
    triggers: [{ event: "deal/stage_changed" }],
  },
  async ({ event, step }) => {
    const { dealId, dealRef, companyName, fromStage, toStage, changedBy, changedByRole, auditId, notes } = event.data;

    console.log(`[deal-workflows] Stage change: ${dealRef} ${fromStage} → ${toStage} by ${changedBy}`);

    // ── DISCOVERY: Trigger OSINT enrichment ──────────────────────────────────
    if (toStage === "DISCOVERY") {
      await step.run("trigger-osint-enrichment", async () => {
        try {
          // Look up company website if available
          const dealRes = await airtableFetch(TABLES.PIPELINE, {
            filterByFormula: `RECORD_ID() = "${dealId}"`,
            maxRecords: 1,
          });
          const website = dealRes?.records?.[0]?.fields?.Website || dealRes?.records?.[0]?.fields?.Company_Website || "";

          // Emit OSINT scrape request — picked up by osint-workflows.ts
          const { emitEvent } = await import("../_events/emit.js");
          await emitEvent("osint/scrape_requested", {
            dealId,
            companyName: companyName || dealRef,
            website: website || undefined,
          });

          console.log(`[deal-workflows] OSINT enrichment triggered for ${dealRef}`);
        } catch (err: any) {
          console.warn(`[deal-workflows] OSINT trigger failed for ${dealRef}:`, err.message);
        }
      });
    }

    // ── LOI: Request standard LOI document pack ───────────────────────────────
    if (toStage === "LOI") {
      await step.run("request-loi-documents", async () => {
        const loiDocumentTypes = [
          { name: "Letter of Intent (LOI)", category: "Legal" },
          { name: "Heads of Terms", category: "Legal" },
          { name: "Financial Model", category: "Financial" },
        ];

        for (const doc of loiDocumentTypes) {
          try {
            // Check if this document type already exists for the deal
            const existingRes = await airtableFetch(TABLES.DOCUMENTS, {
              filterByFormula: `AND(FIND("${dealId}", {Deal_Ref}), {Document_Name} = "${doc.name}")`,
              maxRecords: 1,
            });

            if (!existingRes?.records?.length) {
              await airtableCreate(TABLES.DOCUMENTS, {
                Document_Name: doc.name,
                Category: doc.category,
                Status: "Outstanding",
                Deal_Ref: [dealId],
                ABL_Critical: true,
                Source: "Workflow — LOI Stage",
              });
            }
          } catch (err: any) {
            console.warn(`[deal-workflows] Could not create ${doc.name} for ${dealRef}:`, err.message);
          }
        }

        console.log(`[deal-workflows] LOI document pack requested for ${dealRef}`);
      });
    }

    // ── DUE_DILIGENCE: Full DD pack + OSINT refresh ───────────────────────────
    if (toStage === "DUE_DILIGENCE") {
      await step.run("request-dd-documents", async () => {
        const ddDocumentTypes = [
          { name: "Management Accounts (Last 3 Years)", category: "Financial" },
          { name: "Statutory Accounts", category: "Financial" },
          { name: "Management Accounts (YTD)", category: "Financial" },
          { name: "Aged Debtors Report", category: "Financial" },
          { name: "Asset Register", category: "Operational" },
          { name: "Customer Contracts", category: "Commercial" },
          { name: "Employment Contracts", category: "Legal" },
          { name: "Property Leases", category: "Legal" },
          { name: "Insurance Schedule", category: "Legal" },
          { name: "Company Articles & Shareholders Agreement", category: "Corporate" },
        ];

        for (const doc of ddDocumentTypes) {
          try {
            const existingRes = await airtableFetch(TABLES.DOCUMENTS, {
              filterByFormula: `AND(FIND("${dealId}", {Deal_Ref}), {Document_Name} = "${doc.name}")`,
              maxRecords: 1,
            });

            if (!existingRes?.records?.length) {
              await airtableCreate(TABLES.DOCUMENTS, {
                Document_Name: doc.name,
                Category: doc.category,
                Status: "Outstanding",
                Deal_Ref: [dealId],
                ABL_Critical: true,
                Source: "Workflow — Due Diligence Stage",
              });
            }
          } catch (err: any) {
            console.warn(`[deal-workflows] Could not create ${doc.name} for ${dealRef}:`, err.message);
          }
        }

        console.log(`[deal-workflows] DD document pack requested for ${dealRef} (${ddDocumentTypes.length} docs)`);
      });

      // Refresh OSINT at DD stage
      await step.run("refresh-osint-at-dd", async () => {
        try {
          const { emitEvent } = await import("../_events/emit.js");
          await emitEvent("osint/scrape_requested", {
            dealId,
            companyName: companyName || dealRef,
          });
        } catch (err: any) {
          console.warn(`[deal-workflows] OSINT refresh failed for DD stage ${dealRef}:`, err.message);
        }
      });
    }

    // ── CLOSING: Mark deal as closing in pipeline ─────────────────────────────
    if (toStage === "CLOSING") {
      await step.run("mark-closing", async () => {
        try {
          await airtableUpdate(TABLES.PIPELINE, dealId, {
            Closing_Initiated_At: new Date().toISOString(),
            Closing_Initiated_By: changedBy,
          });
          console.log(`[deal-workflows] Closing stage initiated for ${dealRef}`);
        } catch (err: any) {
          console.warn(`[deal-workflows] Could not update closing fields for ${dealRef}:`, err.message);
        }
      });
    }

    // ── PORTFOLIO: Archive as active portfolio company ────────────────────────
    if (toStage === "PORTFOLIO") {
      await step.run("mark-portfolio", async () => {
        try {
          await airtableUpdate(TABLES.PIPELINE, dealId, {
            Portfolio_Since: new Date().toISOString(),
            Is_Portfolio: true,
          });
          console.log(`[deal-workflows] ${dealRef} marked as portfolio company`);
        } catch (err: any) {
          console.warn(`[deal-workflows] Could not update portfolio fields for ${dealRef}:`, err.message);
        }
      });
    }

    // ── KILLED: Archive and flag ──────────────────────────────────────────────
    if (toStage === "KILLED") {
      await step.run("archive-killed-deal", async () => {
        try {
          await airtableUpdate(TABLES.PIPELINE, dealId, {
            Killed_At: new Date().toISOString(),
            Killed_By: changedBy,
            Kill_Reason: notes || "No reason provided",
          });
          console.log(`[deal-workflows] ${dealRef} archived as killed deal`);
        } catch (err: any) {
          console.warn(`[deal-workflows] Could not update kill fields for ${dealRef}:`, err.message);
        }
      });
    }

    return { dealId, dealRef, fromStage, toStage, processed: true, auditId };
  }
);

// ─── Export ──────────────────────────────────────────────────────────────────
export const dealWorkflows = [
  onDealCreated,
  onDealStageChanged,
];

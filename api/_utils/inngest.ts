import { Inngest } from "inngest";

// ─── Platform Event Schema ────────────────────────────────────────────────────
// Every event in the system is defined here with its full TypeScript type.
// Event naming convention: "domain/noun.verb" — e.g. "document/uploaded"

type Events = {
  // ── Deal Events ─────────────────────────────────────────────────────────────
  "deal/created": {
    data: {
      dealId: string;
      dealRef: string;
      companyName: string;
      sector?: string;
    };
  };
  "deal/stage_changed": {
    data: {
      dealId: string;
      dealRef: string;
      companyName?: string;
      /** Canonical stage constant e.g. "DISCOVERY" */
      fromStage: string;
      /** Canonical stage constant e.g. "LOI" */
      toStage: string;
      changedBy: string;
      changedByRole: "analyst" | "manager" | "admin";
      /** ID of the Deal_Stage_History Airtable record */
      auditId: string;
      notes?: string;
      timestamp: string;
    };
  };

  // ── Document Events ──────────────────────────────────────────────────────────
  "document/uploaded": {
    data: {
      documentId: string;
      dealId: string;
      fileName: string;
      category: string;
      /** If provided, triggers immediate parse pipeline */
      triggerPipeline?: boolean;
    };
  };
  "document/parse_requested": {
    data: {
      documentId: string;
      dealId?: string;
    };
  };
  "document/analyze_requested": {
    data: {
      documentId: string;
      dealId?: string;
    };
  };
  "document/parsed": {
    data: {
      documentId: string;
      dealId?: string;
      wordCount: number;
      characterCount: number;
      fileType: string;
    };
  };
  "document/analyzed": {
    data: {
      documentId: string;
      dealId?: string;
      wordCount?: number;
      characterCount?: number;
      fileType?: string;
    };
  };

  // ── Transcript Events ────────────────────────────────────────────────────────
  "transcript/submitted": {
    data: {
      transcriptId: string;
      dealId: string;
    };
  };
  "transcript/analyzed": {
    data: {
      transcriptId: string;
      dealId: string;
      dealScore?: number;
    };
  };

  // ── Brief Events ─────────────────────────────────────────────────────────────
  "brief/precall_requested": {
    data: {
      briefId: string;
      dealId: string;
      callType: string;
      attendees?: string[];
      dataSources?: Record<string, boolean>;
      pastedText?: string;
    };
  };
  "brief/postcall_requested": {
    data: {
      briefId: string;
      dealId: string;
      schemaId: string;
      notes?: string;
    };
  };
  "brief/postcall_completed": {
    data: {
      briefId: string;
      dealId: string;
      /** Weighted score out of 50 from the scoring schema */
      scoreOutOf50: number;
      /** Raw metric scores keyed by metric ID */
      scores: Record<string, { score: number; explanation: string }>;
      /** Claude-generated executive summary */
      summary: string;
      /** Claude-drafted follow-up email */
      followUpEmail: string;
      schemaId: string;
    };
  };

  // ── OSINT / Portfolio Events ─────────────────────────────────────────────────
  "osint/scrape_requested": {
    data: {
      dealId: string;
      companyName: string;
      website?: string;
    };
  };
  "portfolio/process_requested": {
    data: {
      triggeredBy?: string;
    };
  };
  "financial/analysis_requested": {
    data: {
      dealId: string;
      documentId?: string;
      manuallyTriggered?: boolean;
    };
  };
};

// ─── Inngest Client ───────────────────────────────────────────────────────────
// Single client instance — import `inngest` everywhere you need to create
// functions or send events.
export const inngest = new Inngest({
  id: "acp-deal-os",
});

export type { Events as PlatformEvents };

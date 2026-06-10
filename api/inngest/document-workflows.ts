/**
 * Inngest Workflow: Document Processing Pipeline
 *
 * Three functions covering the full document lifecycle:
 *  1. onDocumentUploaded    — full pipeline: parse → analyze (triggered when triggerPipeline=true)
 *  2. onDocumentParseRequested — parse-only (text extraction)
 *  3. onDocumentAnalyzeRequested — analyze-only (Claude AI analysis of existing extracted text)
 *
 * On Vercel Pro (maxDuration: 300s), each step can run for up to 5 minutes.
 * Claude timeout is set to 120s — plenty of headroom.
 */

import { inngest } from "../_utils/inngest.js";
import { TABLES } from "../../src/lib/airtable/schema.js";
import { parseDocument, analyzeDocument } from "../_utils/document-processor.js";
import { failJob } from "../_utils/job-status.js";
import { emitEvent } from "../_events/emit.js";

const TABLE = TABLES.DOCUMENTS || "Documents";

// ─── 1. Full Upload Pipeline ─────────────────────────────────────────────────

const onDocumentUploaded = inngest.createFunction(
  {
    id: "document-upload-pipeline",
    name: "Document: Upload → Parse → Analyze",
    retries: 3,
  },
  { event: "document/uploaded" },
  async ({ event, step }) => {
    const { documentId, triggerPipeline = false } = event.data;

    // Only run full pipeline if explicitly requested (avoids double-processing
    // when a document is uploaded without wanting immediate AI analysis)
    if (!triggerPipeline) {
      return { skipped: true, reason: "triggerPipeline=false" };
    }

    // Step 1: Parse — download file and extract text
    const parseResult = await step.run("parse-document", async () => {
      return parseDocument(TABLE, documentId);
    });

    // Step 2: Analyze — Claude AI analysis of extracted text
    const analyzeResult = await step.run("analyze-document", async () => {
      return analyzeDocument(TABLE, documentId);
    });

    // Step 3: Emit analyzed event for downstream listeners
    await step.run("emit-analyzed", async () => {
      await emitEvent("document/analyzed", {
        documentId,
        dealId: event.data.dealId,
        wordCount: parseResult.wordCount,
        characterCount: parseResult.characterCount,
        fileType: parseResult.fileType,
      });
    });

    return {
      success: true,
      documentId,
      fileType: parseResult.fileType,
      characterCount: parseResult.characterCount,
      wordCount: parseResult.wordCount,
      summary: analyzeResult.summary,
    };
  }
);

// ─── 2. Parse Only ───────────────────────────────────────────────────────────

const onDocumentParseRequested = inngest.createFunction(
  {
    id: "document-parse-only",
    name: "Document: Parse (Text Extraction)",
    retries: 3,
  },
  { event: "document/parse_requested" },
  async ({ event, step }) => {
    const { documentId } = event.data;

    const result = await step.run("parse-document", async () => {
      return parseDocument(TABLE, documentId);
    });

    // Emit parsed event for downstream pipelines (e.g. auto-analyze)
    await step.run("emit-parsed", async () => {
      await emitEvent("document/parsed", {
        documentId,
        dealId: event.data.dealId,
        wordCount: result.wordCount,
        characterCount: result.characterCount,
        fileType: result.fileType,
      });
    });

    return {
      success: true,
      documentId,
      fileType: result.fileType,
      characterCount: result.characterCount,
      wordCount: result.wordCount,
    };
  }
);

// ─── 3. Analyze Only ─────────────────────────────────────────────────────────

const onDocumentAnalyzeRequested = inngest.createFunction(
  {
    id: "document-analyze-only",
    name: "Document: Analyze (Claude AI)",
    retries: 3,
  },
  { event: "document/analyze_requested" },
  async ({ event, step }) => {
    const { documentId } = event.data;

    const result = await step.run("analyze-document", async () => {
      return analyzeDocument(TABLE, documentId);
    });

    await step.run("emit-analyzed", async () => {
      await emitEvent("document/analyzed", {
        documentId,
        dealId: event.data.dealId,
        // word/char count unknown when analyzing without re-parsing
        wordCount: 0,
        characterCount: 0,
        fileType: "unknown",
      });
    });

    return {
      success: true,
      documentId,
      summary: result.summary,
      risksCount: result.risks.length,
      covenantsCount: result.covenants.length,
    };
  }
);

// ─── Export ──────────────────────────────────────────────────────────────────

export const documentWorkflows = [
  onDocumentUploaded,
  onDocumentParseRequested,
  onDocumentAnalyzeRequested,
];

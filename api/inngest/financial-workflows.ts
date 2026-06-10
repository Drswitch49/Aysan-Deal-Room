/**
 * Inngest Workflows: Financial Intelligence Engine
 *
 * Handles:
 *  1. Document parsing / extraction of raw financial figures
 *  2. Ingestion of manual/Airtable financial fields
 *  3. Deterministic calculation calculations, anomalies, and risks
 *  4. Claude AI credit underwriting interpretation
 *  5. Persistence of structured scores and analysis to Airtable
 */

import { inngest } from "../_utils/inngest.js";
import { TABLES } from "../../src/lib/airtable/schema.js";
import { airtableFetch, airtableFetchRecord, airtableUpdate } from "../_utils/airtable.js";
import { executeFinancialEngine } from "../../lib/financial/engine/financial-engine.js";

// ─── Claude AI Raw Data Extractor ──────────────────────────────────────────

async function extractRawFinancialsFromText(
  documentName: string,
  text: string
): Promise<any> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const systemPrompt = `You are a financial analyst assistant. Your task is to scan the extracted text from a financial document (e.g., balance sheet, profit and loss, tax return) and extract the RAW financial values.

CRITICAL RULE:
- Do NOT calculate any values yourself. ONLY extract them if they are explicitly mentioned or can be directly read.
- If a value is not mentioned, return null.
- Do NOT guess or hallucinate any numbers.

Respond ONLY with a valid JSON object matching this schema:
{
  "revenue": number | null,
  "costOfGoodsSold": number | null,
  "netIncome": number | null,
  "operatingIncome": number | null,
  "depreciationAndAmortization": number | null,
  "addBacks": number | null,
  "currentAssets": number | null,
  "currentLiabilities": number | null,
  "totalDebt": number | null,
  "annualDebtService": number | null,
  "interestExpense": number | null,
  "cashFlowStabilityRating": "high" | "moderate" | "low" | null,
  "revenueTrendRating": "growing" | "stable" | "declining" | null
}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: `Document: ${documentName}\n\nText:\n${text.substring(0, 25000)}` }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Claude extraction API returned status ${res.status}`);
  }

  const payload = await res.json();
  let raw = payload.content?.[0]?.text || "{}";
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  }

  return JSON.parse(raw);
}

// ─── Claude AI Commentary Interpreter ────────────────────────────────────────

async function interpretFinancialsWithClaude(
  companyName: string,
  metrics: any,
  anomalies: any[],
  risks: any[]
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return "AI interpretation unavailable — ANTHROPIC_API_KEY not configured.";
  }

  const systemPrompt = `You are a senior credit underwriting expert at Aysan Capital Partners.
Your task is to write a professional, institutional-grade credit commentary interpreting calculated financial metrics, anomalies, and risk markers for a target company.

STRICT RULES:
- ONLY discuss the provided calculated metrics, anomalies, and risks.
- Do NOT fabricate or assume any metrics that are not in the inputs.
- Comment specifically on:
  1. Cash Flow & Debt Service Coverage (DSCR safety margin).
  2. Leverage and repayment stability.
  3. Liquidity and Working Capital status.
  4. Overall operational viability and investment recommendation.

Write 3-4 professional, analytical paragraphs. Do NOT include markdown styling or headers, just plain text with double line breaks between paragraphs.`;

  const inputContext = JSON.stringify({ metrics, anomalies, risks }, null, 2);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1200,
        system: systemPrompt,
        messages: [{ role: "user", content: `Company: ${companyName}\n\nCalculated Data:\n${inputContext}` }],
      }),
    });

    if (!res.ok) {
      return `AI interpretation failed: HTTP status ${res.status}`;
    }

    const payload = await res.json();
    return payload.content?.[0]?.text || "No commentary generated.";
  } catch (err: any) {
    return `AI interpretation failed: ${err.message}`;
  }
}

// ─── Inngest Financial Workflow ──────────────────────────────────────────────

export const onFinancialAnalysisRequested = inngest.createFunction(
  {
    id: "financial-analysis-workflow",
    name: "Financials: Deterministic Underwriting & Analysis",
    retries: 2,
  },
  { event: "financial/analysis_requested" },
  async ({ event, step }) => {
    const { dealId, documentId, manuallyTriggered } = event.data;
    const PIPELINE_TABLE = TABLES.PIPELINE || "Active_Pipeline";
    const DOCUMENTS_TABLE = TABLES.DOCUMENTS || "Documents";

    console.log(`[Financial Workflow] Starting financial engine for deal: ${dealId}`);

    try {
      // Step 1: Mark as Processing
      await step.run("mark-processing", async () => {
        await airtableUpdate(PIPELINE_TABLE, dealId, {
          Financial_Analysis_Status: "Processing",
          Financial_Anomalies: "",
        });
      });

      // Step 2: Fetch the deal record
      const dealRecord = await step.run("fetch-deal-fields", async () => {
        const rec = await airtableFetchRecord(PIPELINE_TABLE, dealId);
        return rec?.fields || {};
      });

      const companyName =
        (dealRecord as any).Company_Name ||
        (dealRecord as any)["Company Name"] ||
        (dealRecord as any).Deal_Ref ||
        "Company";

      // Step 3: Gather document text if available
      const docTextResult = await step.run("gather-document-text", async () => {
        let text = "";
        let docName = "";

        if (documentId) {
          const docRec = await airtableFetchRecord(DOCUMENTS_TABLE, documentId);
          if (docRec?.fields?.Extracted_Text) {
            text = String(docRec.fields.Extracted_Text);
            docName = String(docRec.fields.Document_Name || "Document");
          }
        } else {
          // Find most recent completed Financial/Accounts document
          const docsRes = await airtableFetch(DOCUMENTS_TABLE, {
            filterByFormula: `AND(FIND("${dealId}", {Deal_Ref}), OR({Category} = "Financial", {Category} = "Accounts"), {Status} = "completed")`,
            maxRecords: 1,
          });

          if (docsRes.records && docsRes.records.length > 0) {
            text = String(docsRes.records[0].fields.Extracted_Text || "");
            docName = String(docsRes.records[0].fields.Document_Name || "Financial Document");
          }
        }

        return { text, docName };
      });

      // Step 4: Extract raw financials using Claude (if document text exists)
      const extractedRaw = await step.run("extract-raw-financials", async () => {
        if (docTextResult.text) {
          return extractRawFinancialsFromText(docTextResult.docName, docTextResult.text);
        }
        return null;
      });

      // Step 5: Compile consolidated financial inputs (extracts > Airtable fields)
      const compiledInputs = await step.run("consolidate-inputs", async () => {
        const fields = dealRecord as any;

        // If Claude extracted data from PDF/Spreadsheet, we overlay it on top of Airtable's record
        const inputs = {
          revenue: fields.Revenue || fields.revenue || extractedRaw?.revenue || 0,
          costOfGoodsSold: fields.CostOfGoodsSold || extractedRaw?.costOfGoodsSold || 0,
          netIncome: fields.NetIncome || fields.netIncome || extractedRaw?.netIncome || 0,
          operatingIncome: fields.OperatingIncome || extractedRaw?.operatingIncome || undefined,
          depreciationAndAmortization: fields.Depreciation || extractedRaw?.depreciationAndAmortization || 0,
          addBacks: fields.AddBacks || extractedRaw?.addBacks || 0,
          currentAssets: fields.CurrentAssets || extractedRaw?.currentAssets || 0,
          currentLiabilities: fields.CurrentLiabilities || extractedRaw?.currentLiabilities || 0,
          totalDebt: fields.TotalDebt || fields.Senior_Debt || extractedRaw?.totalDebt || 0,
          annualDebtService: fields.AnnualDebtService || extractedRaw?.annualDebtService || 0,
          interestExpense: fields.InterestExpense || extractedRaw?.interestExpense || 0,
          enterpriseValue: fields.EV || fields.EnterpriseValue || extractedRaw?.enterpriseValue || 0,
          // Qualitative indicators
          cashFlowStabilityRating: extractedRaw?.cashFlowStabilityRating || "moderate",
          revenueTrendRating: extractedRaw?.revenueTrendRating || "stable",
          osintCredibilityRating: fields.OSINT_Status === "Completed",
          workflowCompletenessRating: 0.8, // Fallback placeholder ratio
        };

        return inputs;
      });

      // Step 6: Execute deterministic calculations
      const report = await step.run("execute-calculations", async () => {
        return executeFinancialEngine(compiledInputs);
      });

      if (!report.success || !report.calculatedMetrics || !report.scorecard) {
        throw new Error(report.error || "Financial calculations engine failed to produce scorecard");
      }

      // Step 7: Claude AI credit interpretation
      const commentary = await step.run("interpret-commentary", async () => {
        return interpretFinancialsWithClaude(
          companyName,
          report.calculatedMetrics,
          report.anomalies,
          report.risks
        );
      });

      // Step 8: Persist back to Airtable
      await step.run("persist-results", async () => {
        const metrics = report.calculatedMetrics!;
        const scorecard = report.scorecard!;

        const updatePayload: Record<string, any> = {
          EBITDA: metrics.normalizedEbitda,
          DSCR: metrics.dscr || 0,
          Leverage_Ratio: metrics.leverageRatio || 0,
          Enterprise_Value: metrics.enterpriseValue,
          Deal_Score: scorecard.dealScore,
          Financial_Risk_Score: Math.round(scorecard.confidenceScore * 100),
          Financial_Analysis_Status: "Completed",
          Financial_Insights: commentary,
          Financial_Anomalies: report.anomalies.map((a) => `• ${a.name}: ${a.explanation}`).join("\n"),
          Financial_Completed_At: new Date().toISOString(),
        };

        await airtableUpdate(PIPELINE_TABLE, dealId, updatePayload);
      });

      return {
        success: true,
        dealId,
        score: report.scorecard?.dealScore,
        status: "Completed",
      };
    } catch (err: any) {
      console.error(`[Financial Workflow] Underwriting pipeline failed:`, err.message);

      await step.run("persist-failure", async () => {
        await airtableUpdate(PIPELINE_TABLE, dealId, {
          Financial_Analysis_Status: "Failed",
          Financial_Anomalies: `• Analysis crash: ${err.message}`,
          Financial_Completed_At: new Date().toISOString(),
        });
      });

      throw err;
    }
  }
);

export const financialWorkflows = [onFinancialAnalysisRequested];

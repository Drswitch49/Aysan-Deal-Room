/**
 * Document text extraction + AI analysis (Phase 5c redesign).
 *
 * Fetches a document from its (Cloudinary or legacy) URL, extracts text
 * (PDF via pdf-parse, DOCX via mammoth, else UTF-8), and produces a typed
 * Claude analysis. Runs as the `document-analysis` job; results land on the
 * documents row (summary/risks/covenants/metrics/extracted_text).
 */
import { z } from "zod";
import { askClaudeJson } from "../ai/client.js";

/**
 * Readable text out of an HTML page.
 *
 * Not every "IM" on a deal is a file: brokers routinely send a link to a CIM
 * viewer, and those rows get fetched like any other document. Handing the raw
 * markup to Claude as the deal's primary source is worse than handing it
 * nothing — a page of CSP headers and script tags reads as content, spends the
 * IM character budget, and invites the model to infer from noise.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|br)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/[ \t\u00A0]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

/** Below this, a stripped page is a JS shell or a login wall, not a document. */
const MIN_HTML_TEXT_CHARS = 400;

export async function extractTextFromUrl(url: string, filename?: string | null): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch document (${res.status}) from ${url.slice(0, 80)}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const name = (filename ?? url).toLowerCase();
  const contentType = res.headers.get("content-type") ?? "";

  if (name.endsWith(".pdf") || contentType.includes("pdf")) {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text ?? "";
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  }
  if (name.endsWith(".docx") || contentType.includes("officedocument.wordprocessing")) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value ?? "";
  }

  const raw = buffer.toString("utf8");

  if (name.endsWith(".html") || name.endsWith(".htm") || contentType.includes("html") || /^\s*<(!doctype|html)\b/i.test(raw)) {
    const text = htmlToText(raw);
    // A CIM viewer renders client-side, so the fetched HTML carries no document
    // text at all. Fail loudly: the caller records it as unreadable and the
    // brief lists it as a blind spot instead of quoting boilerplate at us.
    if (text.length < MIN_HTML_TEXT_CHARS) {
      throw new Error(
        "The link returned a web page with no readable document text (it likely needs a login or renders in the browser). " +
          "Download the document and upload the file itself.",
      );
    }
    return text;
  }

  return raw;
}

export const documentAnalysisSchema = z.object({
  summary: z.string().catch(""),
  risks: z.array(z.string()).catch([]),
  covenants: z.array(z.string()).catch([]),
  metrics: z.record(z.string(), z.union([z.string(), z.number()])).catch({}),
});
export type DocumentAnalysis = z.infer<typeof documentAnalysisSchema>;

const ANALYSIS_SYSTEM = `You are a senior credit analyst at Aysan Capital Partners, a private equity and acquisition-finance firm.
Analyze the provided deal document text (IM, financial statements, lease, or contract).

Respond ONLY with a valid JSON object matching exactly:
{
  "summary": "Concise professional summary of the document (3-5 sentences): what it is, key commercial terms, and overall picture.",
  "risks": ["Risk 1 (e.g. customer concentration, lease break clause, covenant pressure)"],
  "covenants": ["Any financial or operational covenants/obligations found, empty if none"],
  "metrics": { "Revenue": "£1.2m", "EBITDA": "£300k" }
}

RULES: Never fabricate numbers — extract only figures present in the text. If the text is truncated or unreadable, state that in the summary.`;

export function analyzeDocumentText(text: string): Promise<DocumentAnalysis> {
  const clipped = text.length > 60_000 ? `${text.slice(0, 60_000)}\n\n[TRUNCATED]` : text;
  return askClaudeJson(documentAnalysisSchema, {
    system: ANALYSIS_SYSTEM,
    maxTokens: 3000,
    messages: [{ role: "user", content: `Document text:\n\n${clipped}` }],
  });
}

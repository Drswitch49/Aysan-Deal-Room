/**
 * Source: the deal's own IM and supporting attachments.
 *
 * The pre-call brief used to see IM files only as a name — the brief form's
 * upload box passed `"Dropped file: <name>"` into the prompt and nothing else,
 * while the deal-context provider carried document *summaries* rather than any
 * document text. The IM is usually the single richest thing we hold on a deal,
 * so this reads the files themselves.
 *
 * Extraction (PDF via pdf-parse, DOCX via mammoth) is cached back onto the row:
 * a replace creates a new row, so cached text can never drift from its file.
 */
import { adminClient } from "../../data/supabase/client.js";

/** Per-file and whole-block ceilings on how much IM text reaches the prompt. */
const PER_FILE_CHARS = 20_000;
const TOTAL_CHARS = 40_000;

export interface ImDocumentText {
  name: string;
  text: string;
  /** Set when the file could not be read — worth telling the model about. */
  error?: string;
}

/** Signed Cloudinary candidates for a row, most likely resource type first. */
async function candidateUrls(row: Record<string, any>): Promise<string[]> {
  const urls: string[] = [];
  if (row.cloudinary_public_id) {
    const { downloadUrl } = await import("../../core/cloudinary.js");
    urls.push(
      downloadUrl(row.cloudinary_public_id, { resourceType: "image" }),
      downloadUrl(row.cloudinary_public_id, { resourceType: "raw" }),
    );
  }
  for (const legacy of [row.file_url, row.legacy_file_url]) {
    if (legacy && !urls.includes(legacy)) urls.push(legacy);
  }
  return urls;
}

/** Read every IM/attachment on the deal, extracting (and caching) its text. */
export async function loadImDocumentText(dealId: string): Promise<ImDocumentText[]> {
  const db = adminClient();
  // select("*") rather than naming the cache columns: it keeps working before
  // 0013_im_documents_extracted_text.sql has been applied (extraction just
  // repeats each run instead of erroring the whole source out).
  const { data, error } = await db
    .from("im_review_documents")
    .select("*")
    .eq("deal_id", dealId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(10);
  if (error || !data?.length) return [];

  const { extractTextFromUrl } = await import("../../documents/extract.js");

  /** Cache writes are best-effort — a missing column must not lose the text. */
  const cache = async (id: string, patch: Record<string, unknown>) => {
    await db.from("im_review_documents").update(patch).eq("id", id);
  };

  return Promise.all(
    data.map(async (row: Record<string, any>): Promise<ImDocumentText> => {
      const name = row.document_name || "Untitled attachment";
      if (row.extracted_text) return { name, text: row.extracted_text };

      let lastErr: unknown = null;
      for (const url of await candidateUrls(row)) {
        try {
          const text = await extractTextFromUrl(url, name);
          if (text.trim()) {
            await cache(row.id, {
              extracted_text: text.slice(0, 100_000),
              extracted_at: new Date().toISOString(),
              extraction_error: null,
            });
            return { name, text };
          }
        } catch (err) {
          lastErr = err;
        }
      }

      const message = lastErr instanceof Error ? lastErr.message : "no readable text found";
      await cache(row.id, { extraction_error: message, extracted_at: new Date().toISOString() });
      return { name, text: "", error: message };
    }),
  );
}

/** Render the IM text as prompt input, within the char ceilings. */
export function formatImDocumentsForPrompt(docs: ImDocumentText[]): string {
  if (!docs.length) return "";

  const blocks: string[] = [];
  let budget = TOTAL_CHARS;

  for (const doc of docs) {
    if (!doc.text.trim()) {
      blocks.push(`--- ${doc.name} ---\n[Could not be read: ${doc.error ?? "unknown error"}]`);
      continue;
    }
    if (budget <= 0) {
      blocks.push(`--- ${doc.name} ---\n[Not included — the IM text budget was used by earlier files]`);
      continue;
    }
    const allowance = Math.min(PER_FILE_CHARS, budget);
    const clipped = doc.text.length > allowance ? `${doc.text.slice(0, allowance)}\n[TRUNCATED]` : doc.text;
    budget -= clipped.length;
    blocks.push(`--- ${doc.name} ---\n${clipped}`);
  }

  return `IM & ATTACHMENT TEXT (${docs.length} file${docs.length === 1 ? "" : "s"}, verbatim):\n${blocks.join("\n\n")}`;
}

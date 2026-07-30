/**
 * OSINT source: everything Supabase already knows about the deal.
 *
 * The richest source on any deal is usually our own record of it — the intake
 * fields, the analysed IM/document summaries, and the notes the team has left.
 * Previously the scan sent Claude only the company name, so it re-derived from
 * scratch what the deal row already stated.
 */
import { adminClient } from "../../data/supabase/client.js";

export interface DealContext {
  deal: Record<string, unknown>;
  documents: Array<{ name: string; summary: string; risks: string; covenants: string }>;
  notes: Array<{ author: string; note: string; at: string }>;
}

/** Deal columns worth sending — the whole row is ~90 columns of mostly nulls. */
const DEAL_FIELDS = [
  "id", "acp_ref_no", "ref_no", "company_name", "deal_name", "project_name",
  "sector", "industry", "location", "website", "source", "broker",
  "stage", "pipeline_stage", "status",
  "turnover", "ebitda_gbp", "asking_price_gbp", "enterprise_value", "dscr_proxy",
  "business_description", "executive_summary", "one_line_reason", "internal_notes",
  "owner", "analyst", "next_action", "next_action_date", "date_added",
  "kill_reason_text", "killed_by", "kill_date",
].join(", ");

export async function loadDealContext(dealId: string): Promise<DealContext> {
  const db = adminClient();

  const [dealRes, docsRes, notesRes] = await Promise.all([
    db.from("deals").select(DEAL_FIELDS).eq("id", dealId).maybeSingle(),
    db
      .from("documents")
      .select("document_name, summary, risks, covenants")
      .eq("deal_id", dealId)
      .limit(20),
    db
      .from("deal_notes")
      .select("author, note, created_at")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const deal = (dealRes.data ?? {}) as Record<string, unknown>;

  return {
    deal: Object.fromEntries(
      Object.entries(deal).filter(([, v]) => v !== null && v !== "" && v !== undefined),
    ),
    documents: (docsRes.data ?? []).map((d: Record<string, any>) => ({
      name: d.document_name ?? "",
      summary: d.summary ?? "",
      risks: d.risks ?? "",
      covenants: d.covenants ?? "",
    })).filter((d) => d.summary || d.risks || d.covenants),
    notes: (notesRes.data ?? []).map((n: Record<string, any>) => ({
      author: n.author ?? "",
      note: n.note ?? "",
      at: n.created_at ?? "",
    })).filter((n) => n.note),
  };
}

/** Render the deal context as prompt input. */
export function formatDealContextForPrompt(ctx: DealContext): string {
  const parts: string[] = [
    `DEAL RECORD (Supabase):\n${JSON.stringify(ctx.deal, null, 1).slice(0, 4000)}`,
  ];

  if (ctx.documents.length > 0) {
    parts.push(
      `ANALYSED DOCUMENTS (${ctx.documents.length}):\n` +
        ctx.documents
          .map((d) => `- ${d.name}\n  Summary: ${d.summary}\n  Risks: ${d.risks}\n  Covenants: ${d.covenants}`)
          .join("\n")
          .slice(0, 6000),
    );
  }

  if (ctx.notes.length > 0) {
    parts.push(
      `TEAM NOTES (most recent first):\n` +
        ctx.notes.map((n) => `- [${n.at.slice(0, 10)} ${n.author}] ${n.note}`).join("\n").slice(0, 4000),
    );
  }

  return parts.join("\n\n");
}

/**
 * /api/intelligence — the Deal Intelligence tab (Optimisation Brief v1.1, s4).
 *
 * GET  ?deal_id&run_id → the latest intelligence run for that post-call run,
 *      with sections filtered to the viewer's role (partners see all 19; the
 *      fractional analyst sees 1-9 and 11, never the partners-only 8) and the
 *      cards a newer document upload has made stale.
 * POST { action: "generate", deal_id, run_id, inbound?, counterparty_role?, recipient_name? }
 *      { action: "regenerate", id, sections, inbound?, counterparty_role?, recipient_name? }
 *      { action: "lock", id, section, locked }
 *      { action: "comment", id, section, text }
 *      { action: "log", id }   → Negotiation Log row (+ Notion), partners only
 */
import { z } from "zod";
import { createHandler } from "../_lib/handler.js";
import { PARTNER_MANAGERS, WRITERS, displayName } from "../_lib/authz.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/core/errors.js";
import { adminClient } from "../../lib/data/supabase/client.js";
import { enqueue } from "../../lib/jobs/queue.js";
import { aiAvailable } from "../../lib/ai/client.js";
import { startIntelligenceRun } from "../../lib/intelligence/generate.js";
import { writeNegotiationLog, type LogRow } from "../../lib/intelligence/notionLog.js";
import { SECTIONS, SECTION_BY_KEY, visibleSections, type SectionKey } from "../../src/lib/acp/intelligence.js";

const sectionKey = z.enum(SECTIONS.map((s) => s.key) as [SectionKey, ...SectionKey[]]);
const counterparty = {
  inbound: z.string().max(20_000).nullable().optional(),
  counterparty_role: z.enum(["broker", "seller", "lender", "adviser"]).optional(),
  recipient_name: z.string().max(200).nullable().optional(),
};

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("generate"), deal_id: z.string().uuid(), run_id: z.string().uuid(), ...counterparty }),
  z.object({ action: z.literal("regenerate"), id: z.string().uuid(), sections: z.array(sectionKey).min(1), ...counterparty }),
  z.object({ action: z.literal("lock"), id: z.string().uuid(), section: sectionKey, locked: z.boolean() }),
  z.object({ action: z.literal("comment"), id: z.string().uuid(), section: sectionKey, text: z.string().trim().min(1).max(4000) }),
  z.object({ action: z.literal("log"), id: z.string().uuid() }),
]);

const querySchema = z.object({ deal_id: z.string().uuid(), run_id: z.string().uuid() });

const db = () => adminClient();

async function latestDocumentAt(dealId: string): Promise<string | null> {
  const [im, docs] = await Promise.all([
    db().from("im_review_documents").select("created_at").eq("deal_id", dealId).is("deleted_at", null).order("created_at", { ascending: false }).limit(1),
    db().from("documents").select("updated_at").eq("deal_id", dealId).order("updated_at", { ascending: false }).limit(1),
  ]);
  const times = [im.data?.[0]?.created_at, docs.data?.[0]?.updated_at].filter(Boolean) as string[];
  return times.sort().pop() ?? null;
}

/** Filter a run to what this role may see, and add the stale cards. */
interface IntelRow {
  sections?: Record<string, unknown>;
  stale_sections?: string[];
  locked_sections?: string[];
  comments?: Array<{ section: string }>;
  [k: string]: unknown;
}

function present(row: IntelRow, role: string, latestDoc: string | null) {
  const visible = new Set(visibleSections(role));
  const sections = Object.fromEntries(Object.entries(row.sections ?? {}).filter(([k]) => visible.has(k as SectionKey)));
  const stale = new Set<string>(row.stale_sections ?? []);
  if (latestDoc) {
    for (const [k, card] of Object.entries(sections) as Array<[SectionKey, { generated_at?: string }]>) {
      if (SECTION_BY_KEY[k]?.documentDependent && card.generated_at && card.generated_at < latestDoc && !(row.locked_sections ?? []).includes(k)) stale.add(k);
    }
  }
  return {
    ...row,
    sections,
    stale_sections: [...stale].filter((k) => visible.has(k as SectionKey)),
    comments: (row.comments ?? []).filter((c: { section: string }) => visible.has(c.section as SectionKey)),
    visible_sections: [...visible],
    latest_document_at: latestDoc,
  };
}

async function loadRun(id: string) {
  const { data, error } = await db().from("intelligence_runs").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`intelligence_runs: ${error.message}`);
  if (!data) throw new NotFoundError("Intelligence run not found");
  return data;
}

export default createHandler({
  methods: ["GET", "POST"],
  requireAuth: true,
  handle: async ({ req, body, query, user }) => {
    if (!user) throw new ForbiddenError("Sign in required");

    if (req.method === "GET") {
      const q = querySchema.parse(query ?? {});
      const { data } = await db().from("intelligence_runs").select("*").eq("deal_id", q.deal_id).eq("run_id", q.run_id).order("created_at", { ascending: false }).limit(1);
      const row = data?.[0];
      if (!row) return { run: null, visible_sections: visibleSections(user.role) };
      return { run: present(row, user.role, await latestDocumentAt(q.deal_id)) };
    }

    const input = bodySchema.parse(body ?? {});
    const actor = displayName(user);

    if (input.action === "generate" || input.action === "regenerate") {
      if (!WRITERS.includes(user.role)) throw new ForbiddenError("Generating intelligence requires a writer role");
      if (!aiAvailable()) throw new BadRequestError("AI is not configured (ANTHROPIC_API_KEY missing).");
      const p089 = { inbound: input.inbound ?? null, counterpartyRole: input.counterparty_role, recipientName: input.recipient_name ?? null };
      if (input.action === "generate") {
        return startIntelligenceRun({ dealId: input.deal_id, runId: input.run_id, createdBy: actor, ...p089 });
      }
      const row = await loadRun(input.id);
      const locked = new Set<string>(row.locked_sections ?? []);
      const only = input.sections.filter((k) => !locked.has(k));
      if (!only.length) throw new BadRequestError("Every requested section is locked. Unlock it to regenerate.");
      await db().from("intelligence_runs").update({ status: "queued" }).eq("id", row.id);
      const jobId = await enqueue("intelligence-run", { intelligence_run_id: row.id, only, p089 }, { createdBy: actor });
      return { job_id: jobId, sections: only };
    }

    const row = await loadRun(input.id);
    if (!visibleSections(user.role).includes("section" in input ? input.section : "1")) throw new ForbiddenError("That section is not visible to your role");

    if (input.action === "lock") {
      if (!WRITERS.includes(user.role)) throw new ForbiddenError("Locking requires a writer role");
      const locked = new Set<string>(row.locked_sections ?? []);
      if (input.locked) locked.add(input.section);
      else locked.delete(input.section);
      await db().from("intelligence_runs").update({ locked_sections: [...locked] }).eq("id", row.id);
      return { locked_sections: [...locked] };
    }

    if (input.action === "comment") {
      const comments = [...(row.comments ?? []), { section: input.section, by: actor, at: new Date().toISOString(), text: input.text }];
      await db().from("intelligence_runs").update({ comments }).eq("id", row.id);
      return { comments };
    }

    // action: "log"
    if (!PARTNER_MANAGERS.includes(user.role)) throw new ForbiddenError("Writing to the Negotiation Log is for partners");
    const logRow = row.sections?.["19"]?.data?.log_row as LogRow | undefined;
    if (!logRow) throw new BadRequestError("Section 19 has no log row yet. Generate the Negotiation Engine first.");
    if (row.sections?.["17"]?.data?.send_enabled === false) throw new BadRequestError("Gate check has a FAIL: fix the draft before logging the exchange.");
    return writeNegotiationLog({ dealId: row.deal_id, intelligenceRunId: row.id, row: logRow, actor });
  },
});

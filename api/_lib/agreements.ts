/**
 * Investors Agreement: signatures and the signed copy.
 *
 * The portal renders the agreement from lib/core/investor-agreement.ts and
 * sends back the SHA-256 of the text it showed. The server renders the same
 * text from the submitted details and refuses the signature unless the hashes
 * match, so what is stored is provably what the partner read.
 */
import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { InternalError } from "../../lib/core/errors.js";
import { adminClient } from "../../lib/data/supabase/client.js";
import { INVESTORS_AGREEMENT, longDate, poundsText } from "../../lib/core/investor-agreement.js";

export const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

export interface AgreementSignature {
  id: string;
  investor_id: string;
  agreement_key: string;
  version: number;
  draft: boolean;
  agreement_date: string;
  body: string;
  text_sha256: string;
  signed_name: string;
  signer_entity: string | null;
  signer_address: string;
  pledge_pence: number;
  signed_at: string;
  ip: string | null;
  user_agent: string | null;
  countersigned_name: string | null;
  countersigned_by_email: string | null;
  countersigned_at: string | null;
}

/** Every signature a partner has made, newest version first. */
export async function signaturesFor(investorId: string): Promise<AgreementSignature[]> {
  const { data, error } = await adminClient()
    .from("investor_agreement_signatures")
    .select("*")
    .eq("investor_id", investorId)
    .eq("agreement_key", INVESTORS_AGREEMENT.key)
    .order("version", { ascending: false });
  if (error) throw new InternalError(`investor_agreement_signatures: ${error.message}`);
  return (data ?? []) as AgreementSignature[];
}

/** Has the partner signed the version in force now? */
export async function hasSignedCurrent(investorId: string): Promise<boolean> {
  const { data, error } = await adminClient()
    .from("investor_agreement_signatures")
    .select("id")
    .eq("investor_id", investorId)
    .eq("agreement_key", INVESTORS_AGREEMENT.key)
    .eq("version", INVESTORS_AGREEMENT.version)
    .limit(1);
  if (error) throw new InternalError(`investor_agreement_signatures: ${error.message}`);
  return Boolean(data?.length);
}

/** First IP from the proxy chain, and the user agent. */
export function requestOrigin(req: any): { ip: string | null; userAgent: string | null } {
  const headers = req?.headers ?? {};
  const pick = (v: unknown) => (Array.isArray(v) ? v[0] : typeof v === "string" ? v : undefined);
  const forwarded = pick(headers["x-forwarded-for"]);
  return {
    ip: forwarded ? forwarded.split(",")[0].trim() || null : null,
    userAgent: pick(headers["user-agent"]) ?? null,
  };
}

// ─── The signed copy ───────────────────────────────────────────────────────

/** Standard PDF fonts only carry Latin-1. */
const latin1 = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (!para.trim()) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) {
        line = next;
      } else {
        if (line) out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

/**
 * The partner's signed copy: the exact stored text, then a signature page
 * with the typed signature, when and where it was made, the text's SHA-256 and
 * the countersignature (or that it is awaited).
 */
export async function signedAgreementPdf(sig: AgreementSignature): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Investors Agreement v${sig.version} - ${latin1(sig.signed_name)}`);
  pdf.setAuthor("Aysan Capital Partners");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const W = 595.28;
  const H = 841.89;
  const M = 56;
  const size = 10;
  const lead = 14;
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;

  const footer = (p: PDFPage) =>
    p.drawText(latin1(`Investors Agreement v${sig.version} · SHA-256 ${sig.text_sha256.slice(0, 16)}...`), {
      x: M,
      y: 28,
      size: 7,
      font,
      color: rgb(0.45, 0.45, 0.45),
    });
  footer(page);

  const write = (text: string, opts: { f?: PDFFont; s?: number } = {}) => {
    const f = opts.f ?? font;
    const s = opts.s ?? size;
    for (const line of wrap(latin1(text), f, s, W - 2 * M)) {
      if (y < M + lead) {
        page = pdf.addPage([W, H]);
        footer(page);
        y = H - M;
      }
      if (line) page.drawText(line, { x: M, y, size: s, font: f, color: rgb(0.1, 0.1, 0.1) });
      y -= s === size ? lead : s + 6;
    }
  };

  if (sig.draft) {
    write("DRAFT TEMPLATE - SIGNED FOR TESTING ONLY - NOT A BINDING AGREEMENT", { f: bold, s: 9 });
    y -= 6;
  }

  // Section headings are the all-capital lines of the stored text.
  for (const line of sig.body.split("\n")) {
    const heading = line.length > 0 && line === line.toUpperCase() && /[A-Z]/.test(line);
    write(line, heading ? { f: bold } : {});
  }

  // Signature page.
  page = pdf.addPage([W, H]);
  footer(page);
  y = H - M;
  write("EXECUTION", { f: bold, s: 12 });
  y -= 6;
  write("SIGNED by the INVESTOR", { f: bold });
  write(`Name: ${sig.signed_name}`);
  if (sig.signer_entity) write(`Entity: ${sig.signer_entity}`);
  write(`Address: ${sig.signer_address}`);
  write(`Pledge Amount: ${poundsText(Number(sig.pledge_pence))}`);
  write(`Signature: /${sig.signed_name}/ (typed electronically in the Aysan Capital Partners portal)`);
  write(`Signed at: ${sig.signed_at.replace("T", " ").slice(0, 19)} UTC`);
  if (sig.ip) write(`From: ${sig.ip}`);
  if (sig.user_agent) write(`Device: ${sig.user_agent}`);
  y -= 10;
  write("SIGNED for and on behalf of the SPONSOR", { f: bold });
  if (sig.countersigned_at) {
    write(`Name: ${sig.countersigned_name}`);
    write("Position: Principal / Managing Director");
    write(`Countersigned at: ${sig.countersigned_at.replace("T", " ").slice(0, 19)} UTC`);
  } else {
    write("Awaiting countersignature.");
  }
  y -= 10;
  write("Integrity", { f: bold });
  write(
    `The agreement text above is stored exactly as the Investor was shown it. Its SHA-256 fingerprint is ${sig.text_sha256}. Agreement dated ${longDate(sig.agreement_date)}.`,
  );

  return pdf.save();
}

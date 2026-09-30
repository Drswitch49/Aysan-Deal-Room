/**
 * Watermarked, numbered copies of Offer documents.
 *
 * Offer documents (brief, memorandum, term sheet) are view only, and each
 * partner reads their own copy: every page carries their name, email, copy
 * number and date. The copy is built once per partner per document version,
 * stored as an authenticated asset, and logged in investor_document_copies,
 * which is the issue register (partner, version, copy number, date).
 *
 * If a file cannot be stamped (an encrypted or damaged PDF) the partner gets an
 * error, never the unmarked original.
 */
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { ConflictError, InternalError } from "../../lib/core/errors.js";
import { deleteAsset, downloadUrl, uploadPdfBuffer } from "../../lib/core/cloudinary.js";
import { adminClient } from "../../lib/data/supabase/client.js";
import type { InvestorScope } from "./investor-context.js";

/** Standard PDF fonts only carry Latin-1; anything else would throw mid-stamp. */
const latin1 = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");

export async function stampPdf(bytes: Uint8Array, lines: { diagonal: string; footer: string }): Promise<Uint8Array> {
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(bytes);
  } catch {
    throw new ConflictError(
      "This offer document cannot be watermarked (the PDF is encrypted or damaged). Ask ACP to replace it with a standard PDF.",
    );
  }
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const diagonal = latin1(lines.diagonal);
  const footer = latin1(lines.footer);

  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    const size = Math.max(12, Math.min(28, width / 26));
    const textWidth = font.widthOfTextAtSize(diagonal, size);
    const angle = Math.atan2(height, width);
    // Centre the diagonal line on the page.
    const x = width / 2 - (Math.cos(angle) * textWidth) / 2;
    const y = height / 2 - (Math.sin(angle) * textWidth) / 2;
    page.drawText(diagonal, {
      x,
      y,
      size,
      font,
      // Mid grey reads on ACP's navy pages and on white ones alike.
      color: rgb(0.55, 0.55, 0.55),
      opacity: 0.32,
      rotate: degrees((angle * 180) / Math.PI),
    });
    page.drawText(footer, { x: 24, y: 12, size: 7, font, color: rgb(0.55, 0.55, 0.55) });
  }
  return pdf.save();
}

interface OfferDoc {
  id: string;
  title: string;
  version: number;
  cloudinary_public_id: string;
  cloudinary_resource_type: string | null;
  file_format: string | null;
}

/** A two-minute link to this partner's own watermarked copy, building it on first open. */
export async function partnerCopyUrl(doc: OfferDoc, scope: InvestorScope): Promise<{ url: string; copyNo: number }> {
  const db = adminClient();
  const existing = await db
    .from("investor_document_copies")
    .select("copy_no, cloudinary_public_id, cloudinary_resource_type")
    .eq("document_id", doc.id)
    .eq("investor_id", scope.investorId)
    .maybeSingle();
  if (existing.error) throw new InternalError(`investor_document_copies: ${existing.error.message}`);
  if (existing.data) return { url: copyLink(existing.data.cloudinary_public_id), copyNo: existing.data.copy_no };

  const resourceType = (doc.cloudinary_resource_type ?? "image") as "image" | "raw" | "video";
  const source = downloadUrl(doc.cloudinary_public_id, {
    resourceType,
    format: resourceType === "raw" ? "" : (doc.file_format ?? "pdf"),
    expiresInSeconds: 120,
  });
  const res = await fetch(source);
  if (!res.ok) throw new InternalError(`Could not read the offer document (${res.status})`);
  const original = new Uint8Array(await res.arrayBuffer());

  // Two attempts: a concurrent first open by another partner can take the same number.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: last } = await db
      .from("investor_document_copies")
      .select("copy_no")
      .eq("document_id", doc.id)
      .order("copy_no", { ascending: false })
      .limit(1)
      .maybeSingle();
    const copyNo = (last?.copy_no ?? 0) + 1;
    const issued = new Date().toISOString().slice(0, 10);

    const stamped = await stampPdf(original, {
      diagonal: `${scope.name} · Copy ${copyNo} · Private and confidential`,
      footer: `Copy ${copyNo} of ${doc.title} (v${doc.version}) · Issued to ${scope.name}, ${scope.email}, on ${issued} · View only. Not for onward distribution.`,
    });
    const asset = await uploadPdfBuffer(stamped, { folder: "aysan-deal-room/partner-copies" });

    const { error } = await db.from("investor_document_copies").insert({
      document_id: doc.id,
      investor_id: scope.investorId,
      copy_no: copyNo,
      cloudinary_public_id: asset.publicId,
      cloudinary_resource_type: asset.resourceType,
    });
    if (!error) return { url: copyLink(asset.publicId), copyNo };

    await deleteAsset(asset.publicId, asset.resourceType).catch(() => undefined);
    // The same partner opened it twice at once: use the copy that won.
    const again = await db
      .from("investor_document_copies")
      .select("copy_no, cloudinary_public_id")
      .eq("document_id", doc.id)
      .eq("investor_id", scope.investorId)
      .maybeSingle();
    if (again.data) return { url: copyLink(again.data.cloudinary_public_id), copyNo: again.data.copy_no };
  }
  throw new InternalError("Could not issue a numbered copy of this document. Try again.");
}

const copyLink = (publicId: string) =>
  downloadUrl(publicId, { resourceType: "image", format: "pdf", expiresInSeconds: 120, attachment: false });

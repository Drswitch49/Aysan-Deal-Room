/**
 * Verify + repair the Cloudinary rehost (Phase 1b QA).
 *
 * Some Google Drive links serve an HTML viewer page to server-side fetchers,
 * so a "successful" rehost may have stored HTML instead of the real file.
 * This script:
 *   1. Downloads the first bytes of every rehosted asset (fresh signed URL)
 *   2. Classifies by magic bytes (%PDF, PK/zip=docx-xlsx, HTML)
 *   3. For bad assets: re-downloads the source from the legacy link in Node
 *      (follows Drive's redirect/confirm flow), verifies the bytes, re-uploads
 *      to Cloudinary as base64 data, and updates the row.
 *
 * Run: node --env-file=.env --import tsx scripts/etl/verify-rehost.ts [--fix]
 */
import { query, updateRow, closeDb } from "./_db.js";
import { downloadUrl } from "../../lib/core/cloudinary.js";
import { v2 as cloudinary } from "cloudinary";

const FIX = process.argv.includes("--fix");

type Kind = "pdf" | "zip-office" | "html" | "empty" | "other" | "fetch-failed";

function classify(bytes: Buffer): Kind {
  if (bytes.length === 0) return "empty";
  const head = bytes.subarray(0, 512).toString("latin1");
  if (head.startsWith("%PDF")) return "pdf";
  if (head.startsWith("PK")) return "zip-office";
  if (/^\s*<!doctype html|^\s*<html/i.test(head) || head.toLowerCase().includes("<html")) return "html";
  return "other";
}

async function fetchHead(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf;
  } catch {
    return null;
  }
}

/** Download a Google Drive file properly (handles the confirm/scan flow). */
async function downloadDrive(url: string): Promise<Buffer | null> {
  const m = url.match(/drive\.google\.com\/file\/d\/([^/]+)/) ?? url.match(/[?&]id=([^&]+)/);
  const direct = m ? `https://drive.google.com/uc?export=download&id=${m[1]}` : url;
  let buf = await fetchHead(direct);
  if (!buf) return null;
  if (classify(buf) === "html") {
    // virus-scan interstitial: extract confirm link
    const html = buf.toString("utf8");
    const confirm = html.match(/href="(\/uc\?export=download[^"]*confirm[^"]*)"/)?.[1]
      ?? html.match(/action="([^"]*usercontent[^"]*)"/)?.[1];
    if (confirm) {
      const next = confirm.startsWith("http") ? confirm.replace(/&amp;/g, "&") : `https://drive.google.com${confirm.replace(/&amp;/g, "&")}`;
      buf = await fetchHead(next);
    }
    // docs.google.com export
    const dm = url.match(/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([^/]+)/);
    if ((!buf || classify(buf) === "html") && dm) {
      buf = await fetchHead(`https://docs.google.com/${dm[1]}/d/${dm[2]}/export?format=pdf`);
    }
  }
  return buf && classify(buf) !== "html" ? buf : null;
}

async function reupload(publicId: string, data: Buffer, kind: Kind): Promise<void> {
  const b64 = `data:${kind === "pdf" ? "application/pdf" : "application/octet-stream"};base64,${data.toString("base64")}`;
  await cloudinary.uploader.upload(b64, {
    public_id: publicId,
    resource_type: kind === "pdf" ? "image" : "raw",
    type: "authenticated",
    overwrite: true,
    invalidate: true,
  });
}

async function main() {
  const rows = await query<{ id: string; document_name: string; cloudinary_public_id: string; legacy_drive_link: string | null }>(
    `select id, document_name, cloudinary_public_id, legacy_drive_link
       from documents where cloudinary_public_id is not null`,
  );
  console.log(`Verifying ${rows.length} rehosted documents...${FIX ? " (fix mode)" : " (report only)"}\n`);

  const counts: Record<string, number> = {};
  let fixed = 0, unfixable = 0;

  for (const row of rows) {
    // try image then raw via API-key-signed download URLs
    let bytes: Buffer | null = null;
    for (const rt of ["image", "raw"] as const) {
      bytes = await fetchHead(downloadUrl(row.cloudinary_public_id, { resourceType: rt }));
      if (bytes) break;
    }
    const kind: Kind = bytes ? classify(bytes) : "fetch-failed";
    counts[kind] = (counts[kind] ?? 0) + 1;

    if ((kind === "html" || kind === "fetch-failed" || kind === "empty") && FIX) {
      if (!row.legacy_drive_link) { unfixable++; continue; }
      const real = await downloadDrive(row.legacy_drive_link);
      if (!real) {
        console.log(`  ✗ unfixable: ${row.document_name}`);
        unfixable++;
        continue;
      }
      const realKind = classify(real);
      await reupload(row.cloudinary_public_id, real, realKind);
      await updateRow("documents", row.id, {});
      console.log(`  ✓ re-rehosted: ${row.document_name} (${realKind}, ${real.length} bytes)`);
      fixed++;
    }
  }

  console.log(`\n── Verification ──`);
  for (const [k, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
  if (FIX) console.log(`  fixed: ${fixed}, unfixable: ${unfixable}`);
  await closeDb();
}

main().catch((err) => {
  console.error("verify-rehost failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

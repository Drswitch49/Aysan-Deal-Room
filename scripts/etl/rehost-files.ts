/**
 * Rehost migrated file links to Cloudinary (Phase 1b — files).
 *
 * Walks Supabase rows that still point at a legacy public host (filebin/tmpfiles/
 * Drive), fetches each via Cloudinary, and updates the row with the Cloudinary
 * public_id + secure URL. Ephemeral hosts will have expired — those are reported
 * as dead links, not silently lost.
 *
 *   node --env-file=.env --import tsx scripts/etl/rehost-files.ts
 */
import { query, updateRow, closeDb } from "./_db.js";
import { uploadFromUrl } from "../../lib/core/cloudinary.js";

interface Target {
  label: string;
  table: string;
  urlColumn: string;
  folder: string;
  // rows needing rehost: has a legacy URL, no cloudinary id yet
  select: string;
}

const TARGETS: Target[] = [
  {
    label: "documents",
    table: "documents",
    urlColumn: "legacy_drive_link",
    folder: "aysan-deal-room/documents",
    select: `select id, legacy_drive_link as url from documents where legacy_drive_link is not null and cloudinary_public_id is null and deleted_at is null`,
  },
  {
    label: "im_review_documents",
    table: "im_review_documents",
    urlColumn: "legacy_file_url",
    folder: "aysan-deal-room/im",
    select: `select id, legacy_file_url as url from im_review_documents where legacy_file_url is not null and cloudinary_public_id is null and deleted_at is null`,
  },
  {
    label: "deals.deal_files_url",
    table: "deals",
    urlColumn: "deal_files_url",
    folder: "aysan-deal-room/deal-files",
    select: `select id, deal_files_url as url from deals where deal_files_url is not null and deal_files_cloudinary_id is null and deleted_at is null`,
  },
];

function host(u: string): string {
  try { return new URL(u).host; } catch { return "(invalid)"; }
}

/**
 * Convert a shareable URL into a directly-fetchable one where possible.
 * Google Drive "view" links serve an HTML preview, not the bytes.
 * Returns null for URLs that are web pages, not files (e.g. listing sites).
 */
function toDirectUrl(u: string): string | null {
  const h = host(u);
  // Google Drive file share → direct download
  const drive = u.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (drive) return `https://drive.google.com/uc?export=download&id=${drive[1]}`;
  const driveOpen = u.match(/drive\.google\.com\/open\?id=([^&]+)/);
  if (driveOpen) return `https://drive.google.com/uc?export=download&id=${driveOpen[1]}`;
  // Google Docs/Sheets → export as PDF
  const docs = u.match(/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([^/]+)/);
  if (docs) {
    const kind = docs[1] === "spreadsheets" ? "spreadsheets" : docs[1] === "presentation" ? "presentation" : "document";
    return `https://docs.google.com/${kind}/d/${docs[2]}/export?format=pdf`;
  }
  // Business-listing web pages are not files — skip.
  if (/businessesforsale\.com|daltonsbusiness\.com|businessbuyers\.co\.uk/.test(h)) return null;
  // filebin/tmpfiles and anything else: try as-is.
  return u;
}

async function main() {
  const deadByHost = new Map<string, number>();
  let totalOk = 0, totalDead = 0;

  for (const t of TARGETS) {
    let rows: Array<{ id: string; url: string }>;
    try {
      rows = await query<{ id: string; url: string }>(t.select);
    } catch (err) {
      console.log(`  (skip ${t.label}: ${err instanceof Error ? err.message : err})`);
      continue;
    }
    if (rows.length === 0) { console.log(`  ${t.label}: nothing to rehost`); continue; }

    let ok = 0, dead = 0, skipped = 0;
    for (const row of rows) {
      const direct = toDirectUrl(row.url);
      if (!direct) { skipped++; continue; }
      try {
        const asset = await uploadFromUrl(direct, { folder: t.folder });
        if (t.table === "deals") {
          await updateRow("deals", row.id, { deal_files_cloudinary_id: asset.publicId, deal_files_secure_url: asset.secureUrl });
        } else {
          await updateRow(t.table, row.id, { cloudinary_public_id: asset.publicId, file_url: asset.secureUrl });
        }
        ok++;
      } catch {
        dead++;
        deadByHost.set(host(row.url), (deadByHost.get(host(row.url)) ?? 0) + 1);
      }
    }
    totalOk += ok; totalDead += dead;
    console.log(`  ${t.label}: ${ok} rehosted, ${dead} dead, ${skipped} skipped-not-a-file (of ${rows.length})`);
  }

  console.log(`\n── Survivors ──`);
  console.log(`  rehosted to Cloudinary: ${totalOk}`);
  console.log(`  dead links (expired/unreachable): ${totalDead}`);
  if (deadByHost.size) {
    console.log(`  dead by host:`);
    for (const [h, n] of [...deadByHost.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${n.toString().padStart(4)}  ${h}`);
    }
  }
  await closeDb();
}

main().catch((err) => {
  console.error("rehost failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

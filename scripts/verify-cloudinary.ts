/**
 * One-off: verify Cloudinary credentials + the authenticated upload/sign flow.
 * Run: node --env-file=.env --import tsx scripts/verify-cloudinary.ts
 */
import { uploadFromUrl, signedUrl, deleteAsset } from "../lib/core/cloudinary.js";

async function main() {
  const sample = "https://res.cloudinary.com/demo/image/upload/sample.jpg";
  console.log("Uploading sample as authenticated asset...");
  const asset = await uploadFromUrl(sample, { folder: "aysan-deal-room/_verify" });
  console.log("  publicId:", asset.publicId);
  console.log("  bytes:", asset.bytes, "format:", asset.format);

  const url = signedUrl(asset.publicId, { resourceType: "image", expiresInSeconds: 120 });
  console.log("  signed URL (120s):", url.slice(0, 90) + "...");

  await deleteAsset(asset.publicId, "image");
  console.log("  cleaned up. Cloudinary OK ✓");
}

main().catch((err) => {
  console.error("cloudinary verify failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

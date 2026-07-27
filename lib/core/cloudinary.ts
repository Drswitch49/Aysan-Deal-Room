/**
 * Cloudinary integration (server-only).
 *
 * All deal files live in Cloudinary, replacing the public filebin.net / tmpfiles.org
 * hosts. Confidential documents are stored as `authenticated` assets and served
 * via short-lived SIGNED URLs — never publicly addressable.
 *
 * Never import this in the browser bundle; it holds the API secret.
 */

import { v2 as cloudinary } from "cloudinary";
import { getServerEnv } from "./env.js";

let configured = false;
function ensureConfigured() {
  if (configured) return;
  const env = getServerEnv();
  if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
    throw new Error(
      "Cloudinary is not configured (CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET).",
    );
  }
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  configured = true;
}

export interface UploadedAsset {
  publicId: string;
  secureUrl: string; // canonical delivery URL (signed on demand for authenticated assets)
  resourceType: string;
  format?: string;
  bytes?: number;
}

const DEFAULT_FOLDER = "aysan-deal-room";

/**
 * Upload a file from a remote URL (used by the ETL to rehost filebin/tmpfiles/Drive
 * links) or any Cloudinary-fetchable source. Stored as an authenticated asset.
 */
export async function uploadFromUrl(
  url: string,
  opts: { folder?: string; publicId?: string } = {},
): Promise<UploadedAsset> {
  ensureConfigured();
  const res = await cloudinary.uploader.upload(url, {
    folder: opts.folder ?? DEFAULT_FOLDER,
    public_id: opts.publicId,
    resource_type: "auto",
    type: "authenticated",
    overwrite: false,
    unique_filename: !opts.publicId,
  });
  return {
    publicId: res.public_id,
    secureUrl: res.secure_url,
    resourceType: res.resource_type,
    format: res.format,
    bytes: res.bytes,
  };
}

/**
 * API-key-signed download URL for server-side access to an authenticated asset.
 * Works even while the account's "Allow delivery of PDF and ZIP files" security
 * toggle is off (which 401s normal delivery URLs for PDFs on new accounts).
 * Use THIS for backend fetches; `signedUrl` is for browser delivery and needs
 * that toggle enabled for PDFs.
 */
export function downloadUrl(
  publicId: string,
  opts: { format?: string; resourceType?: "image" | "video" | "raw"; expiresInSeconds?: number } = {},
): string {
  ensureConfigured();
  return cloudinary.utils.private_download_url(publicId, opts.format ?? "", {
    resource_type: opts.resourceType ?? "image",
    type: "authenticated",
    expires_at: Math.floor(Date.now() / 1000) + (opts.expiresInSeconds ?? 600),
  });
}

/**
 * Generate a short-lived signed delivery URL for an authenticated asset.
 * NOTE: for PDF/ZIP delivery the Cloudinary account setting
 * "Security → Allow delivery of PDF and ZIP files" must be enabled.
 * @param expiresInSeconds default 1 hour.
 */
export function signedUrl(
  publicId: string,
  opts: { resourceType?: "image" | "video" | "raw"; expiresInSeconds?: number } = {},
): string {
  ensureConfigured();
  const expiresAt = Math.floor(Date.now() / 1000) + (opts.expiresInSeconds ?? 3600);
  return cloudinary.url(publicId, {
    resource_type: opts.resourceType ?? "image",
    type: "authenticated",
    sign_url: true,
    secure: true,
    expires_at: expiresAt,
  });
}

/**
 * Build a signed-upload payload for direct browser → Cloudinary uploads (used by
 * the app's upload endpoint so files never transit our server).
 */
export function signUploadParams(params: Record<string, string | number>): {
  signature: string;
  timestamp: number;
  apiKey: string;
  cloudName: string;
} {
  ensureConfigured();
  const env = getServerEnv();
  const timestamp = Math.floor(Date.now() / 1000);
  const toSign = { timestamp, ...params };
  const signature = cloudinary.utils.api_sign_request(toSign, env.CLOUDINARY_API_SECRET!);
  return {
    signature,
    timestamp,
    apiKey: env.CLOUDINARY_API_KEY!,
    cloudName: env.CLOUDINARY_CLOUD_NAME!,
  };
}

export async function deleteAsset(publicId: string, resourceType = "image"): Promise<void> {
  ensureConfigured();
  await cloudinary.uploader.destroy(publicId, { resource_type: resourceType, type: "authenticated" });
}

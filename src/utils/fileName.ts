/**
 * A human label for the file behind a URL.
 *
 * The deal inbox's "paste a URL" box used to label attachments with
 * `url.split("/").pop()`. For a Google Drive share link
 * (…/file/d/<id>/view?usp=sharing) that yields the string "view?usp=sharing",
 * which is how live deals ended up with an attachment named after a query
 * string. A share link has no filename in it at all, so the honest answer is to
 * name the host rather than invent one from the path.
 */

/** Trailing path segments that are viewer verbs, not file names. */
const VIEWER_SEGMENTS = new Set(["view", "edit", "preview", "open", "download", "d", "file", "s"]);

const HOST_LABELS: Array<[string, string]> = [
  ["drive.google.com", "Google Drive link"],
  ["docs.google.com", "Google Docs link"],
  ["dropbox.com", "Dropbox link"],
  ["onedrive.live.com", "OneDrive link"],
  ["1drv.ms", "OneDrive link"],
  ["sharepoint.com", "SharePoint link"],
  ["box.com", "Box link"],
  ["wetransfer.com", "WeTransfer link"],
];

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function fileNameFromUrl(url: string, fallback = "Document"): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return fallback;
  }

  // Query and hash are never part of a file name — parsing rather than string
  // splitting is what drops them.
  const segments = parsed.pathname.split("/").filter(Boolean).map(safeDecode);
  const last = segments[segments.length - 1] ?? "";

  const hasExtension = /\.[a-z0-9]{2,5}$/i.test(last);
  if (hasExtension && !VIEWER_SEGMENTS.has(last.toLowerCase())) return last;

  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const known = HOST_LABELS.find(([h]) => host === h || host.endsWith(`.${h}`));
  if (known) return known[1];

  // A bare path segment with no extension is still better than nothing, as long
  // as it carries meaning ("annual-accounts") rather than being a verb or id.
  if (last && !VIEWER_SEGMENTS.has(last.toLowerCase()) && last.length <= 60 && /[a-z]/i.test(last)) {
    return last;
  }

  return host ? `${host} link` : fallback;
}

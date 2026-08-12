/**
 * Shared helpers for the admin client modules.
 *
 * Field-name mapping (legacy Airtable keys → Supabase columns), deal-ref
 * resolution, and the browser→Cloudinary signed-upload helper. These are
 * internal to the admin/* modules and not part of the public admin surface.
 */
import { api, type Paginated } from "../http";

export type Row = Record<string, any>;

/**
 * Lifecycle stage → the status label the UI shows.
 *
 * `stage` is authoritative — it is what the inbox filters, the pill counts and
 * the dashboard all count, and what a transition writes. The legacy `status`
 * text is unreliable: it is null on most migrated rows and frequently
 * contradicts the stage (deals sitting in `inbox` whose status text says
 * "Active"). Display derives from this map; `status` is only a fallback.
 */
export const STAGE_TO_STATUS: Record<string, string> = {
  inbox: "Inbox",
  review: "Review",
  active: "Active",
  archived: "Kill",
};

// ─── Field-name mapping (legacy Airtable keys → Supabase columns) ───────────

export const DEAL_KEY_MAP: Record<string, string> = {
  "Company_Name": "company_name",
  "Company Name": "company_name",
  "Deal Name": "deal_name",
  "Project_Name": "project_name",
  "Industry": "industry",
  "Sector": "sector",
  "Website": "website",
  "Location": "location",
  "Owner": "owner",
  "Analyst": "analyst",
  "Assigned To": "assigned_to",
  "Source": "source",
  "Turnover": "turnover",
  "Revenue": "turnover",
  "EBITDA": "ebitda_gbp",
  "EBITDA_GBP": "ebitda_gbp",
  "Enterprise_Value": "enterprise_value",
  "EV": "enterprise_value",
  "Asking_Price_GBP": "asking_price_gbp",
  "Asking Price": "asking_price_gbp",
  "Stage": "pipeline_stage",
  "Status": "status",
  "Next Action": "next_action",
  "Next_Action": "next_action",
  "Next Action Date": "next_action_date",
  "Next_Action_Date": "next_action_date",
  "Internal_Notes": "internal_notes",
  "Executive_Summary": "executive_summary",
  "Summary": "executive_summary",
  "Business_Description": "business_description",
  "Description": "business_description",
  "Lender_Executive_Summary": "lender_executive_summary",
  "Investment_Highlights": "investment_highlights",
  "Acquisition_Rationale": "acquisition_rationale",
  "Deal_Type": "deal_type",
  "Contact_Email": "contact_email",
  "Contact E-mail": "contact_email",
  "Contact_Phone": "contact_phone",
  "Listing Link": "listing_link",
  "Listing_Link": "listing_link",
  "BROKER": "broker",
  "Broker": "broker",
  "Broker Name": "broker",
  "ACP REF NO": "acp_ref_no",
  "REF No.": "ref_no",
  "REF. NO": "ref_no",
  // camelCase keys used by the deal-detail edit modal (editFields). Without these
  // mapKeys drops every field (camelCase fails its snake_case passthrough regex,
  // and revenue/ebitda would map to non-existent columns) → empty PATCH.
  "companyName": "company_name",
  "projectName": "project_name",
  "revenue": "turnover",
  "ebitda": "ebitda_gbp",
  "enterpriseValue": "enterprise_value",
  "askingPrice": "asking_price_gbp",
  "nextAction": "next_action",
  "nextActionDate": "next_action_date",
  "internalNotes": "internal_notes",
  "businessDescription": "business_description",
  "executiveSummary": "executive_summary",
  // Sourcing & contact. "contactName" is the broker column — the UI labels it
  // Contact throughout, so the form key follows the label, not the column.
  "contactName": "broker",
  "contactEmail": "contact_email",
  "contactPhone": "contact_phone",
  "listingLink": "listing_link",
};

export const DOC_KEY_MAP: Record<string, string> = {
  "Deal_Ref": "deal_id",
  "Document_Name": "document_name",
  "Category": "category",
  "ABL_Critical": "abl_critical",
  "Status": "status",
  "Source": "source",
  "Date_Received": "date_received",
  "Drive_Link": "legacy_drive_link",
  "Expected_Date": "expected_date",
  "Internal_Notes": "internal_notes",
  "Date_Sent_To_Lender": "date_sent_to_lender",
  "Lender_Target": "lender_target",
  "Document_Access": "document_access",
};

export function mapKeys(fields: Row, keyMap: Record<string, string>): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(fields ?? {})) {
    const col = keyMap[k] ?? (/^[a-z0-9_]+$/.test(k) ? k : undefined);
    if (col) out[col] = v;
  }
  return out;
}

export async function resolveDealId(refOrId: string): Promise<string> {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(refOrId)) return refOrId;
  const page = await api.get<Paginated<Row>>(`/api/deals?ref=${encodeURIComponent(refOrId)}`);
  const deal = page.rows[0];
  if (!deal) throw new Error(`Deal not found: ${refOrId}`);
  return deal.id;
}

/**
 * The largest file the document store will take.
 *
 * Cloudinary rejects anything above this with "File size too large. Got N.
 * Maximum is 10485760." — a per-plan ceiling that applies to every resource
 * type, so there is no upload path around it. Checking up front means the user
 * is told which file is too big before they wait out an upload that can only
 * fail, and before an over-sized read runs in the browser.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** What a base64 payload weighs once decoded — without decoding it. */
function base64Bytes(data: string): number {
  const b64 = data.startsWith("data:") ? data.slice(data.indexOf(",") + 1) : data;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

/** Fraction of the file sent so far, 0 → 1. */
export type UploadProgress = (fraction: number) => void;

/**
 * POST the form to Cloudinary, reporting how much of it has gone out.
 *
 * XMLHttpRequest rather than fetch: `fetch` has no way to observe an upload in
 * flight (request streaming is not usable here — Cloudinary does not accept a
 * chunked-encoding body), and `xhr.upload.onprogress` is what lets the IM panel
 * show a real bar rather than a spinner that says nothing for 30 seconds.
 */
function postToCloudinary(url: string, form: FormData, fileName: string, onProgress?: UploadProgress): Promise<Row> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.responseType = "json";

    if (onProgress) {
      // Only the request body is measurable, and only when the browser knows
      // its total; a non-computable event means "no idea yet", not zero.
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) onProgress(Math.min(1, e.loaded / e.total));
      };
      // Not every browser fires a final 100% progress event, so mark the body
      // as fully sent here. 1 means "all bytes gone", not "Cloudinary is done" —
      // the caller decides how to show the wait that follows.
      xhr.upload.onload = () => onProgress(1);
    }

    xhr.onload = () => {
      // responseType "json" gives a parsed body on any status; a non-JSON error
      // page comes back as null.
      const payload = (xhr.response ?? null) as Row | null;
      if (xhr.status >= 200 && xhr.status < 300 && payload?.public_id) {
        resolve(payload);
        return;
      }
      reject(new Error(payload?.error?.message ?? `Upload of "${fileName}" failed (${xhr.status}).`));
    };
    xhr.onerror = () =>
      reject(new Error(`Could not reach the file store to upload "${fileName}". Check your connection and try again.`));
    xhr.onabort = () => reject(new Error(`Upload of "${fileName}" was cancelled.`));

    xhr.send(form);
  });
}

/**
 * Direct browser → Cloudinary upload via a server-signed payload.
 *
 * Pass the `File` itself wherever possible: it goes up as multipart binary,
 * which is what makes a large IM upload feel instant instead of stalling the
 * tab while FileReader turns 10 MB of PDF into 13 MB of base64 in memory. A
 * base64 string (raw, or a full `data:<mime>;base64,…` URI as
 * FileReader.readAsDataURL produces) is still accepted for the callers that
 * only hold one.
 *
 * `onProgress` is called with the fraction sent so far, and is the only honest
 * signal available — the two server round-trips either side of the transfer
 * (signing, then recording the row) are not part of it.
 */
export async function uploadToCloudinary(
  fileName: string,
  fileType: string,
  file: Blob | string,
  folder: string,
  onProgress?: UploadProgress,
) {
  const size = typeof file === "string" ? base64Bytes(file) : file.size;
  if (size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `"${fileName}" is ${formatBytes(size)} — larger than the ${formatBytes(MAX_UPLOAD_BYTES)} limit on the document store. Compress or split the file and try again.`,
    );
  }

  const signed = await api.post<Row>("/api/documents/sign-upload", { folder });

  const form = new FormData();
  if (typeof file === "string") {
    // Cloudinary accepts a data-URI as the `file` param directly, which avoids
    // any client-side base64 decoding.
    form.append("file", file.startsWith("data:") ? file : `data:${fileType || "application/octet-stream"};base64,${file}`);
  } else {
    form.append("file", file, fileName);
  }
  form.append("api_key", signed.apiKey);
  form.append("timestamp", String(signed.timestamp));
  form.append("signature", signed.signature);
  form.append("folder", signed.folder);
  form.append("type", "authenticated");

  const payload = await postToCloudinary(
    `https://api.cloudinary.com/v1_1/${signed.cloudName}/auto/upload`,
    form,
    fileName,
    onProgress,
  );
  return { publicId: payload.public_id as string, secureUrl: payload.secure_url as string };
}

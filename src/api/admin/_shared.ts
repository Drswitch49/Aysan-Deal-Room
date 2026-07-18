/**
 * Shared helpers for the admin client modules.
 *
 * Field-name mapping (legacy Airtable keys → Supabase columns), deal-ref
 * resolution, and the browser→Cloudinary signed-upload helper. These are
 * internal to the admin/* modules and not part of the public admin surface.
 */
import { api, type Paginated } from "../http";

export type Row = Record<string, any>;

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
  "Business_Description": "business_description",
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

/** Direct browser → Cloudinary upload via a server-signed payload.
 *  Accepts either a raw base64 string OR a full `data:<mime>;base64,…` URI —
 *  FileReader.readAsDataURL produces the latter, and atob() would throw on the
 *  `data:…;base64,` prefix, so we strip it here (this was breaking uploads). */
export async function uploadToCloudinary(fileName: string, fileType: string, fileDataBase64: string, folder: string) {
  const signed = await api.post<Row>("/api/documents/sign-upload", { folder });

  // Cloudinary accepts a data-URI as the `file` param directly — simplest and
  // avoids any client-side base64 decoding entirely.
  const dataUri = fileDataBase64.startsWith("data:")
    ? fileDataBase64
    : `data:${fileType || "application/octet-stream"};base64,${fileDataBase64}`;

  const form = new FormData();
  form.append("file", dataUri);
  form.append("api_key", signed.apiKey);
  form.append("timestamp", String(signed.timestamp));
  form.append("signature", signed.signature);
  form.append("folder", signed.folder);
  form.append("type", "authenticated");

  const res = await fetch(`https://api.cloudinary.com/v1_1/${signed.cloudName}/auto/upload`, { method: "POST", body: form });
  const payload = await res.json();
  if (!res.ok) throw new Error(payload?.error?.message ?? "Cloudinary upload failed");
  return { publicId: payload.public_id as string, secureUrl: payload.secure_url as string };
}

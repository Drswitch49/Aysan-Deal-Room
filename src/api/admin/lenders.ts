/** Admin client — Lenders. */
import { api, type Paginated } from "../http";
import { clearAirtableCache } from "../airtable";
import { type Row, resolveDealId } from "./_shared";

/** Legacy-shaped lender object (pages read Company_Name etc.). */
function mapLenderLegacy(l: Row, assignments: Row[]): Row {
  return {
    id: l.id,
    Lender_ID: l.lender_ref ?? "",
    Company_Name: l.company_name ?? "",
    Contact_Name: l.contact_name ?? "",
    Email: l.email ?? "",
    Phone: l.phone ?? "",
    Portal_Slug: l.portal_slug ?? "",
    NDA_Approved: Boolean(l.nda_approved),
    Criteria_Pills: l.criteria_pills ?? "",
    Status: l.deleted_at ? "Inactive" : "Active",
    Last_Contact_Date: l.last_contact_date ?? "",
    assignments: assignments
      .filter((a) => a.lender_id === l.id)
      .map((a) => ({
        id: a.id,
        assignmentId: a.assignment_ref ?? a.id,
        dealRef: a.deal_id,
        Deal_Ref: [a.deal_id],
        assignedAt: a.assigned_at ?? a.created_at ?? null,
        ndaApproved: Boolean(a.nda_approved),
      })),
  };
}

export async function fetchAdminLenders(): Promise<any[]> {
  const [lenders, assignments] = await Promise.all([
    api.get<Paginated<Row>>("/api/lenders?limit=200"),
    api.get<Paginated<Row>>("/api/deal-assignments?limit=200").catch(() => ({ rows: [] as Row[] })),
  ]);
  return lenders.rows.map((l) => mapLenderLegacy(l, assignments.rows ?? []));
}

export async function createLender(data: {
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  status?: string;
  criteriaPills?: string;
}) {
  if (!data.email) throw new Error("An email is required — lenders now sign in with email + password.");
  const result = await api.post<Row>("/api/lenders/provision", {
    company_name: data.companyName,
    contact_name: data.contactName,
    email: data.email,
    phone: data.phone,
    criteria_pills: data.criteriaPills,
  });
  clearAirtableCache();
  // Legacy consumers read Airtable-style keys off the returned record.
  return {
    success: true,
    id: result.lender?.id,
    Company_Name: result.lender?.company_name ?? data.companyName,
    Contact_Name: result.lender?.contact_name ?? data.contactName,
    Email: result.lender?.email ?? data.email,
    Portal_Slug: result.portal_slug,
    Portal_Password: result.password,
    lender: result.lender,
    portalSlug: result.portal_slug,
    password: result.password,
  } as Row;
}

export async function assignDealToLender(lenderRecordId: string, dealRef: string, ndaApproved?: boolean) {
  const dealId = await resolveDealId(dealRef);
  return api.post<Row>("/api/deal-assignments", {
    lender_id: lenderRecordId,
    deal_id: dealId,
    nda_approved: ndaApproved ?? false,
  });
}

export async function removeDealAssignment(assignmentId: string) {
  return api.del<Row>(`/api/deal-assignments/${encodeURIComponent(assignmentId)}`);
}

export async function toggleLenderNda(lenderId: string, ndaApproved: boolean) {
  return api.patch<Row>(`/api/lenders/${encodeURIComponent(lenderId)}`, { nda_approved: ndaApproved });
}

export async function resetLenderPassword(lenderRecordId: string) {
  const r = await api.post<{ password: string }>("/api/lenders/reset-password", { lender_id: lenderRecordId });
  return { success: true, password: r.password };
}

/** Portal credentials are now the lender's Supabase account — same as a reset. */
export async function regenerateLenderPortal(lenderRecordId: string) {
  return resetLenderPassword(lenderRecordId);
}

export async function deleteLender(lenderRecordId: string) {
  return api.del<Row>(`/api/lenders/${encodeURIComponent(lenderRecordId)}`);
}

/** Plaintext passcodes no longer exist — reset instead. */
export async function fetchLenderPasscode(_lenderRecordId: string): Promise<string> {
  throw new Error("Passcodes are no longer stored. Use 'Reset password' to issue a new one.");
}

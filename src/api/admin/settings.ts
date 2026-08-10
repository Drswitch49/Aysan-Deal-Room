/** Admin client — auth / settings + outbound email webhooks. */
import { api } from "../http";
import { type Row } from "./_shared";

export async function changeAdminPassword(currentPassword: string, newPassword: string) {
  const res = await fetch("/api/auth/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || "Failed to change password");
  return payload;
}

/** Set your own display name — what the sidebar shows above your role. */
export async function updateDisplayName(name: string): Promise<{ name: string }> {
  const res = await fetch("/api/auth/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error?.message || payload.error || "Failed to save your name");
  return payload.data ?? payload;
}

export async function resetAdminPassword(_masterPasscode: string, _newPassword: string): Promise<Row> {
  throw new Error("Master-passcode resets were removed. Ask an owner to reset your account in Supabase.");
}

export async function verifyIntegration(_integrationId: string): Promise<Row> {
  throw new Error("Integration checks are being rebuilt and are not available yet.");
}

// ─── Outbound email (Make.com delivery scenario) ────────────────────────────

/**
 * Hand a composed email to the server, which forwards it to Make.
 *
 * The composer speaks in lender terms (lenderEmail/body); the webhook contract
 * is recipient/subject/content/type, so the translation happens here — one
 * place, rather than in each caller.
 */
async function sendComposedEmail(type: "LOI" | "Post_meeting_email", data: Row): Promise<Row> {
  const email = String(data.lenderEmail ?? data.email ?? "").trim();
  const content = String(data.body ?? data.content ?? "").trim();
  const subject = String(data.subject ?? "").trim();

  if (!email) throw new Error("A recipient email address is required.");
  if (!subject) throw new Error("A subject is required.");
  if (!content) throw new Error("The email content is empty.");

  return api.post<Row>("/api/webhooks/send-email", {
    email,
    subject,
    content,
    type,
    ...(data.dealId ? { deal_id: String(data.dealId) } : {}),
  });
}

export async function sendLoiWebhook(data: Row): Promise<Row> {
  return sendComposedEmail("LOI", data);
}

export async function sendEmailWebhook(data: Row): Promise<Row> {
  return sendComposedEmail("Post_meeting_email", data);
}

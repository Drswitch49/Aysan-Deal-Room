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

const HEADER_LINE = /^(from|to|date|subject)\s*:/i;
const DOCUMENT_TITLE = /^letter of intent$/i;

/**
 * Drop a letterhead block if one reached the body.
 *
 * `content` is the message, not the document — Make already has the recipient,
 * and the mail service stamps sender and date, so From:/To:/Date: lines at the
 * top are duplicated envelope data. The LOI composer is seeded without them
 * now; the post-meeting follow-up is model-written and can still open with one.
 *
 * Only the contiguous run of header-shaped lines at the very top is removed —
 * scanning stops at the first line that is not one, so a message that mentions
 * "To: …" further down keeps it.
 */
export function stripLetterhead(text: string): string {
  const lines = text.split(/\r?\n/);
  let i = 0;
  let removed = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line === "") { i++; continue; }
    if (HEADER_LINE.test(line) || DOCUMENT_TITLE.test(line)) { i++; removed++; continue; }
    break;
  }
  return removed > 0 ? lines.slice(i).join("\n").trim() : text.trim();
}

/**
 * Hand a composed email to the server, which forwards it to Make.
 *
 * The composer speaks in lender terms (lenderEmail/body); the webhook contract
 * is recipient/subject/content/type, so the translation happens here — one
 * place, rather than in each caller.
 */
async function sendComposedEmail(type: "LOI" | "Post_meeting_email", data: Row): Promise<Row> {
  const email = String(data.lenderEmail ?? data.email ?? "").trim();
  const content = stripLetterhead(String(data.body ?? data.content ?? ""));
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
    ...(data.generatedBy ? { generated_by: String(data.generatedBy) } : {}),
  });
}

export async function sendLoiWebhook(data: Row): Promise<Row> {
  return sendComposedEmail("LOI", data);
}

export async function sendEmailWebhook(data: Row): Promise<Row> {
  return sendComposedEmail("Post_meeting_email", data);
}

/** Admin client — auth / settings + legacy webhooks (not yet ported). */
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

// ─── Legacy webhooks (not yet ported) ───────────────────────────────────────

export async function sendLoiWebhook(_data: Row): Promise<Row> {
  throw new Error("LOI sending is being rebuilt and is not available yet.");
}

export async function sendEmailWebhook(_data: Row): Promise<Row> {
  throw new Error("Email sending is being rebuilt and is not available yet.");
}

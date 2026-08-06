/**
 * Display-name resolution for the signed-in user.
 *
 * The sidebar footer is meant to show a person's name over their role, but it
 * fell back to the raw email address because most auth accounts carry no
 * `user_metadata.full_name` — the Airtable import never populated one, and
 * `profiles.full_name` is null across the board.
 *
 * So resolve a name from wherever the app actually knows one, in order of
 * authority, and only fall back to a formatted email local-part (never the
 * whole address). Results are cached briefly: the session endpoint runs on
 * every page load and this must not add a query each time.
 */
import { adminClient } from "../../lib/data/supabase/client.js";
import type { SessionUser } from "./session.js";

const cache = new Map<string, { name: string; until: number }>();
const TTL_MS = 5 * 60_000;

/** PostgREST `ilike` treats % and _ as wildcards — an email must match literally. */
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Last resort: "lee.coutanche@acp.com" → "Lee Coutanche", "admin@acp.com" →
 * "Admin". Still not the email, which is what the footer must never show.
 */
export function nameFromEmail(email: string | null | undefined): string {
  const local = String(email ?? "").split("@")[0];
  if (!local) return "User";
  const words = local
    .split(/[._\-+]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1));
  return words.join(" ") || "User";
}

/** Drop a cached name — call after the user edits their own. */
export function forgetDisplayName(userId: string): void {
  cache.delete(userId);
}

async function lookup(user: SessionUser): Promise<string | null> {
  const db = adminClient();

  // 1. profiles, linked by auth id (the authoritative staff record).
  const byAuthId = await db.from("profiles").select("full_name").eq("auth_user_id", user.id).limit(1);
  const linked = byAuthId.data?.[0]?.full_name;
  if (typeof linked === "string" && linked.trim()) return linked.trim();

  const email = String(user.email ?? "").trim();
  if (!email) return null;
  const pattern = escapeLike(email);

  // 2. profiles by email (rows imported before the auth link existed).
  const profile = await db.from("profiles").select("full_name").ilike("email", pattern).limit(1);
  const profileName = profile.data?.[0]?.full_name;
  if (typeof profileName === "string" && profileName.trim()) return profileName.trim();

  // 3. the team roster — keeps the footer in step with the HR page, so renaming
  //    someone there fixes their sidebar without any extra sync step.
  const team = await db.from("acp_team").select("name").ilike("email", pattern).is("deleted_at", null).limit(1);
  const teamName = team.data?.[0]?.name;
  if (typeof teamName === "string" && teamName.trim()) return teamName.trim();

  // 4. portal audiences.
  const shareholder = await db.from("shareholders").select("name").ilike("email", pattern).is("deleted_at", null).limit(1);
  const shareholderName = shareholder.data?.[0]?.name;
  if (typeof shareholderName === "string" && shareholderName.trim()) return shareholderName.trim();

  return null;
}

/** Best available display name for a session user. Never returns an email. */
export async function resolveDisplayName(user: SessionUser): Promise<string> {
  if (user.fullName && user.fullName.trim()) return user.fullName.trim();

  const hit = cache.get(user.id);
  if (hit && hit.until > Date.now()) return hit.name;

  let name: string;
  try {
    name = (await lookup(user)) ?? nameFromEmail(user.email);
  } catch {
    // A lookup failure must never break the session response.
    name = nameFromEmail(user.email);
  }
  cache.set(user.id, { name, until: Date.now() + TTL_MS });
  if (cache.size > 500) cache.clear(); // crude bound, same as the token cache
  return name;
}

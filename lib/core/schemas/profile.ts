/** Staff profile schema. Role enum mirrors the Supabase `user_role` type. */
import { z } from "zod";
import { auditFields } from "./common.js";

export const USER_ROLES = [
  "owner", "managing_partner", "partner", "analyst", "hr", "admin", "read_only",
] as const;
export const userRoleSchema = z.enum(USER_ROLES);
export type UserRole = z.infer<typeof userRoleSchema>;

const s = z.string().nullable().optional();

export const profileSchema = z.object({
  ...auditFields,
  email: z.string(),
  full_name: s,
  role: userRoleSchema,
  status: z.string(),
  permissions: s,
  last_login_at: s,
  // legacy_password_hash intentionally omitted (never returned to clients).
});
export type Profile = z.infer<typeof profileSchema>;

export const createProfileSchema = z.object({
  email: z.string().email(),
  full_name: z.string().optional(),
  role: userRoleSchema.default("read_only"),
  status: z.string().default("active"),
}).passthrough();
export type CreateProfileInput = z.infer<typeof createProfileSchema>;

export const updateProfileSchema = profileSchema
  .partial()
  .omit({ id: true, created_at: true, updated_at: true });
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

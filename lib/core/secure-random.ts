/**
 * Cryptographically secure random helpers.
 *
 * Never use `Math.random()` for anything security-sensitive (passwords, tokens,
 * slugs that gate access, identifiers). It is not a CSPRNG and is predictable.
 * These helpers use Node's `crypto` (available in the Vercel Node runtime).
 */

import { randomBytes, randomInt, randomUUID } from "node:crypto";

// Password alphabet: excludes ambiguous chars (0/O, 1/l/I) for human transcription.
const PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%&*";

/**
 * Generate a cryptographically secure random password.
 * Uses `crypto.randomInt` for uniform, unbiased character selection.
 */
export function generatePassword(length = 16): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  }
  return out;
}

/**
 * URL-safe random token (base64url), e.g. for one-time links or opaque ids.
 * `bytes` of entropy → ceil(bytes*4/3) chars.
 */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Lowercase alphanumeric slug suffix (uniform, unbiased).
 */
export function generateSlugSuffix(length = 8): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[randomInt(alphabet.length)];
  }
  return out;
}

/** RFC 4122 v4 UUID. */
export function uuid(): string {
  return randomUUID();
}

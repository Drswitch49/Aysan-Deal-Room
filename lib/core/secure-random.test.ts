import { describe, it, expect } from "vitest";
import { generatePassword, generateToken, generateSlugSuffix, uuid } from "./secure-random.js";

describe("secure-random", () => {
  it("generatePassword returns the requested length and varies", () => {
    expect(generatePassword(16)).toHaveLength(16);
    expect(generatePassword(24)).toHaveLength(24);
    expect(generatePassword()).not.toEqual(generatePassword());
  });

  it("generateToken is url-safe base64 with no padding chars", () => {
    const t = generateToken(32);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t).not.toEqual(generateToken(32));
  });

  it("generateSlugSuffix is lowercase alphanumeric", () => {
    const s = generateSlugSuffix(8);
    expect(s).toHaveLength(8);
    expect(s).toMatch(/^[a-z0-9]+$/);
  });

  it("uuid is a v4 UUID", () => {
    expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

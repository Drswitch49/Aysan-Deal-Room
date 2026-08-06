/**
 * Role-mapping and grant-authority rules for account provisioning. These are the
 * pure parts — anything touching Supabase is exercised against the live project,
 * not here.
 */
import { describe, it, expect } from "vitest";
import { staffRoleFor, assertCanGrant } from "./account-provisioning.js";
import { ForbiddenError } from "../../lib/core/errors.js";

describe("staffRoleFor", () => {
  it("maps the registry's free-text roles onto the user_role enum", () => {
    expect(staffRoleFor("Managing Partner", null)).toBe("managing_partner");
    expect(staffRoleFor("Partner", null)).toBe("partner");
    expect(staffRoleFor("Analyst", null)).toBe("analyst");
    expect(staffRoleFor("Admin", "Full Access")).toBe("admin");
    expect(staffRoleFor("HR", null)).toBe("hr");
    expect(staffRoleFor("read_only", null)).toBe("read_only");
  });

  it("treats owner-equivalent titles as owner", () => {
    expect(staffRoleFor("Super Admin", null)).toBe("owner");
    expect(staffRoleFor("Founder", null)).toBe("owner");
    expect(staffRoleFor("owner", null)).toBe("owner");
  });

  it("falls back to the access level, then to read_only — never guessing upward", () => {
    expect(staffRoleFor("", "Full Access")).toBe("admin");
    expect(staffRoleFor("Something Unknown", "Write Access")).toBe("analyst");
    expect(staffRoleFor("Something Unknown", null)).toBe("read_only");
    expect(staffRoleFor(null, undefined)).toBe("read_only");
  });

  it("never resolves a staff row to a portal audience role", () => {
    expect(staffRoleFor("Shareholder", null)).toBe("read_only");
    expect(staffRoleFor("Lender", null)).toBe("read_only");
  });
});

describe("assertCanGrant", () => {
  it("lets full-access staff provision any role, including their seniors", () => {
    for (const actor of ["owner", "managing_partner", "partner", "admin"]) {
      expect(() => assertCanGrant(actor, "owner")).not.toThrow();
      expect(() => assertCanGrant(actor, "managing_partner")).not.toThrow();
      expect(() => assertCanGrant(actor, "shareholder")).not.toThrow();
    }
  });

  it("stops HR from minting an account above its own rank", () => {
    expect(() => assertCanGrant("hr", "owner")).toThrow(ForbiddenError);
    expect(() => assertCanGrant("hr", "admin")).toThrow(ForbiddenError);
    expect(() => assertCanGrant("hr", "analyst")).not.toThrow();
    expect(() => assertCanGrant("hr", "shareholder")).not.toThrow();
  });

  it("denies unknown or portal roles any grant authority", () => {
    expect(() => assertCanGrant("lender", "analyst")).toThrow(ForbiddenError);
    expect(() => assertCanGrant("", "read_only")).toThrow(ForbiddenError);
  });
});

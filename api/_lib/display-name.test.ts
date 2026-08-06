/** The email fallback used when no name is recorded anywhere. */
import { describe, it, expect } from "vitest";
import { nameFromEmail, escapeLike } from "./display-name.js";

describe("nameFromEmail", () => {
  it("turns a structured local-part into a person's name", () => {
    expect(nameFromEmail("lee.coutanche@moorfieldscf.com")).toBe("Lee Coutanche");
    expect(nameFromEmail("alex.russon@ultimatefinance.co.uk")).toBe("Alex Russon");
    expect(nameFromEmail("ayodeji_oyesanya@gmail.com")).toBe("Ayodeji Oyesanya");
    expect(nameFromEmail("jane-doe+work@acp.com")).toBe("Jane Doe Work");
  });

  it("still avoids rendering the address for role mailboxes", () => {
    expect(nameFromEmail("admin@aysancapital.com")).toBe("Admin");
    expect(nameFromEmail("deals@aysancapital.com")).toBe("Deals");
  });

  it("never returns an empty label", () => {
    expect(nameFromEmail("")).toBe("User");
    expect(nameFromEmail(null)).toBe("User");
    expect(nameFromEmail(undefined)).toBe("User");
    expect(nameFromEmail("@nolocal.com")).toBe("User");
  });
});

describe("escapeLike", () => {
  it("neutralises wildcards so an email matches literally", () => {
    expect(escapeLike("a%b_c@x.com")).toBe("a\\%b\\_c@x.com");
    expect(escapeLike("plain@x.com")).toBe("plain@x.com");
  });
});

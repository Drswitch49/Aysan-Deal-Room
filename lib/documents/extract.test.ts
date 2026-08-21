import { describe, expect, it, vi, afterEach } from "vitest";
import { extractTextFromUrl } from "./extract.js";

function mockFetch(body: string, contentType: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      headers: { get: () => contentType },
      arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("extractTextFromUrl — HTML", () => {
  it("rejects a client-rendered viewer page instead of returning its markup", async () => {
    // What a broker's CIM link actually returns: a shell with CSP headers and
    // scripts, no document text. It was being cached as the deal's IM.
    mockFetch(
      `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' https://js.stripe.com/">` +
        `<script>window.__boot={a:1}</script><style>.x{color:red}</style></head><body><div id="app"></div></body></html>`,
      "text/html; charset=utf-8",
    );
    await expect(extractTextFromUrl("https://example.com/cim-view", "cim-view")).rejects.toThrow(
      /no readable document text/i,
    );
  });

  it("strips tags and entities from a page that does carry the document", async () => {
    const body = `<html><body><h1>Information Memorandum</h1><p>Turnover &amp; EBITDA for YE25.</p>` +
      `<p>${"Recurring drainage maintenance contracts across Powys and Shropshire. ".repeat(10)}</p></body></html>`;
    mockFetch(body, "text/html");
    const text = await extractTextFromUrl("https://example.com/im", "im.html");
    expect(text).toContain("Information Memorandum");
    expect(text).toContain("Turnover & EBITDA");
    expect(text).not.toMatch(/<[a-z]/i);
  });

  it("leaves plain text alone", async () => {
    mockFetch("Turnover 639,865\nEBITDA 121,004", "text/plain");
    await expect(extractTextFromUrl("https://example.com/a.txt", "a.txt")).resolves.toContain("639,865");
  });
});

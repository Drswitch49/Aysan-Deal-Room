/**
 * OSINT Provider: Companies House (UK)
 *
 * Uses the free Companies House REST API — no scraping, no browser required.
 * API Key required: register at https://developer.company-information.service.gov.uk/
 *
 * Provides:
 *  - Company search by name
 *  - Company profile (SIC codes, address, status, incorporation date)
 *  - Officers / persons with significant control
 *
 * Rate limits: 600 req/5min on free tier.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CompaniesHouseCompany {
  companyNumber: string;
  companyName: string;
  companyStatus: string;
  companyType: string;
  dateOfCreation: string;
  registeredAddress: string;
  sicCodes: string[];
  jurisdiction: string;
}

export interface CompaniesHouseOfficer {
  name: string;
  role: string;
  appointedOn: string;
  nationality?: string;
}

export interface CompaniesHouseResult {
  found: boolean;
  company?: CompaniesHouseCompany;
  officers?: CompaniesHouseOfficer[];
  error?: string;
}

// ─── Provider ────────────────────────────────────────────────────────────────

/** Compare company names the way a human would: case, punctuation and repeated
 *  whitespace are noise. Deal records carry names like
 *  "C & L 24HR Emergency  Drainage Limited" — a double space and an ampersand
 *  are not a different company. */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(limited|ltd|plc|llp|company|co)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Pick the best of the search hits rather than trusting position 1.
 *
 * Companies House ranks on its own relevance, which happily puts a dissolved
 * near-namesake above the live company we asked for. Prefer an exact normalized
 * name match, then any active company, then the top hit.
 */
function pickMatch(items: any[], companyName: string): any {
  const target = normalizeName(companyName);
  return (
    items.find((i) => normalizeName(String(i.title ?? "")) === target) ??
    items.find((i) => i.company_status === "active") ??
    items[0]
  );
}

export async function searchCompaniesHouse(
  companyName: string
): Promise<CompaniesHouseResult> {
  const apiKey = process.env.COMPANIES_HOUSE_API_KEY;

  if (!apiKey) {
    console.warn("[Companies House] API key not configured — skipping");
    return {
      found: false,
      error: "COMPANIES_HOUSE_API_KEY not set",
    };
  }

  if (!companyName.trim()) {
    return { found: false, error: "No company name on the deal to search with" };
  }

  const authHeader = "Basic " + Buffer.from(`${apiKey}:`).toString("base64");

  try {
    // Step 1: Search for company. Collapse the whitespace the deal records
    // carry — the API treats a double space as an extra (empty) term.
    const searchRes = await fetch(
      `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(
        companyName.replace(/\s+/g, " ").trim()
      )}&items_per_page=5`,
      {
        headers: { Authorization: authHeader },
        signal: AbortSignal.timeout(10_000),
      }
    );

    if (!searchRes.ok) {
      return {
        found: false,
        error: `Companies House API returned ${searchRes.status}`,
      };
    }

    const searchData = await searchRes.json();
    const items: any[] = searchData.items || [];

    if (items.length === 0) {
      return { found: false, error: "No matching company found" };
    }

    const match = pickMatch(items, companyName);
    const companyNumber: string = match.company_number;

    // Step 2: Fetch full company profile
    const profileRes = await fetch(
      `https://api.company-information.service.gov.uk/company/${companyNumber}`,
      {
        headers: { Authorization: authHeader },
        signal: AbortSignal.timeout(10_000),
      }
    );

    let company: CompaniesHouseCompany;
    if (profileRes.ok) {
      const p = await profileRes.json();
      company = {
        companyNumber,
        companyName: p.company_name || match.title,
        companyStatus: p.company_status || "unknown",
        companyType: p.type || "unknown",
        dateOfCreation: p.date_of_creation || "",
        registeredAddress: formatAddress(p.registered_office_address),
        sicCodes: p.sic_codes || [],
        jurisdiction: p.jurisdiction || "united-kingdom",
      };
    } else {
      // Fall back to search result data
      company = {
        companyNumber,
        companyName: match.title,
        companyStatus: match.company_status || "unknown",
        companyType: match.company_type || "unknown",
        dateOfCreation: match.date_of_creation || "",
        registeredAddress: formatAddress(match.address),
        sicCodes: [],
        jurisdiction: "united-kingdom",
      };
    }

    // Step 3: Fetch officers (optional — graceful failure)
    let officers: CompaniesHouseOfficer[] = [];
    try {
      const officersRes = await fetch(
        `https://api.company-information.service.gov.uk/company/${companyNumber}/officers?items_per_page=5`,
        {
          headers: { Authorization: authHeader },
          signal: AbortSignal.timeout(10_000),
        }
      );
      if (officersRes.ok) {
        const officersData = await officersRes.json();
        officers = ((officersData.items as any[]) || [])
          .filter((o) => o.resigned_on == null) // Active officers only
          .slice(0, 5)
          .map((o) => ({
            name: o.name || "",
            role: o.officer_role || "director",
            appointedOn: o.appointed_on || "",
            nationality: o.nationality,
          }));
      }
    } catch {
      // Officers are supplementary — don't fail the whole enrichment
    }

    return { found: true, company, officers };
  } catch (err: any) {
    return { found: false, error: `Companies House request failed: ${err.message}` };
  }
}

/**
 * Render a result as prompt input.
 *
 * The pre-call brief used to paste `JSON.stringify(result)` into the prompt,
 * which spends tokens on field names and braces and reads to the model as a
 * dump rather than as a registry record. Returns "" when there is nothing to
 * say, so the caller can report the source as empty.
 */
export function formatCompaniesHouseForPrompt(result: CompaniesHouseResult | null): string {
  if (!result?.found || !result.company) return "";
  const c = result.company;
  const lines = [
    `Registered name: ${c.companyName}`,
    `Company number: ${c.companyNumber}`,
    `Status: ${c.companyStatus}`,
    `Type: ${c.companyType}`,
    c.dateOfCreation ? `Incorporated: ${c.dateOfCreation}` : null,
    c.registeredAddress ? `Registered office: ${c.registeredAddress}` : null,
    c.sicCodes.length ? `SIC codes: ${c.sicCodes.join(", ")}` : null,
  ].filter(Boolean) as string[];

  if (result.officers?.length) {
    lines.push(
      "Active officers:",
      ...result.officers.map(
        (o) => `  - ${o.name} — ${o.role}${o.appointedOn ? `, appointed ${o.appointedOn}` : ""}${o.nationality ? ` (${o.nationality})` : ""}`,
      ),
    );
  }
  return lines.join("\n");
}

function formatAddress(addr: any): string {
  if (!addr) return "";
  const parts = [
    addr.address_line_1,
    addr.address_line_2,
    addr.locality,
    addr.region,
    addr.postal_code,
    addr.country,
  ].filter(Boolean);
  return parts.join(", ");
}

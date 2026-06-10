import type { Page } from "playwright-core";

export interface CompanyExtraction {
  title: string;
  description: string;
  services: string[];
  leadership: string[];
  contacts: {
    emails: string[];
    phones: string[];
  };
  locations: string[];
}

export async function extractCompanyDetails(page: Page): Promise<CompanyExtraction> {
  return page.evaluate(() => {
    const getText = (selector: string): string => {
      const el = document.querySelector(selector);
      return el?.textContent?.trim() || "";
    };

    // 1. Get title
    const title = document.title || getText("h1");

    // 2. Get main body text for regex extraction
    const bodyText = document.body.innerText || "";

    // 3. Contact extraction (Regex based)
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const phoneRegex = /(?:\+?([\d]{1,3}))?[-. (]*([\d]{3,5})[-. )]*([\d]{3,5})[-. ]*([\d]{4})/g;

    const emails = Array.from(bodyText.matchAll(emailRegex))
      .map((match) => match[0].toLowerCase())
      .filter((v, i, self) => self.indexOf(v) === i)
      .slice(0, 5);

    const phones = Array.from(bodyText.matchAll(phoneRegex))
      .map((match) => match[0].trim())
      .filter((v) => v.length >= 8) // filter short random digits
      .filter((v, i, self) => self.indexOf(v) === i)
      .slice(0, 5);

    // 4. Leadership keywords scan
    const leadershipKeywords = [
      "ceo",
      "founder",
      "director",
      "managing director",
      "president",
      "chief executive",
      "cfo",
      "coo",
    ];
    const leadership: string[] = [];

    // Look for lines containing leadership keywords
    const lines = bodyText.split("\n");
    for (const line of lines) {
      const lowerLine = line.toLowerCase();
      if (
        leadershipKeywords.some((keyword) => lowerLine.includes(keyword)) &&
        line.trim().length > 5 &&
        line.trim().length < 80
      ) {
        leadership.push(line.trim());
      }
    }

    const uniqueLeadership = leadership
      .filter((v, i, self) => self.indexOf(v) === i)
      .slice(0, 5);

    // 5. Locations detection (simple UK zip code / address keywords lookups)
    const locations: string[] = [];
    const postcodeRegex = /[A-Z]{1,2}[0-9R][0-9A-Z]? [0-9][ABD-HJLNP-UW-Z]{2}/g;
    const postcodes = Array.from(bodyText.matchAll(postcodeRegex)).map((m) => m[0]);
    if (postcodes.length > 0) {
      locations.push(...postcodes);
    }

    // Capture lines that look like addresses (e.g. contains "street", "road", "way", "avenue", "london", "kent")
    const addressKeywords = ["street", "road", "way", "avenue", "lane", "house", "park", "industrial estate", "london", "kent", "suite"];
    for (const line of lines) {
      const lowerLine = line.toLowerCase();
      if (
        addressKeywords.some((keyword) => lowerLine.includes(keyword)) &&
        (lowerLine.includes("address") || lowerLine.includes("head office") || lowerLine.includes("hq") || lowerLine.includes("office:") || /[0-9]/.test(lowerLine)) &&
        line.trim().length > 10 &&
        line.trim().length < 100
      ) {
        locations.push(line.trim());
      }
    }

    const uniqueLocations = locations
      .filter((v, i, self) => self.indexOf(v) === i)
      .slice(0, 5);

    // 6. Services / Products
    // Extract H2 or H3 titles that may correspond to services
    const serviceHeaders = Array.from(document.querySelectorAll("h2, h3, h4"))
      .map((h) => h.textContent?.trim() || "")
      .filter((t) => t.length > 3 && t.length < 50)
      .filter((t) => {
        const lower = t.toLowerCase();
        return (
          lower.includes("service") ||
          lower.includes("product") ||
          lower.includes("what we do") ||
          lower.includes("solutions") ||
          lower.includes("expertise") ||
          lower.includes("cleaning") ||
          lower.includes("offer")
        );
      });

    // Default description
    const description =
      getText("meta[name='description']") ||
      getText("meta[property='og:description']") ||
      getText("p") ||
      "";

    return {
      title,
      description: description.substring(0, 500),
      services: serviceHeaders.slice(0, 8),
      leadership: uniqueLeadership,
      contacts: {
        emails,
        phones,
      },
      locations: uniqueLocations,
    };
  });
}

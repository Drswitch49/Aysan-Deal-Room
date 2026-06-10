import { withBrowser } from "./browser.js";
import { extractCompanyDetails, type CompanyExtraction } from "./extractors/company.js";
import { extractMetadata, type MetadataExtraction } from "./extractors/metadata.js";
import { extractSocialAndSchema, type SocialExtraction } from "./extractors/social.js";

export interface WebsiteScrapeResult {
  url: string;
  success: boolean;
  error?: string;
  scrapedAt: string;
  companyDetails?: CompanyExtraction;
  metadata?: MetadataExtraction;
  socialAndSchema?: SocialExtraction;
}

export async function scrapeCompanyWebsite(websiteUrl: string): Promise<WebsiteScrapeResult> {
  const scrapedAt = new Date().toISOString();

  // Normalize URL
  let targetUrl = websiteUrl.trim();
  if (targetUrl && !/^https?:\/\//i.test(targetUrl)) {
    targetUrl = `https://${targetUrl}`;
  }

  if (!targetUrl) {
    return {
      url: websiteUrl,
      success: false,
      error: "No website URL provided",
      scrapedAt,
    };
  }

  try {
    return await withBrowser(async ({ page }) => {
      console.log(`[OSINT Playwright] Navigating to website: ${targetUrl}`);

      // Go to target URL. Set 15s timeout to remain lightweight on serverless functions
      const response = await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });

      if (!response) {
        throw new Error("Failed to load response (null response received)");
      }

      if (response.status() >= 400) {
        throw new Error(`Website returned HTTP status ${response.status()}`);
      }

      // Briefly pause for dynamic DOM updates
      await page.waitForTimeout(1_500);

      // Run extractors in parallel
      const [companyDetails, metadata, socialAndSchema] = await Promise.all([
        extractCompanyDetails(page),
        extractMetadata(page),
        extractSocialAndSchema(page),
      ]);

      return {
        url: targetUrl,
        success: true,
        scrapedAt,
        companyDetails,
        metadata,
        socialAndSchema,
      };
    });
  } catch (err: any) {
    console.error(`[OSINT Playwright] Website scrape failed for ${targetUrl}:`, err.message);
    return {
      url: targetUrl,
      success: false,
      error: err.message || "Failed to scrape company website",
      scrapedAt,
    };
  }
}

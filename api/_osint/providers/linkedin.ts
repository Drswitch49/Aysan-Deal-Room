/**
 * OSINT Provider: LinkedIn Company Enrichment
 *
 * Uses Playwright to extract public company page information from LinkedIn.
 * Scope is intentionally narrow:
 *  - Company name, tagline, about text
 *  - Industry, company size, HQ location
 *  - Founded year
 *  - Recent company posts (up to 3)
 *
 * NOT implemented:
 *  - Profile crawling
 *  - Employee enumeration
 *  - Messaging automation
 *  - Infinite-scroll harvesting
 *  - Large-scale data extraction
 *
 * Session authentication:
 *  Set LINKEDIN_SESSION_DATA = base64(JSON.stringify(storageState))
 *  Generate via: `node scripts/playwright-auth.mjs` locally.
 *  StorageState.json is gitignored.
 */

import { withBrowser } from "../browser.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LinkedInCompanyData {
  companyName: string;
  tagline: string;
  about: string;
  industry: string;
  companySize: string;
  headquarters: string;
  founded: string;
  website: string;
  followerCount: string;
  recentPosts: string[];
  linkedInUrl: string;
  sessionValid: boolean;
}

export interface LinkedInResult {
  found: boolean;
  data?: LinkedInCompanyData;
  error?: string;
}

// ─── Provider ────────────────────────────────────────────────────────────────

/**
 * Enriches a company using its LinkedIn URL or company name search.
 * Requires LINKEDIN_SESSION_DATA to be set in environment for authenticated access.
 */
export async function enrichFromLinkedIn(options: {
  linkedInUrl?: string;
  companyName?: string;
  website?: string;
}): Promise<LinkedInResult> {
  const hasSession = Boolean(process.env.LINKEDIN_SESSION_DATA);

  if (!hasSession) {
    console.warn(
      "[LinkedIn] LINKEDIN_SESSION_DATA not configured — skipping LinkedIn enrichment"
    );
    return {
      found: false,
      error: "LinkedIn session not configured. Set LINKEDIN_SESSION_DATA env var.",
    };
  }

  try {
    return await withBrowser(
      async ({ page }) => {
        // Determine target URL
        let targetUrl = options.linkedInUrl || "";

        if (!targetUrl && options.companyName) {
          // Navigate to LinkedIn company search
          const query = encodeURIComponent(options.companyName);
          await page.goto(
            `https://www.linkedin.com/search/results/companies/?keywords=${query}`,
            { waitUntil: "domcontentloaded", timeout: 30_000 }
          );

          // Check if we got redirected to login (session expired)
          if (page.url().includes("/login") || page.url().includes("/authwall")) {
            return {
              found: false,
              error: "LinkedIn session expired. Re-run playwright-auth.mjs to refresh.",
            };
          }

          // Click first company result
          try {
            const firstResult = await page.waitForSelector(
              "a[href*='/company/']",
              { timeout: 8_000 }
            );
            targetUrl = await firstResult.getAttribute("href") || "";
            // Normalize to absolute URL
            if (targetUrl && !targetUrl.startsWith("http")) {
              targetUrl = `https://www.linkedin.com${targetUrl.split("?")[0]}`;
            }
          } catch {
            return { found: false, error: "No LinkedIn company found for search term" };
          }
        }

        if (!targetUrl) {
          return { found: false, error: "No LinkedIn URL or company name provided" };
        }

        // Navigate to company page
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

        // Verify session is valid
        const currentUrl = page.url();
        if (currentUrl.includes("/login") || currentUrl.includes("/authwall")) {
          return {
            found: false,
            error: "LinkedIn session expired. Re-run playwright-auth.mjs.",
          };
        }

        // Wait for key element
        await page.waitForTimeout(2_000); // Brief pause for dynamic content

        // Extract company data
        const data = await page.evaluate(() => {
          const getText = (selector: string): string => {
            const el = document.querySelector(selector);
            return el?.textContent?.trim() || "";
          };
          const getAttr = (selector: string, attr: string): string => {
            const el = document.querySelector(selector);
            return (el as any)?.[attr]?.trim() || "";
          };

          // Company name
          const companyName = getText("h1") || getText(".org-top-card-summary__title");

          // Tagline
          const tagline = getText(".org-top-card-summary__tagline") ||
            getText("p.org-top-card-summary__tagline");

          // About section
          const about = getText(".org-about-us-organization-description__text") ||
            getText("[data-test-id='about-us__description']") ||
            getText(".org-about-module__description");

          // Details
          const getDetail = (label: string): string => {
            const dts = Array.from(document.querySelectorAll("dt"));
            const dt = dts.find((d) => d.textContent?.toLowerCase().includes(label));
            return dt?.nextElementSibling?.textContent?.trim() || "";
          };

          const industry = getDetail("industry") ||
            getText(".org-top-card-summary-info-list__info-item:nth-child(1)");
          const companySize = getDetail("company size") || getDetail("employees");
          const headquarters = getDetail("headquarters");
          const founded = getDetail("founded");
          const website = getAttr("a[data-tracking-control-name='about_website']", "href") ||
            getDetail("website");

          const followerCount = getText(".org-top-card-summary-info-list__info-item") ||
            getText("[data-test-id='org-followers']");

          // Recent posts (up to 3 summaries)
          const postEls = Array.from(document.querySelectorAll(
            ".feed-shared-update-v2__description, .org-updates__content-text"
          )).slice(0, 3);
          const recentPosts = postEls
            .map((el) => el.textContent?.trim().substring(0, 300) || "")
            .filter(Boolean);

          return {
            companyName,
            tagline,
            about: about.substring(0, 1000),
            industry,
            companySize,
            headquarters,
            founded,
            website,
            followerCount,
            recentPosts,
          };
        });

        return {
          found: true,
          data: {
            ...data,
            linkedInUrl: targetUrl,
            sessionValid: true,
          },
        };
      },
      { withSession: true }
    );
  } catch (err: any) {
    console.error("[LinkedIn] Enrichment failed:", err.message);
    return { found: false, error: `LinkedIn scraping failed: ${err.message}` };
  }
}

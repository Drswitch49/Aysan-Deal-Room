import { withBrowser } from "./browser.js";

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
  hiringIndicators: {
    isHiring: boolean;
    details?: string;
  };
  growthIndicators: {
    employeeCount?: string;
    followerCount?: string;
  };
  sessionValid: boolean;
}

export interface LinkedInResult {
  found: boolean;
  data?: LinkedInCompanyData;
  error?: string;
}

/**
 * Enriches a company using its LinkedIn URL or company name search.
 * Requires LinkedIn auth session storageState in auth/storageState.json or LINKEDIN_SESSION_DATA.
 */
export async function enrichFromLinkedIn(options: {
  linkedInUrl?: string;
  companyName?: string;
  website?: string;
}): Promise<LinkedInResult> {
  try {
    return await withBrowser(
      async ({ page }) => {
        let targetUrl = options.linkedInUrl || "";

        // If no URL but company name is given, try searching
        if (!targetUrl && options.companyName) {
          console.log(`[OSINT Playwright] Searching LinkedIn for company: ${options.companyName}`);
          const query = encodeURIComponent(options.companyName);
          await page.goto(
            `https://www.linkedin.com/search/results/companies/?keywords=${query}`,
            { waitUntil: "domcontentloaded", timeout: 20_000 }
          );

          if (page.url().includes("/login") || page.url().includes("/authwall")) {
            return {
              found: false,
              error: "LinkedIn session expired or invalid. Authenticate session state first.",
            };
          }

          try {
            const firstResult = await page.waitForSelector("a[href*='/company/']", { timeout: 8_000 });
            targetUrl = (await firstResult.getAttribute("href")) || "";
            if (targetUrl && !targetUrl.startsWith("http")) {
              targetUrl = `https://www.linkedin.com${targetUrl.split("?")[0]}`;
            }
          } catch {
            return { found: false, error: "No LinkedIn company found in search results" };
          }
        }

        if (!targetUrl) {
          return { found: false, error: "No LinkedIn URL or company name provided" };
        }

        console.log(`[OSINT Playwright] Navigating to LinkedIn company page: ${targetUrl}`);
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });

        if (page.url().includes("/login") || page.url().includes("/authwall")) {
          return {
            found: false,
            error: "LinkedIn session expired or invalid. Authenticate session state first.",
          };
        }

        // Brief pause for dynamic content loading
        await page.waitForTimeout(2_500);

        const data = await page.evaluate(() => {
          const getText = (selector: string): string => {
            const el = document.querySelector(selector);
            return el?.textContent?.trim() || "";
          };
          const getAttr = (selector: string, attr: string): string => {
            const el = document.querySelector(selector);
            return (el as any)?.[attr]?.trim() || "";
          };

          const companyName = getText("h1") || getText(".org-top-card-summary__title");
          const tagline = getText(".org-top-card-summary__tagline") || getText("p.org-top-card-summary__tagline");
          const about =
            getText(".org-about-us-organization-description__text") ||
            getText("[data-test-id='about-us__description']") ||
            getText(".org-about-module__description");

          // Details finder
          const getDetail = (label: string): string => {
            const dts = Array.from(document.querySelectorAll("dt"));
            const dt = dts.find((d) => d.textContent?.toLowerCase().includes(label));
            return dt?.nextElementSibling?.textContent?.trim() || "";
          };

          const industry = getDetail("industry") || getText(".org-top-card-summary-info-list__info-item:nth-child(1)");
          const companySize = getDetail("company size") || getDetail("employees");
          const headquarters = getDetail("headquarters");
          const founded = getDetail("founded");
          const website = getAttr("a[data-tracking-control-name='about_website']", "href") || getDetail("website");
          const followerCount =
            getText(".org-top-card-summary-info-list__info-item:nth-child(2)") ||
            getText("[data-test-id='org-followers']") ||
            getText(".org-top-card-summary-info-list__info-item");

          // Post activity
          const postEls = Array.from(
            document.querySelectorAll(".feed-shared-update-v2__description, .org-updates__content-text")
          ).slice(0, 3);
          const recentPosts = postEls
            .map((el) => el.textContent?.trim().substring(0, 300) || "")
            .filter(Boolean);

          // Hiring indicators (search page for hiring texts, open jobs elements)
          const htmlText = document.body.innerText.toLowerCase();
          const isHiring =
            htmlText.includes("we're hiring") ||
            htmlText.includes("hiring for") ||
            htmlText.includes("see all open jobs") ||
            !!document.querySelector(".org-jobs-job-card, a[href*='/jobs']");

          const jobsCountText = getText(".org-about-company-module__jobs-count") || "";

          return {
            companyName,
            tagline,
            about: about.substring(0, 800),
            industry,
            companySize,
            headquarters,
            founded,
            website,
            followerCount,
            recentPosts,
            hiringIndicators: {
              isHiring,
              details: jobsCountText ? `Jobs count listed: ${jobsCountText}` : isHiring ? "Hiring keywords detected" : "No active hiring signals",
            },
            growthIndicators: {
              employeeCount: companySize,
              followerCount: followerCount,
            },
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
    console.error("[OSINT Playwright] LinkedIn enrichment failed:", err.message);
    return { found: false, error: `LinkedIn scraping failed: ${err.message}` };
  }
}

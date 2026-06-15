/**
 * Serverless Playwright Browser — Optimized for Vercel Pro
 *
 * Uses playwright-core + @sparticuz/chromium to provide a serverless-compatible
 * headless Chromium instance. Designed for lightweight, targeted enrichment
 * workflows — not high-volume scraping.
 *
 * Vercel Pro: maxDuration 300s gives ample time for browser workflows.
 */

import chromium from "@sparticuz/chromium";
import { chromium as playwrightChromium } from "playwright-core";
import type { Browser, BrowserContext, Page } from "playwright-core";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

// ─── Configuration ───────────────────────────────────────────────────────────

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

// ─── Core Browser Factory ────────────────────────────────────────────────────

/**
 * Creates a lightweight Playwright browser session optimised for Vercel Pro serverless.
 */
export async function createBrowserSession(options?: {
  userAgent?: string;
}): Promise<BrowserSession> {
  const isLocal = process.env.NODE_ENV === "development" || process.env.PLAYWRIGHT_LOCAL === "1";

  let executablePath: string;
  let launchArgs: string[];

  if (isLocal) {
    // Local dev: use system Playwright browser
    executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "";
    launchArgs = ["--no-sandbox", "--disable-setuid-sandbox"];
  } else {
    // Serverless: use @sparticuz/chromium
    executablePath = await chromium.executablePath();
    launchArgs = [
      ...chromium.args,
      "--disable-images", // Speed up scraping — we don't need images
      "--disable-javascript-harmony-shipping",
      "--single-process",
    ];
  }

  const launchOptions: any = {
    args: launchArgs,
    headless: true,
  };
  if (executablePath) {
    launchOptions.executablePath = executablePath;
  } else if (isLocal) {
    launchOptions.channel = "chrome";
  }

  const browser = await playwrightChromium.launch(launchOptions);

  // Session persistence is disabled
  let storageState: any = undefined;

  const context = await browser.newContext({
    userAgent: options?.userAgent || DEFAULT_USER_AGENT,
    viewport: DEFAULT_VIEWPORT,
    storageState,
    // Ignore HTTPS errors for corporate proxy environments
    ignoreHTTPSErrors: false,
    // Reduce fingerprinting surface
    locale: "en-GB",
    timezoneId: "Europe/London",
  });

  // Stealth: remove navigator.webdriver flag
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  const page = await context.newPage();

  // Block unnecessary resources to speed up extraction
  await page.route("**/*.{png,jpg,jpeg,gif,svg,ico,woff,woff2,ttf}", (route) =>
    route.abort()
  );

  const close = async () => {
    try {
      await browser.close();
    } catch {
      // Safe to ignore on serverless teardown
    }
  };

  return { browser, context, page, close };
}

/**
 * Convenience: run a Playwright job and always close the browser after.
 */
export async function withBrowser<T>(
  fn: (session: BrowserSession) => Promise<T>,
  options?: { userAgent?: string }
): Promise<T> {
  const session = await createBrowserSession(options);
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}



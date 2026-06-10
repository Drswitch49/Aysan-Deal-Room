/**
 * Serverless Playwright Browser Factory — Optimized for Vercel Pro
 *
 * Uses playwright-core + @sparticuz/chromium to provide a serverless-compatible
 * headless Chromium instance.
 */

import chromium from "@sparticuz/chromium";
import { chromium as playwrightChromium } from "playwright-core";
import type { Browser, BrowserContext, Page } from "playwright-core";
import * as fs from "fs";
import * as path from "path";

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

/**
 * Creates a lightweight Playwright browser session optimized for Vercel Pro serverless.
 * Pass `withSession: true` to load persistent LinkedIn storageState.json or LINKEDIN_SESSION_DATA.
 */
export async function createBrowserSession(options?: {
  withSession?: boolean;
  userAgent?: string;
}): Promise<BrowserSession> {
  const isLocal = process.env.NODE_ENV === "development" || process.env.PLAYWRIGHT_LOCAL === "1";

  let executablePath: string;
  let launchArgs: string[];

  if (isLocal) {
    executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "";
    launchArgs = ["--no-sandbox", "--disable-setuid-sandbox"];
  } else {
    executablePath = await chromium.executablePath();
    launchArgs = [
      ...chromium.args,
      "--disable-images",
      "--disable-javascript-harmony-shipping",
      "--single-process",
    ];
  }

  const browser = await playwrightChromium.launch({
    args: launchArgs,
    executablePath: executablePath || undefined,
    headless: true,
  });

  // Load persistent session state if available
  let storageState: any = undefined;
  if (options?.withSession) {
    // 1. Try to load from lib/playwright/auth/storageState.json
    const localStatePath = path.join(process.cwd(), "lib", "playwright", "auth", "storageState.json");
    if (fs.existsSync(localStatePath)) {
      try {
        storageState = JSON.parse(fs.readFileSync(localStatePath, "utf-8"));
      } catch (e: any) {
        console.warn("[Browser] Failed to parse local storageState.json:", e.message);
      }
    }

    // 2. Fall back to environment variable if no file or parsing failed
    if (!storageState && process.env.LINKEDIN_SESSION_DATA) {
      try {
        storageState = JSON.parse(
          Buffer.from(process.env.LINKEDIN_SESSION_DATA, "base64").toString("utf-8")
        );
      } catch (e: any) {
        console.warn("[Browser] Failed to parse LINKEDIN_SESSION_DATA env var:", e.message);
      }
    }

    if (!storageState) {
      console.warn("[Browser] No session authentication loaded for LinkedIn");
    }
  }

  const context = await browser.newContext({
    userAgent: options?.userAgent || DEFAULT_USER_AGENT,
    viewport: DEFAULT_VIEWPORT,
    storageState,
    ignoreHTTPSErrors: true,
    locale: "en-GB",
    timezoneId: "Europe/London",
  });

  // Stealth: remove navigator.webdriver flag
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  const page = await context.newPage();

  // Block unnecessary resources (images, fonts, stylesheets) to speed up extraction
  await page.route("**/*.{png,jpg,jpeg,gif,svg,ico,woff,woff2,ttf,css}", (route) => {
    const resourceType = route.request().resourceType();
    if (["image", "font", "stylesheet", "media"].includes(resourceType)) {
      return route.abort();
    }
    return route.continue();
  });

  const close = async () => {
    try {
      await browser.close();
    } catch {
      // Safe to ignore
    }
  };

  return { browser, context, page, close };
}

/**
 * Convenience wrapper: runs a Playwright job and automatically closes browser.
 */
export async function withBrowser<T>(
  fn: (session: BrowserSession) => Promise<T>,
  options?: { withSession?: boolean }
): Promise<T> {
  const session = await createBrowserSession(options);
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}

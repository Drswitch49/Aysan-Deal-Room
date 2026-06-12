#!/usr/bin/env node
/**
 * LinkedIn Auth Bootstrap — Playwright Session Generator
 *
 * Run this LOCALLY to generate a fresh LinkedIn session that can be used
 * by the OSINT enrichment pipeline on Vercel.
 *
 * Usage:
 *   node scripts/playwright-auth.mjs
 *
 * The script will:
 *  1. Open a real Chromium browser (headful)
 *  2. Navigate to LinkedIn login
 *  3. Wait for you to manually log in (90 seconds)
 *  4. Save the session as base64 to .linkedin-session (gitignored)
 *  5. Print instructions to set LINKEDIN_SESSION_DATA in Vercel env
 *
 * SECURITY NOTES:
 *  - .linkedin-session is gitignored — never commit it
 *  - Store LINKEDIN_SESSION_DATA as a Vercel encrypted secret
 *  - Sessions expire after LinkedIn's cookie TTL (~1 year for "remember me")
 *  - Re-run this script if you get "session expired" errors in OSINT workflows
 */

import { chromium } from "playwright-core";
import { writeFileSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = join(__dirname, "..", ".linkedin-session");
const TIMEOUT_MS = 90_000; // 90 seconds to log in manually

async function main() {
  console.log("\n🔐 LinkedIn Auth Bootstrap");
  console.log("═══════════════════════════════════════");
  console.log("A browser will open. Log in to LinkedIn manually.");
  console.log(`You have ${TIMEOUT_MS / 1000} seconds.\n`);

  const browser = await chromium.launch({
    headless: false, // Must be headful for manual login
    args: ["--disable-blink-features=AutomationControlled"],
    channel: "chrome",
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "en-GB",
  });

  const page = await context.newPage();
  await page.goto("https://www.linkedin.com/login", { waitUntil: "domcontentloaded" });

  console.log("⏳ Waiting for LinkedIn login...");
  console.log("   Log in manually in the browser window.\n");

  try {
    // Wait for LinkedIn feed page (post-login)
    await page.waitForURL("**/feed/**", { timeout: TIMEOUT_MS });
    console.log("✅ Logged in successfully!\n");
  } catch {
    // Also accept any LinkedIn home/main page
    const url = page.url();
    if (!url.includes("linkedin.com") || url.includes("login")) {
      console.error("❌ Login timeout or failed. Re-run the script and try again.");
      await browser.close();
      process.exit(1);
    }
    console.log("✅ Session detected.\n");
  }

  // Save storageState
  const storageState = await context.storageState();
  const sessionBase64 = Buffer.from(JSON.stringify(storageState)).toString("base64");

  // Write to file
  writeFileSync(SESSION_FILE, sessionBase64, "utf-8");
  console.log(`💾 Session saved to: ${SESSION_FILE}`);
  console.log("   (This file is gitignored — do not commit it)\n");

  console.log("📋 Next steps:");
  console.log("═══════════════════════════════════════");
  console.log("1. Copy the session string:");
  console.log(`   cat .linkedin-session | pbcopy   (macOS)`);
  console.log(`   Get-Content .linkedin-session | Set-Clipboard   (Windows)\n`);
  console.log("2. Add to Vercel environment:");
  console.log("   vercel env add LINKEDIN_SESSION_DATA\n");
  console.log("3. Add to .env.local for local Inngest dev:");
  console.log("   LINKEDIN_SESSION_DATA=<paste base64 string>\n");
  console.log(`Session (first 60 chars): ${sessionBase64.substring(0, 60)}...`);

  await browser.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});

/**
 * Inngest Serve Endpoint — Vercel Pro
 *
 * Single entry point that Inngest Cloud webhooks to deliver workflow executions.
 * Register this URL in the Inngest dashboard: https://your-app.vercel.app/api/inngest
 *
 * The serve() handler:
 *  - Validates Inngest's webhook signatures (INNGEST_SIGNING_KEY)
 *  - Routes events to the correct workflow functions
 *  - Handles step retries, idempotency, and state management
 *
 * Vercel Pro: maxDuration 300s configured in vercel.json.
 */

import { serve } from "inngest/node";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { inngest } from "./_utils/inngest.js";

// Workflow Functions
import { documentWorkflows } from "./inngest/document-workflows.js";
import { transcriptWorkflows } from "./inngest/transcript-workflows.js";
import { briefWorkflows } from "./inngest/brief-workflows.js";
import { dealWorkflows } from "./inngest/deal-workflows.js";
import { osintWorkflows } from "./inngest/osint-workflows.js";
import { financialWorkflows } from "./inngest/financial-workflows.js";
import { portfolioWorkflows } from "./inngest/portfolio-workflows.js";

import crypto from "node:crypto";

const handler = serve({
  client: inngest,
  functions: [
    ...documentWorkflows,
    ...transcriptWorkflows,
    ...briefWorkflows,
    ...dealWorkflows,
    ...osintWorkflows,
    ...financialWorkflows,
    ...portfolioWorkflows,
  ],
});

// Read request body stream manually
async function readBodyFromStream(req: any): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: any[] = [];
    req.on("data", (chunk: any) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export default async function inngestHandler(req: any, res: any) {
  let rawBody = "";
  
  if (req.body !== undefined && req.body !== null) {
    // Body was already parsed by Vercel
    rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  } else {
    // Body is still a stream, read it manually
    try {
      rawBody = await readBodyFromStream(req);
    } catch (err: any) {
      console.error("[Inngest Interceptor] Failed to read request stream:", err.message);
    }
  }

  const method = req.method;
  const signatureHeader = req.headers["x-inngest-signature"] || req.headers["X-Inngest-Signature"] || "";
  const signingKey = process.env.INNGEST_SIGNING_KEY;

  console.log(`[Inngest Interceptor] method: ${method}, url: ${req.url}, signatureHeader: ${signatureHeader ? "present" : "missing"}, body_len: ${rawBody.length}`);

  if (signatureHeader && signingKey) {
    try {
      const parts = signatureHeader.split(",");
      const timestampPart = parts.find((p: string) => p.startsWith("t="));
      const signaturePart = parts.find((p: string) => p.startsWith("s="));
      
      if (timestampPart && signaturePart) {
        const timestamp = timestampPart.split("=")[1];
        const receivedSig = signaturePart.split("=")[1];
        
        // Match Inngest prefix-removal logic: remove(/^signkey-[\w]+-/, "")
        const cleanKey = signingKey.replace(/^signkey-[\w]+-/, "");
        
        const hmac = crypto.createHmac("sha256", cleanKey);
        hmac.update(`${timestamp}:${rawBody}`);
        const expectedSig = hmac.digest("hex");
        
        console.log(`[Inngest Interceptor] Signature Verification check:
          t: ${timestamp}
          received_s: ${receivedSig}
          expected_s: ${expectedSig}
          matches: ${receivedSig === expectedSig}
          key_prefix: ${signingKey.substring(0, 15)}...
          clean_key_prefix: ${cleanKey.substring(0, 8)}...
        `);
      } else {
        console.log("[Inngest Interceptor] Signature header components missing:", signatureHeader);
      }
    } catch (err: any) {
      console.error("[Inngest Interceptor] Failed to check signature manually:", err.message);
    }
  } else {
    console.log(`[Inngest Interceptor] Signature header or signing key missing. sig: ${!!signatureHeader}, key: ${!!signingKey}`);
  }

  // Replay rawBody for downstream handlers (Inngest SDK serve handler)
  const buffer = Buffer.from(rawBody, "utf8");
  req.on = function (event: string, callback: any) {
    if (event === "data") {
      process.nextTick(() => callback(buffer));
      return this;
    }
    if (event === "end") {
      process.nextTick(() => callback());
      return this;
    }
    return this;
  };

  return (handler as any)(req, res);
}

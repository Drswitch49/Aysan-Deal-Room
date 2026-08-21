import { describe, expect, it } from "vitest";
import { classifyFailure } from "./failure.js";

/** The Anthropic SDK throws an Error whose message is "<status> <json body>"
 *  and carries the status on the object. Both forms appear in the jobs table. */
function apiError(status: number, body: unknown): Error & { status: number } {
  const err = new Error(`${status} ${JSON.stringify(body)}`) as Error & { status: number };
  err.status = status;
  return err;
}

describe("classifyFailure", () => {
  it("treats an exhausted credit balance as permanent and says how to fix it", () => {
    const err = apiError(400, {
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
      },
    });
    const { permanent, message } = classifyFailure(err);
    expect(permanent).toBe(true);
    expect(message).toMatch(/credit is exhausted/i);
    expect(message).toMatch(/console\.anthropic\.com/);
  });

  it("treats a rejected API key as permanent", () => {
    expect(classifyFailure(apiError(401, { error: { type: "authentication_error" } })).permanent).toBe(true);
  });

  it("keeps rate limits and upstream 5xx retryable", () => {
    expect(classifyFailure(apiError(429, { error: { type: "rate_limit_error" } })).permanent).toBe(false);
    expect(classifyFailure(apiError(529, { error: { type: "overloaded_error" } })).permanent).toBe(false);
  });

  it("treats handler preconditions as permanent — the payload never changes", () => {
    expect(classifyFailure(new Error("deal_id required")).permanent).toBe(true);
    expect(classifyFailure(new Error("deal abc not found")).permanent).toBe(true);
    expect(classifyFailure(new Error('No handler registered for job type "nope"')).permanent).toBe(true);
  });

  it("assumes an unrecognised failure is transient", () => {
    const { permanent, message } = classifyFailure(new Error("socket hang up"));
    expect(permanent).toBe(false);
    expect(message).toBe("socket hang up");
  });

  it("recognises AI-unavailable and refusal errors by name", () => {
    const unavailable = new Error("AI is not configured (ANTHROPIC_API_KEY missing).");
    unavailable.name = "AiUnavailableError";
    expect(classifyFailure(unavailable).permanent).toBe(true);

    const refused = new Error("Claude declined this request.");
    refused.name = "AiRefusedError";
    expect(classifyFailure(refused).permanent).toBe(true);
  });
});

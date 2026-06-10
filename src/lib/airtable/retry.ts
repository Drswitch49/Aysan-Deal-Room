export async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  shouldRetry?: (error: any) => boolean;
}

/**
 * Executes an async operation with exponential backoff retry logic.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const shouldRetry = options.shouldRetry ?? ((err: any) => {
    // Retry on 429 rate limits, or transient 5xx server errors, or request timeouts
    const status = err.status ?? err.statusCode;
    if (status === 429 || status >= 500) {
      return true;
    }
    const msg = String(err.message || "").toLowerCase();
    if (msg.includes("429") || msg.includes("timeout") || msg.includes("rate limit")) {
      return true;
    }
    return false;
  });

  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;
      if (attempt > maxRetries || !shouldRetry(error)) {
        throw error;
      }
      
      const backoffDelay = baseDelayMs * Math.pow(2, attempt - 1);
      console.warn(`[Airtable Retry] Attempt ${attempt} failed: ${error.message || error}. Retrying in ${backoffDelay}ms...`);
      await delay(backoffDelay);
    }
  }
}

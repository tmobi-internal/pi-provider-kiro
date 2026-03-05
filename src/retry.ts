// ABOUTME: Retry decision logic and exponential backoff for Kiro API requests.
// ABOUTME: Centralizes retry strategy selection based on HTTP status codes.

// kiro-cli uses 5-minute read/operation timeouts (DEFAULT_TIMEOUT_DURATION)
// and 5-minute stalled stream grace period. 90s matches the TUI's
// INITIAL_RESPONSE_TIMEOUT_MS for the first event from the backend.
export const FIRST_TOKEN_TIMEOUT = 90_000;

// Mutable config for values that tests need to override
export const retryConfig = {
  firstTokenTimeoutMs: FIRST_TOKEN_TIMEOUT,
};

export interface RetryDecision {
  shouldRetry: boolean;
  delayMs: number;
  strategy: "reduce" | "backoff" | "none";
}

export function exponentialBackoff(attempt: number, baseMs: number, maxMs: number): number {
  return Math.min(baseMs * 2 ** attempt, maxMs);
}

export const MAX_RETRY_DELAY = 10_000;

const TOO_BIG_PATTERNS = ["CONTENT_LENGTH_EXCEEDS_THRESHOLD", "Input is too long", "Improperly formed"];
const NON_RETRYABLE_BODY_PATTERNS = ["MONTHLY_REQUEST_COUNT", "INSUFFICIENT_MODEL_CAPACITY"];

export function decideRetry(status: number, errorText: string, attempt: number, maxRetries: number): RetryDecision {
  if (attempt >= maxRetries) return { shouldRetry: false, delayMs: 0, strategy: "none" };

  // Body-level non-retryable markers (any status) — matches kiro-cli retry classifier
  if (NON_RETRYABLE_BODY_PATTERNS.some((p) => errorText.includes(p))) {
    return { shouldRetry: false, delayMs: 0, strategy: "none" };
  }

  // 413 or 400 with size-related error text → don't retry, propagate immediately.
  // The caller (pi-ai) is responsible for handling context overflow (e.g., compaction/trimming).
  // This matches kiro-cli behavior where the RTS model never retries ContextWindowOverflow.
  if (status === 413 || (status === 400 && TOO_BIG_PATTERNS.some((p) => errorText.includes(p)))) {
    return { shouldRetry: false, delayMs: 0, strategy: "none" };
  }

  // 429 rate limited → backoff with 1s base
  if (status === 429) {
    return { shouldRetry: true, delayMs: exponentialBackoff(attempt, 1000, MAX_RETRY_DELAY), strategy: "backoff" };
  }

  // 5xx server errors → backoff with 1s base
  if (status >= 500 && status < 600) {
    return { shouldRetry: true, delayMs: exponentialBackoff(attempt, 1000, MAX_RETRY_DELAY), strategy: "backoff" };
  }

  // 403 transient auth race → shorter backoff with 500ms base
  if (status === 403) {
    return { shouldRetry: true, delayMs: exponentialBackoff(attempt, 500, MAX_RETRY_DELAY), strategy: "backoff" };
  }

  return { shouldRetry: false, delayMs: 0, strategy: "none" };
}

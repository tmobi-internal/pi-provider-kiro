// ABOUTME: Tests for retry decision logic and exponential backoff.
// ABOUTME: Covers all status codes, attempt boundaries, and delay calculations.

import { describe, expect, it } from "vitest";
import { decideRetry, exponentialBackoff, FIRST_TOKEN_TIMEOUT, MAX_RETRY_DELAY, retryConfig } from "../src/retry.js";

describe("exponentialBackoff", () => {
  it("returns baseMs for attempt 0", () => {
    expect(exponentialBackoff(0, 1000, 30000)).toBe(1000);
  });

  it("doubles delay for each attempt", () => {
    expect(exponentialBackoff(1, 1000, 30000)).toBe(2000);
    expect(exponentialBackoff(2, 1000, 30000)).toBe(4000);
    expect(exponentialBackoff(3, 1000, 30000)).toBe(8000);
  });

  it("caps delay at maxMs", () => {
    expect(exponentialBackoff(10, 1000, 30000)).toBe(30000);
  });

  it("works with custom base", () => {
    expect(exponentialBackoff(0, 500, 10000)).toBe(500);
    expect(exponentialBackoff(1, 500, 10000)).toBe(1000);
  });
});

describe("decideRetry", () => {
  const maxRetries = 3;

  describe("413 - Payload Too Large", () => {
    it("does not retry - propagates immediately for caller to handle", () => {
      const result = decideRetry(413, "too big", 0, maxRetries);
      expect(result.shouldRetry).toBe(false);
      expect(result.strategy).toBe("none");
    });
  });

  describe("400 - too big variants", () => {
    it("does not retry on CONTENT_LENGTH_EXCEEDS_THRESHOLD", () => {
      const result = decideRetry(400, "CONTENT_LENGTH_EXCEEDS_THRESHOLD", 0, maxRetries);
      expect(result.shouldRetry).toBe(false);
    });

    it("does not retry on Input is too long", () => {
      const result = decideRetry(400, "Input is too long for model", 0, maxRetries);
      expect(result.shouldRetry).toBe(false);
    });

    it("does not retry on Improperly formed", () => {
      const result = decideRetry(400, "Improperly formed request", 0, maxRetries);
      expect(result.shouldRetry).toBe(false);
    });

    it("does not retry on 400 without retryable message", () => {
      const result = decideRetry(400, "Invalid parameter: modelId", 0, maxRetries);
      expect(result.shouldRetry).toBe(false);
      expect(result.strategy).toBe("none");
    });
  });

  describe("non-retryable body patterns (kiro-cli parity)", () => {
    it("does not retry on MONTHLY_REQUEST_COUNT regardless of status", () => {
      for (const status of [400, 429, 500]) {
        const result = decideRetry(status, "MONTHLY_REQUEST_COUNT exceeded", 0, maxRetries);
        expect(result.shouldRetry).toBe(false);
        expect(result.strategy).toBe("none");
      }
    });

    it("does not retry on INSUFFICIENT_MODEL_CAPACITY regardless of status", () => {
      for (const status of [400, 500, 503]) {
        const result = decideRetry(status, "INSUFFICIENT_MODEL_CAPACITY", 0, maxRetries);
        expect(result.shouldRetry).toBe(false);
        expect(result.strategy).toBe("none");
      }
    });
  });

  describe("429 - Rate Limited", () => {
    it("returns backoff strategy with exponential delay", () => {
      const result = decideRetry(429, "rate limited", 0, maxRetries);
      expect(result.shouldRetry).toBe(true);
      expect(result.strategy).toBe("backoff");
      expect(result.delayMs).toBe(1000);
    });

    it("increases delay on subsequent attempts", () => {
      const r1 = decideRetry(429, "", 1, maxRetries);
      expect(r1.delayMs).toBe(2000);
      const r2 = decideRetry(429, "", 2, maxRetries);
      expect(r2.delayMs).toBe(4000);
    });

    it("does not retry when attempt >= maxRetries", () => {
      const result = decideRetry(429, "", 3, maxRetries);
      expect(result.shouldRetry).toBe(false);
    });
  });

  describe("5xx - Server Errors", () => {
    it("retries 500 with backoff", () => {
      const result = decideRetry(500, "Internal Server Error", 0, maxRetries);
      expect(result.shouldRetry).toBe(true);
      expect(result.strategy).toBe("backoff");
      expect(result.delayMs).toBe(1000);
    });

    it("retries 502 with backoff", () => {
      const result = decideRetry(502, "Bad Gateway", 0, maxRetries);
      expect(result.shouldRetry).toBe(true);
      expect(result.strategy).toBe("backoff");
    });

    it("retries 503 with backoff", () => {
      const result = decideRetry(503, "Service Unavailable", 1, maxRetries);
      expect(result.shouldRetry).toBe(true);
      expect(result.delayMs).toBe(2000);
    });

    it("caps backoff delay at MAX_RETRY_DELAY (10s)", () => {
      const result = decideRetry(500, "", 10, 20);
      expect(result.delayMs).toBeLessThanOrEqual(MAX_RETRY_DELAY);
      expect(result.delayMs).toBe(MAX_RETRY_DELAY);
    });
  });

  describe("403 - Forbidden (transient auth race)", () => {
    it("retries with shorter backoff", () => {
      const result = decideRetry(403, "forbidden", 0, maxRetries);
      expect(result.shouldRetry).toBe(true);
      expect(result.strategy).toBe("backoff");
      expect(result.delayMs).toBe(500);
    });

    it("increases delay on subsequent attempts", () => {
      const r1 = decideRetry(403, "", 1, maxRetries);
      expect(r1.delayMs).toBe(1000);
      const r2 = decideRetry(403, "", 2, maxRetries);
      expect(r2.delayMs).toBe(2000);
    });

    it("does not retry when attempt >= maxRetries", () => {
      const result = decideRetry(403, "", 3, maxRetries);
      expect(result.shouldRetry).toBe(false);
    });
  });

  describe("non-retryable statuses", () => {
    it("does not retry 401", () => {
      const result = decideRetry(401, "Unauthorized", 0, maxRetries);
      expect(result.shouldRetry).toBe(false);
      expect(result.strategy).toBe("none");
    });

    it("does not retry 404", () => {
      const result = decideRetry(404, "Not Found", 0, maxRetries);
      expect(result.shouldRetry).toBe(false);
    });

    it("does not retry 422", () => {
      const result = decideRetry(422, "Unprocessable Entity", 0, maxRetries);
      expect(result.shouldRetry).toBe(false);
    });
  });
});

describe("MAX_RETRY_DELAY", () => {
  it("is exported as 10000ms", () => {
    expect(MAX_RETRY_DELAY).toBe(10000);
  });
});

describe("FIRST_TOKEN_TIMEOUT", () => {
  it("is exported as 15000ms", () => {
    expect(FIRST_TOKEN_TIMEOUT).toBe(15000);
  });

  it("retryConfig.firstTokenTimeoutMs defaults to FIRST_TOKEN_TIMEOUT", () => {
    expect(retryConfig.firstTokenTimeoutMs).toBe(FIRST_TOKEN_TIMEOUT);
  });

  it("retryConfig.firstTokenTimeoutMs is mutable for testing", () => {
    const original = retryConfig.firstTokenTimeoutMs;
    retryConfig.firstTokenTimeoutMs = 100;
    expect(retryConfig.firstTokenTimeoutMs).toBe(100);
    retryConfig.firstTokenTimeoutMs = original;
  });
});

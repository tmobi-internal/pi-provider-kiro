import { beforeEach, describe, expect, it } from "vitest";
import {
  consumeContentTruncation,
  consumeTruncationWarning,
  saveContentTruncation,
  saveTruncationWarning,
  resetCaches,
} from "../src/truncation-cache.js";

describe("truncation-cache", () => {
  beforeEach(() => {
    resetCaches();
  });

  it("saves and consumes a tool truncation warning", () => {
    saveTruncationWarning("call-1", "write");
    const warning = consumeTruncationWarning("call-1");
    expect(warning).toContain("[API Limitation]");
    expect(warning).toContain("write");
  });

  it("consumes only once", () => {
    saveTruncationWarning("call-1", "write");
    consumeTruncationWarning("call-1");
    expect(consumeTruncationWarning("call-1")).toBeUndefined();
  });

  it("saves and consumes a content truncation warning", () => {
    saveContentTruncation("some long content");
    const warning = consumeContentTruncation("some long content");
    expect(warning).toContain("[System Notice]");
  });

  it("content truncation consumes only once", () => {
    saveContentTruncation("some content");
    consumeContentTruncation("some content");
    expect(consumeContentTruncation("some content")).toBeUndefined();
  });

  it("evicts tool cache when max size exceeded", () => {
    for (let i = 0; i < 100; i++) {
      saveTruncationWarning(`call-${i}`, `tool-${i}`);
    }

    // 101st entry triggers eviction before insert
    saveTruncationWarning("call-100", "tool-100");
    // Old entries should be gone
    expect(consumeTruncationWarning("call-0")).toBeUndefined();
    // New entry should exist
    expect(consumeTruncationWarning("call-100")).toBeDefined();
  });

  it("evicts content cache when max size exceeded", () => {
    for (let i = 0; i < 100; i++) {
      saveContentTruncation(`content-${i}`);
    }

    // 101st entry triggers eviction before insert
    saveContentTruncation("content-100");
    // Old entries should be gone
    expect(consumeContentTruncation("content-0")).toBeUndefined();
    // New entry should exist
    expect(consumeContentTruncation("content-100")).toBeDefined();
  });
});

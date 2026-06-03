import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

const { existsSync, readFileSync, writeFileSync } = await import("node:fs");
const { execFileSync } = await import("node:child_process");

describe("Model cache and API integration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(writeFileSync).mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function loadModels() {
    const mod = await import("../src/models.js");
    return mod;
  }

  const API_MODELS = [
    {
      modelId: "claude-sonnet-4.6",
      modelName: "Claude Sonnet 4.6",
      tokenLimits: { maxInputTokens: 1000000, maxOutputTokens: 64000 },
      additionalModelRequestFieldsSchema: { properties: { thinking: { type: "object" } } },
      supportedInputTypes: ["TEXT", "IMAGE"],
    },
    {
      modelId: "minimax-m2.5",
      modelName: "MiniMax M2.5",
      tokenLimits: { maxInputTokens: 196000, maxOutputTokens: 64000 },
      additionalModelRequestFieldsSchema: null,
      supportedInputTypes: ["TEXT"],
    },
  ];

  describe("buildModelFromApi via cache", () => {
    it("reads contextWindow and maxTokens from API response", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ models: API_MODELS, timestamp: Date.now(), apiRegion: "us-east-1" }),
      );

      const { getKiroModels } = await loadModels();
      const models = getKiroModels();
      const sonnet = models.find((m) => m.id === "claude-sonnet-4-6");

      expect(sonnet?.contextWindow).toBe(1000000);
      expect(sonnet?.maxTokens).toBe(64000);
    });

    it("detects reasoning from additionalModelRequestFieldsSchema.properties.thinking", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ models: API_MODELS, timestamp: Date.now(), apiRegion: "us-east-1" }),
      );

      const { getKiroModels } = await loadModels();
      const models = getKiroModels();

      expect(models.find((m) => m.id === "claude-sonnet-4-6")?.reasoning).toBe(true);
      expect(models.find((m) => m.id === "minimax-m2-5")?.reasoning).toBe(false);
    });

    it("maps supportedInputTypes to lowercase text/image", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ models: API_MODELS, timestamp: Date.now(), apiRegion: "us-east-1" }),
      );

      const { getKiroModels } = await loadModels();
      const models = getKiroModels();

      expect(models.find((m) => m.id === "claude-sonnet-4-6")?.input).toEqual(["text", "image"]);
      expect(models.find((m) => m.id === "minimax-m2-5")?.input).toEqual(["text"]);
    });
  });

  describe("legacy cache handling", () => {
    it("discards legacy string[] cache format", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ models: ["claude-sonnet-4-6", "auto"], timestamp: Date.now() }),
      );
      vi.mocked(execFileSync).mockImplementation(() => { throw new Error("no cli"); });

      const { getKiroModels } = await loadModels();
      const models = getKiroModels();

      // Falls through to FALLBACK_MODEL_IDS
      expect(models.length).toBeGreaterThan(0);
      expect(models[0].id).not.toBe("claude-sonnet-4-6");
    });
  });

  describe("stale cache behavior", () => {
    it("uses stale API cache as fallback when no fresh data", async () => {
      const staleTimestamp = Date.now() - 2 * 24 * 60 * 60 * 1000; // 2 days old
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ models: API_MODELS, timestamp: staleTimestamp, apiRegion: "us-east-1" }),
      );
      vi.mocked(execFileSync).mockImplementation(() => { throw new Error("no cli"); });

      const { getKiroModels } = await loadModels();
      const models = getKiroModels();

      // Should still use stale cache models
      expect(models.find((m) => m.id === "claude-sonnet-4-6")).toBeDefined();
    });
  });

  describe("refreshModelsCache", () => {
    it("skips fetch when cache is fresh for same region", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ models: API_MODELS, timestamp: Date.now(), apiRegion: "us-east-1" }),
      );

      const { refreshModelsCache } = await loadModels();
      await refreshModelsCache("token", "us-east-1");

      expect(fetch).not.toHaveBeenCalled();
    });

    it("fetches when cache is stale", async () => {
      const staleTimestamp = Date.now() - 2 * 24 * 60 * 60 * 1000;
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ models: API_MODELS, timestamp: staleTimestamp, apiRegion: "us-east-1" }),
      );
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ models: API_MODELS }),
      } as Response);

      const { refreshModelsCache } = await loadModels();
      await refreshModelsCache("token", "us-east-1");

      expect(fetch).toHaveBeenCalled();
      expect(writeFileSync).toHaveBeenCalled();
    });

    it("updates cachedModels array in place", async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(execFileSync).mockImplementation(() => { throw new Error("no cli"); });
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ models: API_MODELS }),
      } as Response);

      const { getKiroModels, refreshModelsCache } = await loadModels();
      const before = getKiroModels();
      const ref = before;

      await refreshModelsCache("token", "us-east-1");

      const after = getKiroModels();
      expect(after).toBe(ref); // Same array reference
      expect(after.find((m) => m.id === "claude-sonnet-4-6")).toBeDefined();
    });
  });
});

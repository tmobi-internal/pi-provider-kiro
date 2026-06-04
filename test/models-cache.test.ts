import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

const { existsSync, readFileSync, writeFileSync } = await import("node:fs");

describe("Model loading and cache", () => {
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

  const CACHE_MODELS = [
    { modelId: "claude-sonnet-4.6", modelName: "Claude Sonnet 4.6", reasoning: true, input: ["text", "image"], contextWindow: 1000000, maxTokens: 64000, promptCaching: true },
    { modelId: "minimax-m2.5", modelName: "MiniMax M2.5", reasoning: false, input: ["text"], contextWindow: 196000, maxTokens: 64000, promptCaching: false },
  ];

  const API_RESPONSE = {
    models: [
      {
        modelId: "claude-sonnet-4.6",
        modelName: "Claude Sonnet 4.6",
        tokenLimits: { maxInputTokens: 1000000, maxOutputTokens: 64000 },
        additionalModelRequestFieldsSchema: { properties: { thinking: { type: "object" } } },
        supportedInputTypes: ["TEXT", "IMAGE"],
        promptCaching: { supportsPromptCaching: true },
      },
      {
        modelId: "minimax-m2.5",
        modelName: "MiniMax M2.5",
        tokenLimits: { maxInputTokens: 196000, maxOutputTokens: 64000 },
        additionalModelRequestFieldsSchema: null,
        supportedInputTypes: ["TEXT"],
        promptCaching: { supportsPromptCaching: false },
      },
    ],
  };

  function freshCache() {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      apiRegion: "us-east-1",
      models: CACHE_MODELS,
    });
  }

  function staleCache() {
    const staleDate = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
    return JSON.stringify({
      timestamp: staleDate,
      apiRegion: "us-east-1",
      models: CACHE_MODELS,
    });
  }

  async function loadModels() {
    return await import("../src/models.js");
  }

  describe("getKiroModels (sync path)", () => {
    it("reads from fresh cache file", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(freshCache());

      const { getKiroModels } = await loadModels();
      const models = getKiroModels();

      expect(models.find((m) => m.id === "claude-sonnet-4-6")?.contextWindow).toBe(1000000);
      expect(models.find((m) => m.id === "minimax-m2-5")?.reasoning).toBe(false);
    });

    it("uses stale cache as fallback (sync path always uses cache regardless of TTL)", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(staleCache());

      const { getKiroModels } = await loadModels();
      const models = getKiroModels();

      expect(models.find((m) => m.id === "claude-sonnet-4-6")).toBeDefined();
    });

    it("falls back to hardcoded models when no cache", async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const { getKiroModels } = await loadModels();
      const models = getKiroModels();

      expect(models.length).toBeGreaterThan(0);
      expect(models[0].provider).toBe("kiro");
    });

    it("discards legacy string[] cache format", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ models: ["claude-sonnet-4-6", "auto"], timestamp: new Date().toISOString() }),
      );

      const { getKiroModels } = await loadModels();
      const models = getKiroModels();

      // Falls through to FALLBACK
      expect(models[0].id).not.toBe("claude-sonnet-4-6");
    });
  });

  describe("loadKiroModels (async path)", () => {
    it("uses fresh cache without API call", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(freshCache());

      const { loadKiroModels } = await loadModels();
      await loadKiroModels("token", "us-east-1");

      expect(fetch).not.toHaveBeenCalled();
    });

    it("calls API when cache is stale", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(staleCache());
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => API_RESPONSE,
      } as Response);

      const { loadKiroModels } = await loadModels();
      const models = await loadKiroModels("token", "us-east-1");

      expect(fetch).toHaveBeenCalled();
      expect(models.find((m) => m.id === "claude-sonnet-4-6")?.reasoning).toBe(true);
      expect(writeFileSync).toHaveBeenCalled();
    });

    it("calls API when no cache exists", async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => API_RESPONSE,
      } as Response);

      const { loadKiroModels } = await loadModels();
      const models = await loadKiroModels("token", "us-east-1");

      expect(fetch).toHaveBeenCalled();
      expect(models.find((m) => m.id === "claude-sonnet-4-6")).toBeDefined();
    });

    it("falls back to stale cache when API fails", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(staleCache());
      vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);

      const { loadKiroModels } = await loadModels();
      const models = await loadKiroModels("token", "us-east-1");

      expect(models.find((m) => m.id === "claude-sonnet-4-6")).toBeDefined();
    });

    it("uses fallback when no token and no cache", async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const { loadKiroModels } = await loadModels();
      const models = await loadKiroModels(undefined, undefined);

      expect(fetch).not.toHaveBeenCalled();
      expect(models.length).toBeGreaterThan(0);
    });

    it("saves cache as prettified JSON with normalized format", async () => {
      vi.mocked(existsSync).mockImplementation((p) => !String(p).includes("kiro-models"));
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => API_RESPONSE,
      } as Response);

      const { loadKiroModels } = await loadModels();
      await loadKiroModels("token", "us-east-1");

      const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
      const parsed = JSON.parse(written);

      expect(parsed.timestamp).toBeDefined();
      expect(parsed.apiRegion).toBe("us-east-1");
      expect(parsed.models[0].modelId).toBe("claude-sonnet-4.6");
      expect(parsed.models[0].reasoning).toBe(true);
      expect(parsed.models[0].input).toEqual(["text", "image"]);
      expect(parsed.models[0].contextWindow).toBe(1000000);
      expect(parsed.models[0].promptCaching).toBe(true);

      // Prettified
      expect(written).toContain("\n");
    });

    it("normalizes unknown input types to text-only", async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          models: [{
            modelId: "new-model",
            modelName: "New Model",
            tokenLimits: { maxInputTokens: 100000, maxOutputTokens: 32000 },
            additionalModelRequestFieldsSchema: null,
            supportedInputTypes: ["TEXT", "VIDEO", "AUDIO"],
            promptCaching: null,
          }],
        }),
      } as Response);

      const { loadKiroModels } = await loadModels();
      const models = await loadKiroModels("token", "us-east-1");

      expect(models.find((m) => m.id === "new-model")?.input).toEqual(["text"]);
    });
  });
});

describe("Dynamic model refresh (modifyModels support)", () => {
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

  const CACHE_MODELS = [
    { modelId: "claude-sonnet-4.6", modelName: "Claude Sonnet 4.6", reasoning: true, input: ["text", "image"], contextWindow: 1000000, maxTokens: 64000, promptCaching: true },
    { modelId: "minimax-m2.5", modelName: "MiniMax M2.5", reasoning: false, input: ["text"], contextWindow: 196000, maxTokens: 64000, promptCaching: false },
  ];

  function freshCache() {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      apiRegion: "us-east-1",
      models: CACHE_MODELS,
    });
  }

  it("usedFallback is true after loadKiroModels without token or cache", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const mod = await import("../src/models.js");
    await mod.loadKiroModels(undefined, undefined);
    expect(mod.usedFallback).toBe(true);
  });

  it("usedFallback is false after loadKiroModels with fresh cache", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(freshCache());
    const mod = await import("../src/models.js");
    await mod.loadKiroModels(undefined, undefined);
    expect(mod.usedFallback).toBe(false);
  });

  it("readCachedModels returns models from cache file", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(freshCache());
    const { readCachedModels } = await import("../src/models.js");
    const models = readCachedModels();
    expect(models).not.toBeNull();
    expect(models!.find((m) => m.id === "claude-sonnet-4-6")).toBeDefined();
  });

  it("readCachedModels returns null when no cache", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const { readCachedModels } = await import("../src/models.js");
    expect(readCachedModels()).toBeNull();
  });

  it("triggerModelCacheRefresh calls API once and saves cache", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{
          modelId: "claude-sonnet-4.6",
          modelName: "Claude Sonnet 4.6",
          tokenLimits: { maxInputTokens: 1000000, maxOutputTokens: 64000 },
          additionalModelRequestFieldsSchema: { properties: { thinking: {} } },
          supportedInputTypes: ["TEXT", "IMAGE"],
          promptCaching: { supportsPromptCaching: true },
        }],
      }),
    } as Response);

    const { triggerModelCacheRefresh } = await import("../src/models.js");
    triggerModelCacheRefresh("token", "us-east-1");

    // Wait for fire-and-forget to complete
    await new Promise((r) => setTimeout(r, 10));

    expect(fetch).toHaveBeenCalledOnce();
    expect(writeFileSync).toHaveBeenCalled();
  });

  it("triggerModelCacheRefresh only fires once per session", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ models: [] }),
    } as Response);

    const { triggerModelCacheRefresh } = await import("../src/models.js");
    triggerModelCacheRefresh("token", "us-east-1");
    triggerModelCacheRefresh("token", "us-east-1");

    await new Promise((r) => setTimeout(r, 10));

    expect(fetch).toHaveBeenCalledOnce();
  });

  it("triggerModelCacheRefresh sets usedFallback to false on success", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ modelId: "test", modelName: "Test", tokenLimits: {}, supportedInputTypes: ["TEXT"] }],
      }),
    } as Response);

    const mod = await import("../src/models.js");
    await mod.loadKiroModels(undefined, undefined); // sets usedFallback = true
    expect(mod.usedFallback).toBe(true);

    mod.triggerModelCacheRefresh("token", "us-east-1");
    await new Promise((r) => setTimeout(r, 10));

    expect(mod.usedFallback).toBe(false);
  });
});

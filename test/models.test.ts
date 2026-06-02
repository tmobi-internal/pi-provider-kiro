import { describe, expect, it } from "vitest";
import { filterModelsByRegion, KIRO_MODEL_IDS, kiroModels, resolveApiRegion, resolveKiroModel } from "../src/models.js";

describe("Feature 2: Model Definitions", () => {
  describe("resolveKiroModel", () => {
    it.each([
      ["claude-opus-4-6", "claude-opus-4.6"],
      ["claude-sonnet-4-6", "claude-sonnet-4.6"],
      ["claude-opus-4-5", "claude-opus-4.5"],
      ["claude-sonnet-4-5", "claude-sonnet-4.5"],
      ["claude-sonnet-4", "claude-sonnet-4"],
      ["claude-haiku-4-5", "claude-haiku-4.5"],
      ["deepseek-3-2", "deepseek-3.2"],
      ["minimax-m2-1", "minimax-m2.1"],
      ["minimax-m2-5", "minimax-m2.5"],
      ["glm-5", "glm-5"],
      ["qwen3-coder-next", "qwen3-coder-next"],
    ])("maps %s → %s", (piId, kiroId) => {
      expect(resolveKiroModel(piId)).toBe(kiroId);
    });

    it("throws on unknown model ID", () => {
      expect(() => resolveKiroModel("nonexistent")).toThrow("Unknown Kiro model ID");
    });
  });

  describe("KIRO_MODEL_IDS", () => {
    it("contains 12 model IDs", () => {
      expect(KIRO_MODEL_IDS.size).toBe(12);
    });
  });

  describe("resolveApiRegion", () => {
    it("maps us-east-2 to us-east-1", () => {
      expect(resolveApiRegion("us-east-2")).toBe("us-east-1");
    });

    it("maps eu-west-1 to eu-central-1", () => {
      expect(resolveApiRegion("eu-west-1")).toBe("eu-central-1");
    });

    it("maps ap-southeast-2 to us-east-1", () => {
      expect(resolveApiRegion("ap-southeast-2")).toBe("us-east-1");
    });

    it("passes through us-east-1 unchanged", () => {
      expect(resolveApiRegion("us-east-1")).toBe("us-east-1");
    });

    it("defaults to us-east-1 when undefined", () => {
      expect(resolveApiRegion(undefined)).toBe("us-east-1");
    });
  });

  describe("filterModelsByRegion", () => {
    it("returns all models unchanged (CLI already filters by region)", () => {
      expect(filterModelsByRegion(kiroModels, "us-east-1")).toHaveLength(kiroModels.length);
      expect(filterModelsByRegion(kiroModels, "eu-central-1")).toHaveLength(kiroModels.length);
    });
  });
  });

  describe("model catalog", () => {
    it("defines at least 5 models", () => {
      expect(kiroModels.length).toBeGreaterThanOrEqual(5);
    });

    it("claude-haiku-4-5 has reasoning=false", () => {
      expect(kiroModels.find((m) => m.id === "claude-haiku-4-5")?.reasoning).toBe(false);
    });

    it("minimax has reasoning=false", () => {
      expect(kiroModels.find((m) => m.id === "minimax-m2-1")?.reasoning).toBe(false);
    });

    it("1M context models have 1M context window", () => {
      const oneMillionModels = kiroModels.filter((m) => m.id.includes("1m"));
      expect(oneMillionModels.every((m) => m.contextWindow === 1000000)).toBe(true);
    });

    it("Claude models support text and image input", () => {
      const claudeModels = kiroModels.filter((m) => m.id.startsWith("claude-"));
      expect(claudeModels.every((m) => m.input.includes("text") && m.input.includes("image"))).toBe(true);
    });

    it("non-Claude models (except auto) support text only", () => {
      const textOnlyModels = kiroModels.filter((m) => !m.id.startsWith("claude-") && m.id !== "auto");
      expect(textOnlyModels.every((m) => m.input.includes("text") && !m.input.includes("image"))).toBe(true);
    });

    it("all models have zero cost", () => {
      expect(kiroModels.every((m) => m.cost.input === 0 && m.cost.output === 0)).toBe(true);
    });

    it("all models have maxTokens >= 64000", () => {
      expect(kiroModels.every((m) => m.maxTokens >= 64000)).toBe(true);
    });
  });

  describe("thinkingLevelMap — pi UI exposes xhigh", () => {
    const EXTENDED_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
    type Level = (typeof EXTENDED_LEVELS)[number];

    function supportedLevels(model: (typeof kiroModels)[number]): Level[] {
      if (!model.reasoning) return ["off"];
      return EXTENDED_LEVELS.filter((level) => {
        const mapped = (model as { thinkingLevelMap?: Partial<Record<Level, string | null>> }).thinkingLevelMap?.[
          level
        ];
        if (mapped === null) return false;
        if (level === "xhigh") return mapped !== undefined;
        return true;
      });
    }

    const XHIGH_MODELS = ["claude-opus-4-6"];

    it("Opus 4.6 offers xhigh (and all other levels)", () => {
      for (const m of kiroModels.filter((x) => XHIGH_MODELS.includes(x.id))) {
        expect(supportedLevels(m), `${m.id} supported levels`).toEqual([
          "off",
          "minimal",
          "low",
          "medium",
          "high",
          "xhigh",
        ]);
      }
    });

    it("other reasoning models offer up to high (no xhigh)", () => {
      for (const m of kiroModels.filter((x) => x.reasoning && !XHIGH_MODELS.includes(x.id))) {
        expect(supportedLevels(m), `${m.id} supported levels`).toEqual(["off", "minimal", "low", "medium", "high"]);
      }
    });

    it("non-reasoning models still collapse to ['off']", () => {
      for (const m of kiroModels.filter((x) => !x.reasoning)) {
        expect(supportedLevels(m), `${m.id} supported levels`).toEqual(["off"]);
      }
    });
  });
});

import { describe, expect, it } from "vitest";
import { filterModelsByRegion, KIRO_MODEL_IDS, kiroModels, resolveApiRegion, resolveKiroModel } from "../src/models.js";

describe("Feature 2: Model Definitions", () => {
  describe("resolveKiroModel", () => {
    it.each([
      ["claude-sonnet-4-6", "claude-sonnet-4.6"],
      ["claude-sonnet-4", "claude-sonnet-4"],
      ["auto", "auto"],
    ])("maps %s → %s", (piId, kiroId) => {
      expect(resolveKiroModel(piId)).toBe(kiroId);
    });

    it("throws on unknown model ID", () => {
      expect(() => resolveKiroModel("nonexistent")).toThrow("Unknown Kiro model ID");
    });
  });

  describe("KIRO_MODEL_IDS", () => {
    it("contains fallback model IDs", () => {
      expect(KIRO_MODEL_IDS.size).toBeGreaterThanOrEqual(5);
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
    it("returns all models unchanged", () => {
      expect(filterModelsByRegion(kiroModels, "us-east-1")).toHaveLength(kiroModels.length);
      expect(filterModelsByRegion(kiroModels, "eu-central-1")).toHaveLength(kiroModels.length);
    });
  });

  describe("model catalog (fallback)", () => {
    it("defines at least 5 models", () => {
      expect(kiroModels.length).toBeGreaterThanOrEqual(5);
    });

    it("all models have zero cost", () => {
      expect(kiroModels.every((m) => m.cost.input === 0 && m.cost.output === 0)).toBe(true);
    });

    it("all models have maxTokens >= 64000", () => {
      expect(kiroModels.every((m) => m.maxTokens >= 64000)).toBe(true);
    });

    it("auto model has reasoning=true", () => {
      expect(kiroModels.find((m) => m.id === "auto")?.reasoning).toBe(true);
    });

    it("all models support text input", () => {
      expect(kiroModels.every((m) => m.input.includes("text"))).toBe(true);
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

    it("Opus 4.6 offers xhigh", () => {
      const opus = kiroModels.filter((x) => x.id === "claude-opus-4-6");
      if (opus.length === 0) return; // Model not in current model set
      for (const m of opus) {
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

    it("non-opus reasoning models offer up to high", () => {
      const nonOpus = kiroModels.filter((x) => x.reasoning && !x.id.startsWith("claude-opus-"));
      for (const m of nonOpus) {
        expect(supportedLevels(m), `${m.id} supported levels`).toEqual(["off", "minimal", "low", "medium", "high"]);
      }
    });
  });
});

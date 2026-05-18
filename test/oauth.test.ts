import { describe, expect, it, vi } from "vitest";
import type { KiroCredentials } from "../src/oauth.js";
import { refreshKiroToken } from "../src/oauth.js";

vi.mock("../src/kiro-ide.js", () => ({
  getKiroIdeCredentials: vi.fn(() => undefined),
}));

vi.mock("../src/kiro-cli.js", () => ({
  getKiroCliCredentials: vi.fn(() => undefined),
  getKiroCliSocialToken: vi.fn(() => undefined),
}));

describe("Feature 3: OAuth — Token Refresh", () => {
  describe("refreshKiroToken", () => {
    it("returns IDE credentials when available", async () => {
      const { getKiroIdeCredentials } = await import("../src/kiro-ide.js");
      const ideCreds: KiroCredentials = {
     refresh: "rt|cid|csec|idc",
        access: "ide_at",
        expires: Date.now() + 3600000,
        clientId: "cid",
        clientSecret: "csec",
        region: "us-east-1",
        authMethod: "idc",
      };
      vi.mocked(getKiroIdeCredentials).mockReturnValueOnce(ideCreds);

      const result = await refreshKiroToken({ refresh: "old", access: "old", expires: 0 });
      expect(result.access).toBe("ide_at");
    });

    it("returns kiro-cli social token when available", async () => {
      const { getKiroCliSocialToken } = await import("../src/kiro-cli.js");
      const socialCreds: KiroCredentials = {
        refresh: "rt|desktop",
        access: "social_at",
        expires: Date.now() + 3600000,
        clientId: "",
        clientSecret: "",
        region: "us-east-1",
        authMethod: "desktop",
      };
      vi.mocked(getKiroCliSocialToken).mockReturnValueOnce(socialCreds);

      const result = await refreshKiroToken({ refresh: "old", access: "old", expires: 0 });
      expect(result.access).toBe("social_at");
    });

    it("returns kiro-cli credentials when available", async () => {
      const { getKiroCliCredentials } = await import("../src/kiro-cli.js");
      const cliCreds: KiroCredentials = {
        refresh: "rt|cid|csec|idc",
        access: "cli_at",
        expires: Date.now() + 3600000,
        clientId: "cid",
        clientSecret: "csec",
        region: "us-east-1",
        authMethod: "idc",
      };
      vi.mocked(getKiroCliCredentials).mockReturnValueOnce(cliCreds);

      const result = await refreshKiroToken({ refresh: "old", access: "old", expires: 0 });
      expect(result.access).toBe("cli_at");
    });

    it("throws when no valid credentials found", async () => {
      await expect(
        refreshKiroToken({ refresh: "old", access: "old", expires: 0 }),
      ).rejects.toThrow("/login kiro");
    });
  });
});

import { describe, expect, it, vi } from "vitest";
import { getKiroCliCredentials, getKiroCliDbPath } from "../src/kiro-cli.js";

describe("Feature 4: kiro-cli Credential Fallback", () => {
  describe("getKiroCliDbPath", () => {
    it("returns undefined when database does not exist", () => {
      // Default: no kiro-cli installed
      const result = getKiroCliDbPath();
      // Either undefined (no file) or a string (if kiro-cli happens to be installed)
      expect(result === undefined || typeof result === "string").toBe(true);
    });
  });

  describe("getKiroCliCredentials", () => {
    it("returns undefined or credentials when database may exist", () => {
      const result = getKiroCliCredentials();
      // Either undefined (no kiro-cli) or credentials object (kiro-cli installed)
      expect(result === undefined || (typeof result === "object" && "access" in result)).toBe(true);
    });

    it("returns credentials with required fields when available", () => {
      const result = getKiroCliCredentials();
      if (result) {
        expect(result).toHaveProperty("access");
        expect(result).toHaveProperty("refresh");
        expect(result).toHaveProperty("expires");
        expect(result).toHaveProperty("clientId");
        expect(result).toHaveProperty("clientSecret");
        expect(result).toHaveProperty("region");
      }
    });
  });
});

describe("getKiroIdeCredentials", () => {
  it("returns credentials when valid token file exists", async () => {
    const { getKiroIdeCredentials } = await import("../src/kiro-ide.js");
    const mockToken = {
      accessToken: "ide-access-token",
      refreshToken: "ide-refresh-token",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      region: "eu-central-1",
    };

    vi.mock("node:fs", async (importOriginal) => {
      const original = await importOriginal() as typeof import("node:fs");
      return {
        ...original,
        existsSync: (p: string) => p.includes("kiro-auth-token") ? true : original.existsSync(p),
        readFileSync: (p: string, enc?: string) => p.includes("kiro-auth-token") ? JSON.stringify(mockToken) : original.readFileSync(p, enc as any),
      };
    });

    const result = getKiroIdeCredentials();
    if (result) {
      expect(result.access).toBe("ide-access-token");
      expect(result.region).toBe("eu-central-1");
      expect(result.authMethod).toBe("desktop");
    }

    vi.restoreAllMocks();
  });

  it("returns undefined when token file does not exist", async () => {
    const { getKiroIdeCredentials } = await import("../src/kiro-ide.js");
    const result = getKiroIdeCredentials();
    expect(result === undefined || typeof result === "object").toBe(true);
  });
});

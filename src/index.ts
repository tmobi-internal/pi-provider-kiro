// Feature 1: Extension Registration
//
// Entry point that wires all features together via pi.registerProvider().

import type { Api, Model, OAuthCredentials } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getKiroCliCredentials } from "./kiro-cli.js";
import { setExtensionContext } from "./login-ui.js";
import { filterModelsByRegion, kiroModels, resolveApiRegion } from "./models.js";
import type { KiroCredentials } from "./oauth.js";
import { loginKiro, refreshKiroToken } from "./oauth.js";
import { streamKiro } from "./stream.js";
import { fetchKiroUsage } from "./usage.js";

export default function (pi: ExtensionAPI) {
  // Capture ctx for the custom TUI login component
  pi.on("session_start", async (_event, ctx) => {
    setExtensionContext(ctx);
  });
  pi.registerProvider("kiro", {
    baseUrl: "https://q.us-east-1.amazonaws.com/generateAssistantResponse",
    api: "kiro-api",
    models: kiroModels,
    oauth: {
      // Name reflects all supported auth methods: AWS Builder ID, Google, GitHub
      name: "Kiro (Builder ID / Google / GitHub)",
      login: loginKiro,
      refreshToken: refreshKiroToken,
      getApiKey: (cred: OAuthCredentials) => cred.access,
      getCliCredentials: getKiroCliCredentials,
      modifyModels: (models: Model<Api>[], cred: OAuthCredentials) => {
        const apiRegion = resolveApiRegion((cred as KiroCredentials).region);
        const kiroOnly = models.filter((m: Model<Api>) => m.provider === "kiro");
        const nonKiro = models.filter((m: Model<Api>) => m.provider !== "kiro");
        const modifiedKiro = filterModelsByRegion(kiroOnly, apiRegion).map((m: Model<Api>) => ({
          ...m,
          baseUrl: `https://q.${apiRegion}.amazonaws.com/generateAssistantResponse`,
        }));

        return [...nonKiro, ...modifiedKiro];
      },
      fetchUsage: fetchKiroUsage,
      // biome-ignore lint/suspicious/noExplicitAny: ProviderConfig.oauth doesn't include getCliCredentials but OAuthProviderInterface does
    } as any,
    streamSimple: streamKiro,
  });

  pi.registerCommand("login-kiro", {
    description: "Re-login to Kiro (opens browser)",
    handler: async (_args, ctx) => {
      const { stdout, stderr, code } = await pi.exec("kiro-cli", ["login", "--license", "free"], { timeout: 120_000 });
      const output = `${stdout}\n${stderr}`;
      if (output.includes("Already logged in")) {
        ctx.ui.notify("Already logged in — token refreshed.");
      } else if (code === 0) {
        ctx.ui.notify(stdout || "Login successful");
      } else {
        ctx.ui.notify(stderr || stdout || `Login failed (exit ${code})`);
      }
    },
  });
}

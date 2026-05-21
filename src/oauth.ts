// Feature 3: OAuth — Kiro Authentication
//
// Supports multiple auth methods:
//   - "idc": AWS Builder ID or IAM Identity Center (SSO) via device code flow
//   - "desktop": Google/GitHub social login via Kiro auth service (delegates to kiro-cli)
//
// Login and token refresh are delegated to kiro-cli.
// When token expires, the user is prompted to re-login via kiro-cli.

import type { OAuthCredentials, OAuthLoginCallbacks } from "@mariozechner/pi-ai";
import { getKiroIdeCredentials } from "./kiro-ide.js";
import { interactiveLogin, loginViaKiroCli } from "./login.js";
import { notify } from "./notify.js";

export const SSO_OIDC_ENDPOINT = "https://oidc.us-east-1.amazonaws.com";
export const BUILDER_ID_START_URL = "https://view.awsapps.com/start";
export const SSO_SCOPES = [
  "codewhisperer:completions",
  "codewhisperer:analysis",
  "codewhisperer:conversations",
  "codewhisperer:transformations",
  "codewhisperer:taskassist",
];

export type KiroAuthMethod = "idc" | "desktop";
export type KiroLoginMethod = "auto" | "builder-id" | "google" | "github";

export interface KiroCredentials extends OAuthCredentials {
  clientId: string;
  clientSecret: string;
  region: string;
  authMethod: KiroAuthMethod;
}

/**
 * Login to Kiro using the specified method.
 *
 * - "auto": Use existing kiro-cli credentials if available (any method)
 * - "builder-id": AWS Builder ID via device code flow
 * - "google" | "github": Social login via kiro-cli (requires kiro-cli installed)
 */
export async function loginKiro(
  callbacks: OAuthLoginCallbacks,
  preferredMethod: KiroLoginMethod = "auto",
): Promise<OAuthCredentials> {
  const { getKiroCliCredentials, getKiroCliSocialToken } = await import("./kiro-cli.js");

  // If user explicitly wants social login, delegate to kiro-cli
  if (preferredMethod === "google" || preferredMethod === "github") {
    return loginViaKiroCli(callbacks, preferredMethod);
  }

  // 1. Kiro IDE token (~/.aws/sso/cache/kiro-auth-token.json)
  const ideCreds = getKiroIdeCredentials();
  if (ideCreds && (preferredMethod === "auto" || preferredMethod === "builder-id")) {
    (callbacks as unknown as { onProgress?: (msg: string) => void }).onProgress?.(
      "Using existing Kiro IDE credentials",
    );
    return ideCreds;
  }

  // 2. kiro-cli DB credentials (social / Builder ID / IdC)
  let cliCreds = getKiroCliSocialToken();
  if (!cliCreds) {
    cliCreds = getKiroCliCredentials();
  }
  if (cliCreds && (preferredMethod === "auto" || cliCreds.authMethod === "idc")) {
    (callbacks as unknown as { onProgress?: (msg: string) => void }).onProgress?.(
      cliCreds.authMethod === "desktop"
        ? "Using existing kiro-cli social credentials"
        : "Using existing kiro-cli credentials",
    );
    return cliCreds;
  }

  // 3. No valid credentials — notify and prompt for kiro-cli login
  (callbacks as unknown as { onProgress?: (msg: string) => void }).onProgress?.(
    "No valid Kiro credentials found. kiro-cli login is required.",
  );
  return loginViaKiroCli(callbacks, "google");
}

/**
 * Backward-compatible alias for loginKiro with Builder ID.
 * @deprecated Use loginKiro instead.
 */
export async function loginKiroBuilderID(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  return loginKiro(callbacks, "builder-id");
}

/**
 * Token refresh — checks kiro-cli DB and IDE for a valid token.
 * If no valid token is found, throws to trigger re-login via pi framework.
 */
export async function refreshKiroToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
  const { getKiroCliCredentials, getKiroCliSocialToken, refreshViaKiroCli } = await import("./kiro-cli.js");

  // 1. Kiro IDE token — freshest source
  const ideCreds = getKiroIdeCredentials();
  if (ideCreds) return ideCreds;

  // 2. kiro-cli DB — check for valid (non-expired) token
  const cliCreds = getKiroCliSocialToken() ?? getKiroCliCredentials();
  if (cliCreds) return cliCreds;

  // 3. Force refresh via kiro-cli
  const refreshed = refreshViaKiroCli();
  if (refreshed) {
    notify("[kiro] Token refreshed via kiro-cli");
    return refreshed;
  }

  // 4. No valid token available — throw to trigger re-login
  throw new Error("Kiro session expired. Please run: /login-kiro");
}

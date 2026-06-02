// Feature 2: Model Definitions
// Dynamic model list: CLI → cache file → hardcoded minimal fallback

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const BASE_URL = "https://q.us-east-1.amazonaws.com/generateAssistantResponse";
const ZERO_COST = Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const CACHE_PATH = join(homedir(), ".pi", "cache", "kiro-models.json");

// --- Region Mapping ---

const API_REGION_MAP: Record<string, string> = {
  "us-west-1": "us-east-1",
  "us-west-2": "us-east-1",
  "us-east-2": "us-east-1",
  "ap-southeast-1": "us-east-1",
  "ap-southeast-2": "us-east-1",
  "ap-southeast-3": "us-east-1",
  "ap-southeast-4": "us-east-1",
  "ap-northeast-1": "us-east-1",
  "ap-northeast-2": "us-east-1",
  "ap-northeast-3": "us-east-1",
  "ap-east-1": "us-east-1",
  "ap-south-1": "us-east-1",
  "ap-south-2": "us-east-1",
  "ca-central-1": "us-east-1",
  "ca-west-1": "us-east-1",
  "sa-east-1": "us-east-1",
  "me-south-1": "us-east-1",
  "me-central-1": "us-east-1",
  "eu-west-1": "eu-central-1",
  "eu-west-2": "eu-central-1",
  "eu-west-3": "eu-central-1",
  "eu-north-1": "eu-central-1",
  "eu-south-1": "eu-central-1",
  "eu-south-2": "eu-central-1",
  "eu-central-2": "eu-central-1",
  "af-south-1": "eu-central-1",
  "il-central-1": "eu-central-1",
};

export function resolveApiRegion(ssoRegion: string | undefined): string {
  if (!ssoRegion) return "us-east-1";
  return API_REGION_MAP[ssoRegion] ?? ssoRegion;
}

// --- Model Metadata (supplements dynamic list with info CLI doesn't provide) ---

interface ModelMeta {
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  input?: ("text" | "image")[];
  thinkingLevelMap?: Record<string, string>;
  firstTokenTimeout?: number;
}

const MODEL_METADATA: Record<string, ModelMeta> = {
  "claude-opus-4-8": { name: "Claude Opus 4.8", contextWindow: 1000000, maxTokens: 128000, reasoning: true, input: ["text", "image"], thinkingLevelMap: { xhigh: "xhigh" }, firstTokenTimeout: 180_000 },
  "claude-opus-4-7": { name: "Claude Opus 4.7", contextWindow: 1000000, maxTokens: 128000, reasoning: true, input: ["text", "image"], thinkingLevelMap: { xhigh: "xhigh" }, firstTokenTimeout: 180_000 },
  "claude-opus-4-6": { name: "Claude Opus 4.6", contextWindow: 1000000, maxTokens: 64000, reasoning: true, input: ["text", "image"], thinkingLevelMap: { xhigh: "xhigh" }, firstTokenTimeout: 180_000 },
  "claude-sonnet-4-6": { name: "Claude Sonnet 4.6", contextWindow: 1000000, maxTokens: 64000, reasoning: true, input: ["text", "image"] },
  "claude-opus-4-5": { name: "Claude Opus 4.5", contextWindow: 200000, maxTokens: 64000, reasoning: true, input: ["text", "image"] },
  "claude-sonnet-4-5": { name: "Claude Sonnet 4.5", contextWindow: 200000, maxTokens: 64000, reasoning: true, input: ["text", "image"] },
  "claude-sonnet-4": { name: "Claude Sonnet 4", contextWindow: 200000, maxTokens: 64000, reasoning: true, input: ["text", "image"] },
  "claude-haiku-4-5": { name: "Claude Haiku 4.5", contextWindow: 200000, maxTokens: 64000, reasoning: false, input: ["text", "image"] },
  "deepseek-3-2": { name: "DeepSeek 3.2", contextWindow: 164000, maxTokens: 64000, reasoning: true, input: ["text"] },
  "minimax-m2-5": { name: "MiniMax M2.5", contextWindow: 196000, maxTokens: 64000, reasoning: false, input: ["text"] },
  "minimax-m2-1": { name: "MiniMax M2.1", contextWindow: 196000, maxTokens: 64000, reasoning: false, input: ["text"] },
  "glm-5": { name: "GLM 5", contextWindow: 200000, maxTokens: 64000, reasoning: true, input: ["text"] },
  "qwen3-coder-next": { name: "Qwen3 Coder Next", contextWindow: 256000, maxTokens: 64000, reasoning: true, input: ["text"] },
  "auto": { name: "Auto", contextWindow: 1000000, maxTokens: 64000, reasoning: true, input: ["text", "image"] },
};

// --- Hardcoded minimal fallback (used only when CLI + cache both unavailable) ---

const FALLBACK_MODEL_IDS = [
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-sonnet-4",
  "auto",
];

// --- CLI fetch + cache ---

interface CacheFile {
  models: string[];
  timestamp: number;
}

type KiroCliModel = { model_id: string };

function fetchKiroCliModels(): string[] | null {
  try {
    const out = execFileSync("kiro-cli", ["chat", "--list-models", "--format", "json"], {
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    });

    const data = JSON.parse(out) as { models: KiroCliModel[] };
    const ids = (data.models ?? []).map((m) => m.model_id.replace(/(\d)\.(\d)/g, "$1-$2"));

    if (ids.length > 0) {
      saveCache(ids);
      return ids;
    }

    return null;
  } catch {
    return null;
  }
}

function saveCache(ids: string[]): void {
  try {
    const dir = dirname(CACHE_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify({ models: ids, timestamp: Date.now() } satisfies CacheFile));
  } catch {
    // Non-fatal
  }
}

function readCache(): string[] | null {
  try {
    if (!existsSync(CACHE_PATH)) return null;
    const data = JSON.parse(readFileSync(CACHE_PATH, "utf-8")) as CacheFile;
    if (data.models?.length > 0) return data.models;
    return null;
  } catch {
    return null;
  }
}

// --- Model resolution cascade ---

function resolveModelIds(): string[] {
  return fetchKiroCliModels() ?? readCache() ?? FALLBACK_MODEL_IDS;
}

function buildModel(piId: string) {
  const meta = MODEL_METADATA[piId];

  // Default name: capitalize and format the ID
  const name = meta?.name ?? piId.split("-").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");

  return {
    id: piId,
    name,
    api: "kiro-api" as const,
    provider: "kiro" as const,
    baseUrl: BASE_URL,
    reasoning: piId === "auto" ? true : (meta?.reasoning ?? false),
    input: (meta?.input ?? ["text"]) as ("text" | "image")[],
    cost: ZERO_COST,
    contextWindow: meta?.contextWindow ?? 200000,
    maxTokens: meta?.maxTokens ?? 64000,
    ...(meta?.thinkingLevelMap && { thinkingLevelMap: meta.thinkingLevelMap }),
    ...(meta?.firstTokenTimeout && { firstTokenTimeout: meta.firstTokenTimeout }),
  };
}

// --- Public API ---

let cachedModels: ReturnType<typeof buildModel>[] | null = null;

export function getKiroModels() {
  if (cachedModels) return cachedModels;
  const ids = resolveModelIds();
  cachedModels = ids.map(buildModel);
  return cachedModels;
}

// Backward compat: static export for existing imports
export const kiroModels = getKiroModels();

export function resolveKiroModel(modelId: string): string {
  const kiroId = modelId.replace(/(\d)-(\d)/g, "$1.$2");
  // Accept any model from the resolved list — don't throw on dynamic models
  const knownIds = new Set(getKiroModels().map((m) => m.id.replace(/(\d)-(\d)/g, "$1.$2")));
  if (!knownIds.has(kiroId)) {
    throw new Error(`Unknown Kiro model ID: ${modelId}`);
  }
  return kiroId;
}

// Legacy export — still used by region filtering
export const KIRO_MODEL_IDS = new Set(getKiroModels().map((m) => m.id.replace(/(\d)-(\d)/g, "$1.$2")));

export function filterModelsByRegion<T extends { id: string }>(models: T[], _apiRegion: string): T[] {
  // When models come from CLI, they are already region-appropriate.
  // No additional filtering needed — CLI returns only available models for the authenticated region.
  return models;
}

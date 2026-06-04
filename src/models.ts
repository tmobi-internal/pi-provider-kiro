// Feature 2: Model Definitions
// Dynamic model list: cache file → API fetch → hardcoded fallback

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const BASE_URL = "https://q.us-east-1.amazonaws.com/generateAssistantResponse";
const ZERO_COST = Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const CACHE_PATH = join(homedir(), ".pi", "cache", "kiro-models.json");
const CACHE_TTL = 3 * 24 * 60 * 60 * 1000;

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

// --- Model Metadata (supplements API with fields not available from the API) ---

interface ModelMeta {
  thinkingLevelMap?: Record<string, string>;
  firstTokenTimeout?: number;
}

const MODEL_METADATA: Record<string, ModelMeta> = {
  "claude-opus-4-8": { thinkingLevelMap: { xhigh: "xhigh" }, firstTokenTimeout: 180_000 },
  "claude-opus-4-7": { thinkingLevelMap: { xhigh: "xhigh" }, firstTokenTimeout: 180_000 },
  "claude-opus-4-6": { thinkingLevelMap: { xhigh: "xhigh" }, firstTokenTimeout: 180_000 },
};

// --- Cache format (pi-specific normalized) ---

interface CacheModel {
  modelId: string;
  modelName: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  contextWindow: number;
  maxTokens: number;
  promptCaching: boolean;
}

interface CacheFile {
  timestamp: string;
  apiRegion: string;
  models: CacheModel[];
}

// --- Hardcoded fallback (used only when cache + API both unavailable) ---

const FALLBACK_MODELS: CacheModel[] = [
  { modelId: "claude-opus-4.8", modelName: "Claude Opus 4.8", reasoning: true, input: ["text", "image"], contextWindow: 1000000, maxTokens: 128000, promptCaching: true },
  { modelId: "claude-opus-4.7", modelName: "Claude Opus 4.7", reasoning: true, input: ["text", "image"], contextWindow: 1000000, maxTokens: 128000, promptCaching: true },
  { modelId: "claude-sonnet-4.6", modelName: "Claude Sonnet 4.6", reasoning: true, input: ["text", "image"], contextWindow: 1000000, maxTokens: 64000, promptCaching: true },
  { modelId: "claude-sonnet-4", modelName: "Claude Sonnet 4", reasoning: true, input: ["text", "image"], contextWindow: 200000, maxTokens: 64000, promptCaching: true },
  { modelId: "auto", modelName: "Auto", reasoning: true, input: ["text", "image"], contextWindow: 1000000, maxTokens: 64000, promptCaching: true },
];

// --- Cache read/write ---

function readCacheFile(): CacheFile | null {
  try {
    if (!existsSync(CACHE_PATH)) return null;
    const data = JSON.parse(readFileSync(CACHE_PATH, "utf-8")) as CacheFile;
    if (!data.models?.length || !data.timestamp) return null;

    // Legacy format detection — discard
    if (typeof (data.models[0] as unknown) === "string") return null;
    if (!("modelId" in data.models[0])) return null;

    return data;
  } catch {
    return null;
  }
}

function isCacheFresh(cache: CacheFile): boolean {
  const ts = new Date(cache.timestamp).getTime();
  return Date.now() - ts < CACHE_TTL;
}

function saveCache(models: CacheModel[], apiRegion: string): void {
  try {
    const dir = dirname(CACHE_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const cacheFile: CacheFile = {
      timestamp: new Date().toISOString(),
      apiRegion,
      models,
    };

    writeFileSync(CACHE_PATH, JSON.stringify(cacheFile, null, 2));
  } catch {
    // Non-fatal
  }
}

// --- API response → normalized CacheModel ---

interface ApiModel {
  modelId: string;
  modelName?: string;
  tokenLimits?: { maxInputTokens?: number; maxOutputTokens?: number };
  additionalModelRequestFieldsSchema?: { properties?: { thinking?: unknown } } | null;
  supportedInputTypes?: string[];
  promptCaching?: { supportsPromptCaching?: boolean } | null;
}

function normalizeApiModel(m: ApiModel): CacheModel {
  const inputTypes = (m.supportedInputTypes ?? [])
    .map((t) => t.toLowerCase())
    .filter((t): t is "text" | "image" => t === "text" || t === "image");

  return {
    modelId: m.modelId,
    modelName: m.modelName ?? m.modelId,
    reasoning: !!m.additionalModelRequestFieldsSchema?.properties?.thinking,
    input: inputTypes.length > 0 ? inputTypes : ["text"],
    contextWindow: m.tokenLimits?.maxInputTokens ?? 200000,
    maxTokens: m.tokenLimits?.maxOutputTokens ?? 64000,
    promptCaching: !!m.promptCaching?.supportsPromptCaching,
  };
}

// --- Fetch from API ---

async function fetchModelsFromApi(accessToken: string, apiRegion: string): Promise<CacheModel[] | null> {
  try {
    const url = `https://q.${apiRegion}.amazonaws.com/ListAvailableModels?origin=AI_EDITOR`;

    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) return null;

    const data = (await response.json()) as { models?: ApiModel[] };
    const models = (data.models ?? []).map(normalizeApiModel);

    return models.length > 0 ? models : null;
  } catch {
    return null;
  }
}

// --- Build pi model from CacheModel ---

function buildModel(m: CacheModel) {
  const piId = m.modelId.replace(/(\d)\.(\d)/g, "$1-$2");
  const meta = MODEL_METADATA[piId];

  return {
    id: piId,
    name: m.modelName,
    api: "kiro-api" as const,
    provider: "kiro" as const,
    baseUrl: BASE_URL,
    reasoning: piId === "auto" ? true : m.reasoning,
    input: m.input,
    cost: ZERO_COST,
    contextWindow: m.contextWindow,
    maxTokens: m.maxTokens,
    ...(meta?.thinkingLevelMap && { thinkingLevelMap: meta.thinkingLevelMap }),
    ...(meta?.firstTokenTimeout && { firstTokenTimeout: meta.firstTokenTimeout }),
  };
}

// --- Public API ---

let cachedModels: ReturnType<typeof buildModel>[] | null = null;
export let usedFallback = false;
let fetchAttempted = false;

export async function loadKiroModels(accessToken?: string, region?: string): Promise<ReturnType<typeof buildModel>[]> {
  const apiRegion = resolveApiRegion(region);
  const cache = readCacheFile();

  // 1. Fresh cache → use directly
  if (cache && isCacheFresh(cache)) {
    cachedModels = cache.models.map(buildModel);
    return cachedModels;
  }

  // 2. Stale/missing → try API
  if (accessToken) {
    const apiModels = await fetchModelsFromApi(accessToken, apiRegion);

    if (apiModels) {
      saveCache(apiModels, apiRegion);
      cachedModels = apiModels.map(buildModel);
      return cachedModels;
    }
  }

  // 3. API failed but stale cache exists → use stale
  if (cache?.models) {
    cachedModels = cache.models.map(buildModel);
    return cachedModels;
  }

  // 4. Fallback
  usedFallback = true;
  cachedModels = FALLBACK_MODELS.map(buildModel);
  return cachedModels;
}

export function getKiroModels() {
  if (cachedModels) return cachedModels;

  // Sync path: cache file or fallback (no API, no CLI)
  const cache = readCacheFile();
  cachedModels = (cache?.models ?? FALLBACK_MODELS).map(buildModel);
  return cachedModels;
}

// Backward compat: static export for existing imports
export const kiroModels = getKiroModels();

export function resolveKiroModel(modelId: string): string {
  const kiroId = modelId.replace(/(\d)-(\d)/g, "$1.$2");
  const knownIds = new Set(getKiroModels().map((m) => m.id.replace(/(\d)-(\d)/g, "$1.$2")));

  if (!knownIds.has(kiroId)) {
    throw new Error(`Unknown Kiro model ID: ${modelId}`);
  }

  return kiroId;
}

// Legacy export — still used by region filtering
export const KIRO_MODEL_IDS = new Set(getKiroModels().map((m) => m.id.replace(/(\d)-(\d)/g, "$1.$2")));

export function filterModelsByRegion<T extends { id: string }>(models: T[], _apiRegion: string): T[] {
  return models;
}

// --- Dynamic refresh for modifyModels ---

export function readCachedModels(): ReturnType<typeof buildModel>[] | null {
  const cache = readCacheFile();
  if (!cache?.models?.length) return null;
  usedFallback = false;
  return cache.models.map(buildModel);
}

export function triggerModelCacheRefresh(accessToken: string, region?: string): void {
  if (fetchAttempted) return;
  fetchAttempted = true;

  const apiRegion = resolveApiRegion(region);

  fetchModelsFromApi(accessToken, apiRegion).then((models) => {
    if (models) {
      saveCache(models, apiRegion);
      usedFallback = false;
    }
  }).catch(() => {});
}

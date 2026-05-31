// ABOUTME: Truncation state cache — stores tool input truncation warnings keyed by toolCallId.
// Consumed once by buildHistory to prepend [API Limitation] notices to tool results.
// Also stores content truncation warnings keyed by content hash.

import { createHash } from "node:crypto";

const toolCache = new Map<string, string>();
const contentCache = new Map<string, string>();

export function saveTruncationWarning(toolCallId: string, toolName: string): void {
  toolCache.set(toolCallId, `[API Limitation] The tool input for "${toolName}" was truncated by the API. Please retry the same operation.`);
}

export function consumeTruncationWarning(toolCallId: string): string | undefined {
  const warning = toolCache.get(toolCallId);
  if (warning) toolCache.delete(toolCallId);
  return warning;
}

export function saveContentTruncation(content: string): void {
  const key = createHash("sha256").update(content.slice(0, 500)).digest("hex");
  contentCache.set(key, "[System Notice] Your previous response was truncated by the API. Please continue from where you left off.");
}

export function consumeContentTruncation(content: string): string | undefined {
  const key = createHash("sha256").update(content.slice(0, 500)).digest("hex");
  const warning = contentCache.get(key);
  if (warning) contentCache.delete(key);
  return warning;
}

// ABOUTME: Truncation state cache — stores tool input truncation warnings keyed by toolCallId.
// Consumed once by buildHistory to prepend [API Limitation] notices to tool results.

const cache = new Map<string, string>();

export function saveTruncationWarning(toolCallId: string, toolName: string): void {
  cache.set(toolCallId, `[API Limitation] The tool input for "${toolName}" was truncated by the API. Please retry the same operation.`);
}

export function consumeTruncationWarning(toolCallId: string): string | undefined {
  const warning = cache.get(toolCallId);
  if (warning) cache.delete(toolCallId);
  return warning;
}

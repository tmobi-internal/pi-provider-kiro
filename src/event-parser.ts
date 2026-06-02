// ABOUTME: Kiro stream event parsing for JSON-based streaming responses.
// ABOUTME: Extracts typed events from raw buffered stream data.

export type KiroStreamEvent =
  | { type: "content"; data: string }
  | { type: "toolUse"; data: { name: string; toolUseId: string; input: string; stop?: boolean } }
  | { type: "toolUseInput"; data: { input: string } }
  | { type: "toolUseStop"; data: { stop: boolean } }
  | { type: "contextUsage"; data: { contextUsagePercentage: number } }
  | { type: "followupPrompt"; data: string }
  | { type: "usage"; data: { inputTokens?: number; outputTokens?: number } }
  | { type: "error"; data: { error: string; message?: string } };

export function findJsonEnd(text: string, start: number): number {
  let braceCount = 0;
  let inString = false;
  let escapeNext = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === "\\") {
      escapeNext = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === "{") braceCount++;
      else if (char === "}") {
        braceCount--;
        if (braceCount === 0) return i;
      }
    }
  }
  return -1;
}

export function parseKiroEvent(parsed: Record<string, unknown>): KiroStreamEvent | null {
  if (parsed.content !== undefined) return { type: "content", data: parsed.content as string };
  if (parsed.name && parsed.toolUseId) {
    const input =
      typeof parsed.input === "string"
        ? parsed.input
        : parsed.input &&
            typeof parsed.input === "object" &&
            Object.keys(parsed.input as Record<string, unknown>).length > 0
          ? JSON.stringify(parsed.input)
          : "";
    return {
      type: "toolUse",
      data: {
        name: parsed.name as string,
        toolUseId: parsed.toolUseId as string,
        input,
        stop: parsed.stop as boolean | undefined,
      },
    };
  }
  if (parsed.input !== undefined && !parsed.name) {
    return {
      type: "toolUseInput",
      data: { input: typeof parsed.input === "string" ? parsed.input : JSON.stringify(parsed.input) },
    };
  }
  if (parsed.stop !== undefined && parsed.contextUsagePercentage === undefined)
    return { type: "toolUseStop", data: { stop: parsed.stop as boolean } };
  if (parsed.contextUsagePercentage !== undefined)
    return { type: "contextUsage", data: { contextUsagePercentage: parsed.contextUsagePercentage as number } };
  if (parsed.followupPrompt !== undefined) return { type: "followupPrompt", data: parsed.followupPrompt as string };
  if (parsed.error !== undefined || parsed.Error !== undefined) {
    const error = (parsed.error || parsed.Error || "unknown") as string;
    const message = (parsed.message || parsed.Message || parsed.reason) as string | undefined;
    return { type: "error", data: { error: typeof error === "string" ? error : JSON.stringify(error), message } };
  }
  if (parsed.usage !== undefined) {
    const u = parsed.usage as Record<string, unknown>;
    return {
      type: "usage",
      data: { inputTokens: u.inputTokens as number | undefined, outputTokens: u.outputTokens as number | undefined },
    };
  }
  return null;
}

// Known JSON key patterns that start Kiro event objects. Using specific
// patterns avoids matching stray '{"' sequences in the binary AWS Event
// Stream framing that wraps each JSON payload.
const EVENT_PATTERNS = [
  '{"content":',
  '{"name":',
  '{"input":',
  '{"stop":',
  '{"contextUsagePercentage":',
  '{"followupPrompt":',
  '{"usage":',
  '{"toolUseId":',
  '{"unit":',
  '{"error":',
  '{"Error":',
  '{"message":',
];

function findNextEventStart(buffer: string, from: number): number {
  let earliest = -1;
  for (const pattern of EVENT_PATTERNS) {
    const idx = buffer.indexOf(pattern, from);
    if (idx >= 0 && (earliest < 0 || idx < earliest)) earliest = idx;
  }
  return earliest;
}

export function parseKiroEvents(buffer: string): { events: KiroStreamEvent[]; remaining: string } {
  const events: KiroStreamEvent[] = [];
  let pos = 0;

  while (pos < buffer.length) {
    const jsonStart = findNextEventStart(buffer, pos);
    if (jsonStart < 0) break;

    const jsonEnd = findJsonEnd(buffer, jsonStart);
    if (jsonEnd < 0) {
      // Incomplete JSON at end of buffer — preserve for next call
      return { events, remaining: buffer.substring(jsonStart) };
    }

    try {
      const parsed = JSON.parse(buffer.substring(jsonStart, jsonEnd + 1));
      const event = parseKiroEvent(parsed);
      if (event) events.push(event);
    } catch {
      /* skip brace-balanced but non-JSON content */
    }
    pos = jsonEnd + 1;
  }

  return { events, remaining: "" };
}

// --- Binary Event Stream decoding (Smithy) ---

import { EventStreamCodec } from "@smithy/eventstream-codec";
import { toUtf8, fromUtf8 } from "@smithy/util-utf8";

const smithyCodec = new EventStreamCodec(toUtf8, fromUtf8);

/**
 * Attempt to decode binary Event Stream framed data into KiroStreamEvents.
 * Returns null if the chunk is not valid binary framing (fallback to text parser).
 * Uses an internal buffer to handle message boundary reassembly.
 */
let binaryBuffer = new Uint8Array(0);

export function resetBinaryBuffer(): void {
  binaryBuffer = new Uint8Array(0);
}

export function parseKiroEventsFromBinary(chunk: Uint8Array): KiroStreamEvent[] | null {
  if (!smithyCodec) return null;

  // Append chunk to buffer
  const combined = new Uint8Array(binaryBuffer.length + chunk.length);
  combined.set(binaryBuffer);
  combined.set(chunk, binaryBuffer.length);
  binaryBuffer = combined;

  const events: KiroStreamEvent[] = [];

  // AWS Event Stream messages: 4-byte big-endian total length at start
  let decoded = false;
  while (binaryBuffer.length >= 4) {
    const totalLen = new DataView(binaryBuffer.buffer, binaryBuffer.byteOffset).getUint32(0);
    if (totalLen < 16 || totalLen > 16 * 1024 * 1024) {
      // Invalid framing — not a binary event stream
      binaryBuffer = new Uint8Array(0);
      return null;
    }
    if (binaryBuffer.length < totalLen) break; // incomplete message
    decoded = true;

    const msgBytes = binaryBuffer.slice(0, totalLen);
    binaryBuffer = binaryBuffer.slice(totalLen);

    try {
      const msg = smithyCodec.decode(msgBytes);
      const headerType = msg.headers[":message-type"]?.value;

      if (headerType === "exception" || headerType === "error") {
        const body = toUtf8(msg.body);
        try {
          const parsed = JSON.parse(body);
          const event = parseKiroEvent(parsed);
          if (event) events.push(event);
        } catch {
          events.push({ type: "error", data: { error: body } });
        }
        continue;
      }

      if (msg.body.length > 0) {
        const body = toUtf8(msg.body);
        try {
          const parsed = JSON.parse(body) as Record<string, unknown>;
          const event = parseKiroEvent(parsed);
          if (event) events.push(event);
        } catch {
          // Non-JSON body — skip
        }
      }
    } catch {
      // Invalid framing — not a binary event stream
      binaryBuffer = new Uint8Array(0);
      return null;
    }
  }

  return events;
}

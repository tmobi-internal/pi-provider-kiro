// ABOUTME: Stateful streaming parser for thinking tags.
// ABOUTME: Provisional streaming — content emits immediately as thinking, converts to text if no tag found.
// ABOUTME: No content splice/rearrangement. Append only. Type conversion only.

import type {
  AssistantMessage,
  AssistantMessageEventStream,
  TextContent,
  ThinkingContent,
} from "@earendil-works/pi-ai";

export const THINKING_START_TAG = "<thinking>";
export const THINKING_END_TAG = "</thinking>";

const THINKING_TAG_VARIANTS: Array<{ open: string; close: string }> = [
  { open: "<thinking>", close: "</thinking>" },
  { open: "<think>", close: "</think>" },
  { open: "<reasoning>", close: "</reasoning>" },
  { open: "<thought>", close: "</thought>" },
];

const MAX_OPEN_TAG_LENGTH = Math.max(...THINKING_TAG_VARIANTS.map((v) => v.open.length));

type State = "PROVISIONAL" | "IN_THINKING" | "POST_THINKING" | "TEXT_CONFIRMED";

interface TagMatch {
  pos: number;
  variant: (typeof THINKING_TAG_VARIANTS)[number];
}

function findEarliestOpeningTag(text: string): TagMatch | null {
  let best: TagMatch | null = null;

  for (const variant of THINKING_TAG_VARIANTS) {
    const pos = text.indexOf(variant.open);

    if (pos !== -1 && (best === null || pos < best.pos)) {
      best = { pos, variant };
    }
  }

  return best;
}

function getTrailingPrefixLength(text: string, tags: string[]): number {
  let max = 0;

  for (const tag of tags) {
    const limit = Math.min(text.length, tag.length - 1);

    for (let len = limit; len > 0; len--) {
      if (text.endsWith(tag.slice(0, len))) {
        max = Math.max(max, len);
        break;
      }
    }
  }

  return max;
}

const QUOTE_CHARS = new Set(["`"]);

function findRealCloseTag(text: string, closeTag: string, streaming = false): number {
  let start = 0;

  while (start < text.length) {
    const pos = text.indexOf(closeTag, start);

    if (pos === -1) return -1;

    const charBefore = pos > 0 ? text[pos - 1] : "";
    const endPos = pos + closeTag.length;
    const charAfter = text[endPos] ?? "";

    if (charBefore && QUOTE_CHARS.has(charBefore)) {
      if (charAfter === charBefore) {
        start = endPos + 1;
        continue;
      }

      if (streaming && endPos >= text.length) {
        return -1;
      }
    }

    return pos;
  }

  return -1;
}

export class ThinkingTagParser {
  private state: State = "PROVISIONAL";
  private buffer = "";
  private activeCloseTag = "";
  private thinkingBlockIndex: number | null = null;
  private textBlockIndex: number | null = null;
  private thinkingStarted = false;
  private contentEmitted = false;

  constructor(
    private output: AssistantMessage,
    private stream: AssistantMessageEventStream,
  ) {}

  processChunk(chunk: string): void {
    this.buffer += chunk;

    switch (this.state) {
      case "PROVISIONAL":
        this.processProvisional();
        break;

      case "IN_THINKING":
        this.processInThinking();
        break;

      case "POST_THINKING":
        this.processPostThinking();
        break;

      case "TEXT_CONFIRMED":
        this.processTextConfirmed();
        break;
    }
  }

  finalize(): void {
    switch (this.state) {
      case "PROVISIONAL":
        this.finalizeProvisional();
        break;

      case "IN_THINKING":
        this.finalizeInThinking();
        break;

      case "POST_THINKING":
        this.finalizePostThinking();
        break;

      case "TEXT_CONFIRMED":
        this.finalizeTextConfirmed();
        break;
    }

    this.buffer = "";
  }

  getTextBlockIndex(): number | null {
    return this.textBlockIndex;
  }

  // ---------------------------------------------------------------------------
  // PROVISIONAL: emit as thinking, look for opening tag
  // ---------------------------------------------------------------------------

  private processProvisional(): void {
    // Content already emitted → tag can't be at position 0
    if (this.contentEmitted) {
      this.convertToText();
      this.processTextConfirmed();
      return;
    }

    const match = findEarliestOpeningTag(this.buffer);

    if (match) {
      if (match.pos !== 0) {
        // Tag is not at position 0 — treat as literal text
        this.ensureThinking();
        this.appendThinking(this.buffer);
        this.buffer = "";
        this.contentEmitted = true;
        this.convertToText();
        return;
      }

      this.buffer = this.buffer.slice(match.variant.open.length);
      this.activeCloseTag = match.variant.close;
      this.state = "IN_THINKING";
      this.ensureThinking();
      this.processInThinking();
      return;
    }

    // No tag found — emit safe portion, hold back potential prefix
    const openTags = THINKING_TAG_VARIANTS.map((v) => v.open);
    const trailingPrefix = getTrailingPrefixLength(this.buffer, openTags);

    // If entire buffer is a possible prefix, hold everything
    if (trailingPrefix >= this.buffer.length) return;

    const safeLen = this.buffer.length - trailingPrefix;

    if (safeLen > 0) {
      const safe = this.buffer.slice(0, safeLen);
      this.ensureThinking();
      this.appendThinking(safe);
      this.buffer = this.buffer.slice(safeLen);
      this.contentEmitted = true;
      this.convertToText();

      if (this.buffer) {
        this.processTextConfirmed();
      }

      return;
    }
  }

  // ---------------------------------------------------------------------------
  // IN_THINKING: confirmed thinking, look for close tag
  // ---------------------------------------------------------------------------

  private processInThinking(): void {
    const closePos = findRealCloseTag(this.buffer, this.activeCloseTag, true);

    if (closePos !== -1) {
      const thinkingChunk = this.buffer.slice(0, closePos);

      if (thinkingChunk) {
        this.appendThinking(thinkingChunk);
      }

      this.endThinking();

      let remaining = this.buffer.slice(closePos + this.activeCloseTag.length);

      if (remaining.startsWith("\n\n")) {
        remaining = remaining.slice(2);
      }

      this.buffer = remaining;
      this.state = "POST_THINKING";

      if (this.buffer) {
        this.processPostThinking();
      }

      return;
    }

    // Emit safe portion, hold back potential close tag prefix + quote char
    const trailingPrefix = getTrailingPrefixLength(this.buffer, [this.activeCloseTag]);
    const charBeforePrefix = trailingPrefix > 0 && trailingPrefix < this.buffer.length
      ? this.buffer[this.buffer.length - trailingPrefix - 1]
      : "";
    const lastChar = this.buffer[this.buffer.length - 1] ?? "";
    const holdExtra = QUOTE_CHARS.has(charBeforePrefix) ? 1
      : (trailingPrefix === 0 && QUOTE_CHARS.has(lastChar)) ? 1
      : 0;
    const safeLen = this.buffer.length - trailingPrefix - holdExtra;

    if (safeLen > 0) {
      this.appendThinking(this.buffer.slice(0, safeLen));
      this.buffer = this.buffer.slice(safeLen);
    }
  }

  // ---------------------------------------------------------------------------
  // POST_THINKING: thinking done, text at index 1
  // ---------------------------------------------------------------------------

  private processPostThinking(): void {
    if (!this.buffer) return;

    this.ensureTextBlock();
    this.appendText(this.buffer);
    this.buffer = "";
  }

  // ---------------------------------------------------------------------------
  // TEXT_CONFIRMED: type converted, streaming as text at index 0
  // ---------------------------------------------------------------------------

  private processTextConfirmed(): void {
    if (!this.buffer) return;

    this.appendText(this.buffer);
    this.buffer = "";
  }

  // ---------------------------------------------------------------------------
  // Finalize
  // ---------------------------------------------------------------------------

  private finalizeProvisional(): void {
    if (this.buffer) {
      this.ensureThinking();
      this.appendThinking(this.buffer);
    }

    // No tag found → convert type to text
    this.convertToText();
  }

  private finalizeInThinking(): void {
    if (this.buffer) {
      this.appendThinking(this.buffer);
    }

    this.endThinking();
  }

  private finalizePostThinking(): void {
    if (this.buffer) {
      this.ensureTextBlock();
      this.appendText(this.buffer);
    }
  }

  private finalizeTextConfirmed(): void {
    if (this.buffer) {
      this.appendText(this.buffer);
    }
  }

  // ---------------------------------------------------------------------------
  // Type conversion: thinking → text (same index 0, same content)
  // ---------------------------------------------------------------------------

  private convertToText(): void {
    const idx = this.thinkingBlockIndex;

    if (idx === null) return;

    const block = this.output.content[idx] as ThinkingContent;
    const text = block.thinking;

    // Emit thinking_end
    this.stream.push({ type: "thinking_end", contentIndex: idx, content: text, partial: this.output });

    // Mutate type: thinking → text (same content, same index)
    (this.output.content[idx] as unknown as TextContent) = { type: "text", text };

    // Emit text_start
    this.textBlockIndex = idx;
    this.stream.push({ type: "text_start", contentIndex: idx, partial: this.output });

    this.state = "TEXT_CONFIRMED";
  }

  // ---------------------------------------------------------------------------
  // Primitives
  // ---------------------------------------------------------------------------

  private ensureThinking(): void {
    if (this.thinkingStarted) return;

    this.thinkingBlockIndex = this.output.content.length;
    this.output.content.push({ type: "thinking", thinking: "" });
    this.stream.push({ type: "thinking_start", contentIndex: this.thinkingBlockIndex, partial: this.output });
    this.thinkingStarted = true;
  }

  private appendThinking(delta: string): void {
    const idx = this.thinkingBlockIndex;
    if (idx === null) return;

    const block = this.output.content[idx] as ThinkingContent;
    block.thinking += delta;
    this.stream.push({ type: "thinking_delta", contentIndex: idx, delta, partial: this.output });
  }

  private endThinking(): void {
    const idx = this.thinkingBlockIndex;
    if (idx === null) return;

    const block = this.output.content[idx] as ThinkingContent;
    this.stream.push({ type: "thinking_end", contentIndex: idx, content: block.thinking, partial: this.output });
  }

  private ensureTextBlock(): void {
    if (this.textBlockIndex !== null) return;

    this.textBlockIndex = this.output.content.length;
    this.output.content.push({ type: "text", text: "" });
    this.stream.push({ type: "text_start", contentIndex: this.textBlockIndex, partial: this.output });
  }

  private appendText(delta: string): void {
    const idx = this.textBlockIndex;
    if (idx === null) return;

    const block = this.output.content[idx] as TextContent;
    block.text += delta;
    this.stream.push({ type: "text_delta", contentIndex: idx, delta, partial: this.output });
  }
}

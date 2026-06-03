// ABOUTME: Stateful streaming parser for thinking tags.
// ABOUTME: Emits events during processChunk; pi re-renders from output.content on each event.

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

type State = "PENDING" | "IN_THINKING" | "STREAMING_TEXT";

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
        // Confirmed fake — skip
        start = endPos + 1;
        continue;
      }

      if (streaming && endPos >= text.length) {
        // End of buffer — can't confirm if quote closes. Treat as not found.
        return -1;
      }
    }

    return pos;
  }

  return -1;
}

export class ThinkingTagParser {
  private state: State = "PENDING";
  private buffer = "";
  private activeCloseTag = "";
  private thinkingBlockIndex: number | null = null;
  private textBlockIndex: number | null = null;
  private textBefore = "";
  private thinkingDone = false;

  constructor(
    private output: AssistantMessage,
    private stream: AssistantMessageEventStream,
  ) {}

  processChunk(chunk: string): void {
    this.buffer += chunk;

    switch (this.state) {
      case "PENDING":
        this.processPending();
        break;

      case "IN_THINKING":
        this.processInThinking();
        break;

      case "STREAMING_TEXT":
        this.processStreamingText();
        break;
    }
  }

  finalize(): void {
    switch (this.state) {
      case "PENDING":
        this.finalizePending();
        break;

      case "IN_THINKING":
        this.finalizeInThinking();
        break;

      case "STREAMING_TEXT":
        this.finalizeStreamingText();
        break;
    }

    this.buffer = "";
  }

  getTextBlockIndex(): number | null {
    return this.textBlockIndex;
  }

  private processPending(): void {
    const match = findEarliestOpeningTag(this.buffer);

    if (match) {
      const before = this.buffer.slice(0, match.pos);
      this.buffer = this.buffer.slice(match.pos + match.variant.open.length);
      this.activeCloseTag = match.variant.close;
      this.state = "IN_THINKING";

      this.startThinking();

      if (before) {
        this.textBefore = before;
      }

      this.processInThinking();
      return;
    }

    // No tag found. Check if buffer can still become a thinking tag.
    if (!this.buffer.includes("<") && this.buffer.length >= MAX_OPEN_TAG_LENGTH) {
      // No '<' at all — impossible for a tag to appear
      this.state = "STREAMING_TEXT";
      this.processStreamingText();
      return;
    }

    // Buffer has '<' but no thinking tag. Check if suffix from last '<' is a possible prefix.
    const lastLt = this.buffer.lastIndexOf("<");

    if (lastLt !== -1) {
      const suffix = this.buffer.slice(lastLt);
      const isPossiblePrefix = THINKING_TAG_VARIANTS.some((v) => v.open.startsWith(suffix));

      if (!isPossiblePrefix) {
        // '<' is not start of any thinking tag — safe to stream all
        this.state = "STREAMING_TEXT";
        this.processStreamingText();
      }
    }
  }

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
      this.state = "STREAMING_TEXT";

      // Emit buffered text-before (from PENDING path)
      if (this.textBefore) {
        this.ensureTextBlock();
        this.appendText(this.textBefore);
        this.textBefore = "";
      }

      if (this.buffer) {
        this.processStreamingText();
      }

      return;
    }

    // Emit safe portion, hold back potential close tag prefix + 1 char for quote detection
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

  private processStreamingText(): void {
    if (!this.buffer) return;

    // Only look for tags if thinking hasn't been extracted yet
    if (!this.thinkingDone) {
      const match = findEarliestOpeningTag(this.buffer);

      if (match) {
        // Emit text before the tag
        const before = this.buffer.slice(0, match.pos);

        if (before) {
          this.ensureTextBlock();
          this.appendText(before);
        }

        // Restructure: thinking at index 0, existing text moves to index 1
        this.restructureForThinking();

        this.buffer = this.buffer.slice(match.pos + match.variant.open.length);
        this.activeCloseTag = match.variant.close;
        this.state = "IN_THINKING";
        this.processInThinking();
        return;
      }
    }

    this.ensureTextBlock();
    this.appendText(this.buffer);
    this.buffer = "";
  }

  private finalizePending(): void {
    if (!this.buffer) return;

    const match = findEarliestOpeningTag(this.buffer);

    if (!match) {
      this.ensureTextBlock();
      this.appendText(this.buffer);
      return;
    }

    const before = this.buffer.slice(0, match.pos);
    const afterOpen = this.buffer.slice(match.pos + match.variant.open.length);
    const closePos = findRealCloseTag(afterOpen, match.variant.close);

    let thinkingContent: string;
    let textAfter: string;

    if (closePos !== -1) {
      thinkingContent = afterOpen.slice(0, closePos);
      textAfter = afterOpen.slice(closePos + match.variant.close.length);

      if (textAfter.startsWith("\n\n")) {
        textAfter = textAfter.slice(2);
      }
    } else {
      thinkingContent = afterOpen;
      textAfter = "";
    }

    if (thinkingContent) {
      this.startThinking();
      this.appendThinking(thinkingContent);
      this.endThinking();
    }

    const combinedText = before + textAfter;

    if (combinedText) {
      this.ensureTextBlock();
      this.appendText(combinedText);
    }
  }

  private finalizeInThinking(): void {
    if (this.buffer) {
      this.appendThinking(this.buffer);
    }

    this.endThinking();

    if (this.textBefore) {
      this.ensureTextBlock();
      this.appendText(this.textBefore);
      this.textBefore = "";
    }
  }

  private finalizeStreamingText(): void {
    if (this.buffer) {
      this.ensureTextBlock();
      this.appendText(this.buffer);
    }
  }

  private restructureForThinking(): void {
    // Text is at index 0. Insert thinking at 0, text moves to 1.
    // pi re-renders from output.content — no flicker.
    const textBlock = this.output.content[0];
    this.output.content[0] = { type: "thinking", thinking: "" };

    if (textBlock) {
      this.output.content[1] = textBlock;
      this.textBlockIndex = 1;
    }

    this.thinkingBlockIndex = 0;
    this.stream.push({ type: "thinking_start", contentIndex: 0, partial: this.output });
  }

  private startThinking(): void {
    this.thinkingBlockIndex = this.output.content.length;
    this.output.content.push({ type: "thinking", thinking: "" });
    this.stream.push({ type: "thinking_start", contentIndex: this.thinkingBlockIndex, partial: this.output });
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
    this.thinkingDone = true;
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

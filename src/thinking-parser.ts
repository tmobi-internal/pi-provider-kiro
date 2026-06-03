// ABOUTME: Stateful parser for thinking tags in streaming content.
// ABOUTME: Buffers all content, then separates thinking blocks from text on finalize.

import type {
  AssistantMessage,
  AssistantMessageEventStream,
  TextContent,
  ThinkingContent,
} from "@earendil-works/pi-ai";

export const THINKING_START_TAG = "<thinking>";
export const THINKING_END_TAG = "</thinking>";

// All recognized thinking tag variants and their corresponding close tags
const THINKING_TAG_VARIANTS: Array<{ open: string; close: string }> = [
  { open: "<thinking>", close: "</thinking>" },
  { open: "<think>", close: "</think>" },
  { open: "<reasoning>", close: "</reasoning>" },
  { open: "<thought>", close: "</thought>" },
];

export class ThinkingTagParser {
  private buffer = "";
  private textBlockIndex: number | null = null;

  constructor(
    private output: AssistantMessage,
    private stream: AssistantMessageEventStream,
  ) {}

  processChunk(chunk: string): void {
    this.buffer += chunk;
  }

  finalize(): void {
    if (this.buffer.length === 0) return;

    const { thinking, text } = this.parse(this.buffer);

    if (thinking) {
      this.emitThinking(thinking);
    }

    if (text) {
      this.emitText(text);
    }

    this.buffer = "";
  }

  getTextBlockIndex(): number | null {
    return this.textBlockIndex;
  }

  private parse(content: string): { thinking: string | null; text: string } {
    // Find the earliest opening tag
    let bestPos = -1;
    let bestVariant: (typeof THINKING_TAG_VARIANTS)[number] | null = null;

    for (const variant of THINKING_TAG_VARIANTS) {
      const pos = content.indexOf(variant.open);

      if (pos !== -1 && (bestPos === -1 || pos < bestPos)) {
        bestPos = pos;
        bestVariant = variant;
      }
    }

    if (bestPos === -1 || !bestVariant) {
      // No thinking tag found — all content is text
      return { thinking: null, text: content };
    }

    // Extract text before the thinking tag
    const textBefore = content.slice(0, bestPos);

    // Extract thinking content
    const afterOpen = content.slice(bestPos + bestVariant.open.length);
    const closePos = afterOpen.indexOf(bestVariant.close);

    let thinkingContent: string;
    let textAfter: string;

    if (closePos !== -1) {
      // Closed thinking block
      thinkingContent = afterOpen.slice(0, closePos);
      textAfter = afterOpen.slice(closePos + bestVariant.close.length);

      // Strip leading \n\n between thinking and text
      if (textAfter.startsWith("\n\n")) {
        textAfter = textAfter.slice(2);
      }
    } else {
      // Unclosed thinking block (stream truncated)
      thinkingContent = afterOpen;
      textAfter = "";
    }

    // Combine text before and after thinking
    const combinedText = textBefore + textAfter;

    return { thinking: thinkingContent, text: combinedText };
  }

  private emitThinking(thinking: string): void {
    const thinkingBlockIndex = this.output.content.length;
    this.output.content.push({ type: "thinking", thinking: "" });
    this.stream.push({ type: "thinking_start", contentIndex: thinkingBlockIndex, partial: this.output });

    const block = this.output.content[thinkingBlockIndex] as ThinkingContent;
    block.thinking = thinking;
    this.stream.push({
      type: "thinking_delta",
      contentIndex: thinkingBlockIndex,
      delta: thinking,
      partial: this.output,
    });

    this.stream.push({
      type: "thinking_end",
      contentIndex: thinkingBlockIndex,
      content: thinking,
      partial: this.output,
    });
  }

  private emitText(text: string): void {
    if (!text) return;

    this.textBlockIndex = this.output.content.length;
    this.output.content.push({ type: "text", text: "" });
    this.stream.push({ type: "text_start", contentIndex: this.textBlockIndex, partial: this.output });

    const block = this.output.content[this.textBlockIndex] as TextContent;
    block.text = text;
    this.stream.push({ type: "text_delta", contentIndex: this.textBlockIndex, delta: text, partial: this.output });
  }
}

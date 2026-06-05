import type { AssistantMessage, AssistantMessageEvent } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { ThinkingTagParser } from "../src/thinking-parser.js";

function makeOutput(): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "kiro-api",
    provider: "kiro",
    model: "test",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

async function run(chunks: string[]): Promise<AssistantMessageEvent[]> {
  const output = makeOutput();
  const stream = createAssistantMessageEventStream();
  const parser = new ThinkingTagParser(output, stream);

  for (const c of chunks) parser.processChunk(c);

  parser.finalize();
  stream.end();

  const events: AssistantMessageEvent[] = [];

  for await (const e of stream) events.push(e);

  return events;
}

function deltas(events: AssistantMessageEvent[], type: string): string {
  return events
    .filter((e) => e.type === type)
    .map((e) => (e as { delta?: string }).delta)
    .join("");
}

function finalOutput(chunks: string[]): AssistantMessage {
  const output = makeOutput();
  const stream = createAssistantMessageEventStream();
  const parser = new ThinkingTagParser(output, stream);

  for (const c of chunks) parser.processChunk(c);

  parser.finalize();
  stream.end();

  return output;
}

describe("Feature 7: Thinking Tag Parser", () => {

  // =========================================================================
  // 기본 파싱: thinking + text 분리
  // =========================================================================

  it("emits thinking then text for content with thinking block", async () => {
    const events = await run(["<thinking>Let me think</thinking>\n\nAnswer"]);
    const types = events.map((e) => e.type);
    expect(types).toContain("thinking_start");
    expect(types).toContain("text_start");
    expect(deltas(events, "thinking_delta")).toContain("Let me think");
    expect(deltas(events, "text_delta")).toContain("Answer");
  });

  it("strips double newline between thinking and text", async () => {
    const events = await run(["<thinking>t</thinking>\n\nAnswer"]);
    expect(deltas(events, "text_delta")).toBe("Answer");
  });

  it("emits only text when no thinking block", async () => {
    const output = finalOutput(["Just plain text"]);
    expect(output.content).toHaveLength(1);
    expect(output.content[0]?.type).toBe("text");
    expect((output.content[0] as { text: string }).text).toBe("Just plain text");
  });

  // =========================================================================
  // Provisional streaming: 즉시 출력 + 타입 전환
  // =========================================================================

  it("emits content as thinking_delta immediately then converts to text", () => {
    const output = makeOutput();
    const stream = createAssistantMessageEventStream();
    const parser = new ThinkingTagParser(output, stream);

    parser.processChunk("Hello world, this is content");

    // Non-whitespace → 즉시 emit + text 전환
    expect(output.content[0]?.type).toBe("text");
    expect((output.content[0] as { text: string }).text).toContain("Hello");
  });

  it("converts type from thinking to text on finalize when no tag found", () => {
    const output = makeOutput();
    const stream = createAssistantMessageEventStream();
    const parser = new ThinkingTagParser(output, stream);

    parser.processChunk("Just plain text without tags");
    parser.finalize();

    // 최종: text 타입으로 전환됨
    expect(output.content[0]?.type).toBe("text");
    expect((output.content[0] as { text: string }).text).toBe("Just plain text without tags");
  });

  it("emits thinking_end then text_start on type conversion", async () => {
    const events = await run(["Just plain text without any tags"]);

    const types = events.map((e) => e.type);
    const thinkingEndIdx = types.indexOf("thinking_end");
    const textStartIdx = types.indexOf("text_start");

    expect(thinkingEndIdx).toBeGreaterThan(-1);
    expect(textStartIdx).toBeGreaterThan(thinkingEndIdx);
  });

  it("type conversion preserves content — same text, different type", async () => {
    const events = await run(["Hello world"]);

    const thinkingText = deltas(events, "thinking_delta");
    const textText = deltas(events, "text_delta");

    // thinking_delta로 나간 내용 + text_delta로 나간 내용 = 전체 텍스트 (중복 없이)
    // text_delta는 없을 수 있음 (finalize에서 추가 content 없으면)
    expect(thinkingText + textText).toBe("Hello world");
  });

  it("contentIndex stays 0 during type conversion", async () => {
    const events = await run(["Hello world"]);

    for (const event of events) {
      if ("contentIndex" in event) {
        expect((event as { contentIndex: number }).contentIndex).toBe(0);
      }
    }
  });

  // =========================================================================
  // Thinking 확정: tag found → thinking 유지
  // =========================================================================

  it("thinking tag at start → confirmed thinking, content stays at index 0", async () => {
    const events = await run(["<thinking>reasoning here</thinking>\n\nAnswer"]);

    // thinking은 index 0
    const thinkingEvents = events.filter(
      (e) => e.type === "thinking_start" || e.type === "thinking_delta" || e.type === "thinking_end",
    );

    for (const e of thinkingEvents) {
      expect((e as { contentIndex: number }).contentIndex).toBe(0);
    }

    // text는 index 1
    const textEvents = events.filter(
      (e) => e.type === "text_start" || e.type === "text_delta",
    );

    for (const e of textEvents) {
      expect((e as { contentIndex: number }).contentIndex).toBe(1);
    }
  });

  it("thinking tag found → no type conversion events", async () => {
    const events = await run(["<thinking>thought</thinking>\n\nText"]);
    const types = events.map((e) => e.type);

    // thinking_end 후에 text_start(1)이 와야지, text_start(0)이 아님
    const textStartEvent = events.find((e) => e.type === "text_start");
    expect((textStartEvent as { contentIndex: number }).contentIndex).toBe(1);
  });

  // =========================================================================
  // 스트리밍: processChunk에서 즉시 이벤트 발행
  // =========================================================================

  it("emits thinking_delta for confirmed thinking during processChunk", () => {
    const output = makeOutput();
    const stream = createAssistantMessageEventStream();
    const parser = new ThinkingTagParser(output, stream);

    parser.processChunk("<thinking>hello ");
    parser.processChunk("world");

    expect(output.content[0]?.type).toBe("thinking");
    expect((output.content[0] as { thinking: string }).thinking).toContain("hello ");
  });

  it("emits text_delta after thinking close tag during processChunk", () => {
    const output = makeOutput();
    const stream = createAssistantMessageEventStream();
    const parser = new ThinkingTagParser(output, stream);

    parser.processChunk("<thinking>reasoning</thinking>\n\nHello ");
    parser.processChunk("world");

    expect(output.content[1]?.type).toBe("text");
    expect((output.content[1] as { text: string }).text).toContain("Hello ");
  });

  // =========================================================================
  // 청크 분할: 태그가 잘려서 오는 경우 (최소 buffering)
  // =========================================================================

  it("holds back potential opening tag prefix at chunk boundary", () => {
    const output = makeOutput();
    const stream = createAssistantMessageEventStream();
    const parser = new ThinkingTagParser(output, stream);

    parser.processChunk("<thin");

    // <thin 은 태그 prefix일 수 있으므로 hold back
    expect(output.content).toHaveLength(0);
  });

  it("detects thinking start tag split across chunks", async () => {
    const events = await run(["<thin", "king>deep thought</thinking>\n\nText"]);
    expect(deltas(events, "thinking_delta")).toContain("deep thought");
    expect(deltas(events, "text_delta")).toContain("Text");
  });

  it("flushes held-back prefix as text after non-whitespace emit", () => {
    const output = makeOutput();
    const stream = createAssistantMessageEventStream();
    const parser = new ThinkingTagParser(output, stream);

    parser.processChunk("Hello world, some long text<thin");

    // Non-whitespace → 즉시 text 전환, prefix도 text로 flush
    expect(output.content[0]?.type).toBe("text");
    const text = (output.content[0] as { text: string }).text;
    expect(text).toContain("Hello world");
    expect(text).toContain("<thin");
  });

  it("detects thinking end tag split across chunks", async () => {
    const events = await run(["<thinking>thought</thi", "nking>\n\nAnswer"]);
    expect(events.map((e) => e.type)).toContain("thinking_end");
    expect(deltas(events, "text_delta")).toContain("Answer");
  });

  it("holds back potential close tag prefix at chunk boundary", () => {
    const output = makeOutput();
    const stream = createAssistantMessageEventStream();
    const parser = new ThinkingTagParser(output, stream);

    parser.processChunk("<thinking>reasoning</thi");

    const thinking = (output.content[0] as { thinking: string }).thinking;
    expect(thinking).toBe("reasoning");
    expect(thinking).not.toContain("</thi");
  });

  // =========================================================================
  // 태그 변형 지원
  // =========================================================================

  it("recognizes <think> tags", async () => {
    const events = await run(["<think>Let me think</think>\n\nAnswer"]);
    expect(deltas(events, "thinking_delta")).toContain("Let me think");
    expect(deltas(events, "text_delta")).toContain("Answer");
  });

  it("recognizes <reasoning> tags", async () => {
    const events = await run(["<reasoning>Step by step</reasoning>\n\nResult"]);
    expect(deltas(events, "thinking_delta")).toContain("Step by step");
    expect(deltas(events, "text_delta")).toContain("Result");
  });

  it("recognizes <thought> tags", async () => {
    const events = await run(["<thought>Hmm</thought>\n\nDone"]);
    expect(deltas(events, "thinking_delta")).toContain("Hmm");
    expect(deltas(events, "text_delta")).toContain("Done");
  });

  // =========================================================================
  // getTextBlockIndex
  // =========================================================================

  it("getTextBlockIndex returns null before any content", () => {
    const output = makeOutput();
    const stream = createAssistantMessageEventStream();
    const parser = new ThinkingTagParser(output, stream);
    expect(parser.getTextBlockIndex()).toBeNull();
  });

  it("getTextBlockIndex returns 0 for text-only content (converted from thinking)", () => {
    const output = makeOutput();
    const stream = createAssistantMessageEventStream();
    const parser = new ThinkingTagParser(output, stream);
    parser.processChunk("hello");
    parser.finalize();
    expect(parser.getTextBlockIndex()).toBe(0);
  });

  it("getTextBlockIndex returns 1 after thinking block", () => {
    const output = makeOutput();
    const stream = createAssistantMessageEventStream();
    const parser = new ThinkingTagParser(output, stream);
    parser.processChunk("<thinking>t</thinking>\n\ntext");
    parser.finalize();
    expect(parser.getTextBlockIndex()).toBe(1);
  });

  // =========================================================================
  // 엣지 케이스
  // =========================================================================

  it("handles empty input", async () => {
    const events = await run([""]);
    expect(events).toHaveLength(0);
  });

  it("handles thinking-only (no text after)", async () => {
    const output = finalOutput(["<thinking>just reasoning</thinking>"]);
    expect(output.content).toHaveLength(1);
    expect(output.content[0]?.type).toBe("thinking");
    expect((output.content[0] as { thinking: string }).thinking).toBe("just reasoning");
  });

  it("handles unclosed thinking tag (stream truncated)", async () => {
    const events = await run(["<thinking>unclosed reasoning"]);
    expect(deltas(events, "thinking_delta")).toBe("unclosed reasoning");
    expect(events.map((e) => e.type)).toContain("thinking_end");
  });

  // =========================================================================
  // 내용 무결성: content 교체/이동 없음
  // =========================================================================

  it("never splices or rearranges output.content array", async () => {
    const output = makeOutput();
    const stream = createAssistantMessageEventStream();
    const parser = new ThinkingTagParser(output, stream);

    const contentRef = output.content;
    parser.processChunk("Hello world");
    parser.finalize();

    // 같은 배열 참조 유지
    expect(output.content).toBe(contentRef);
    // 길이는 1 (splice로 재배치 안 함)
    expect(output.content).toHaveLength(1);
  });

  it("content text is never deleted or replaced", async () => {
    const output = makeOutput();
    const stream = createAssistantMessageEventStream();
    const parser = new ThinkingTagParser(output, stream);

    parser.processChunk("First chunk ");
    // Immediately converted to text
    const afterFirst = (output.content[0] as { text: string }).text;

    parser.processChunk("second chunk");
    const afterSecond = (output.content[0] as { text: string }).text;

    // Append only — previous content preserved
    expect(afterSecond).toContain(afterFirst);
    expect(afterSecond).toContain("second chunk");
  });
});


describe("Feature 7: Start position limit", () => {

  it("treats mid-content <thinking> as literal text", async () => {
    const output = finalOutput(["Hello world<thinking>reasoning</thinking>\n\nMore"]);
    expect(output.content).toHaveLength(1);
    expect(output.content[0]?.type).toBe("text");
    expect((output.content[0] as { text: string }).text).toBe(
      "Hello world<thinking>reasoning</thinking>\n\nMore",
    );
  });

  it("treats mid-content <thinking> across chunks as literal text", async () => {
    const output = finalOutput(["Hey! ", "What?", "<thinking>reason</thinking>"]);
    expect(output.content).toHaveLength(1);
    expect(output.content[0]?.type).toBe("text");
    expect((output.content[0] as { text: string }).text).toBe(
      "Hey! What?<thinking>reason</thinking>",
    );
  });

  it("leading whitespace before thinking tag — trimmed and recognized", async () => {
    const output = finalOutput(["  \n<thinking>deep thought</thinking>\n\nAnswer"]);
    expect(output.content).toHaveLength(2);
    expect(output.content[0]?.type).toBe("thinking");
    expect((output.content[0] as { thinking: string }).thinking).toBe("deep thought");
    expect(output.content[1]?.type).toBe("text");
    expect((output.content[1] as { text: string }).text).toBe("Answer");
  });

  it("whitespace chunk before tag — trimmed and recognized", () => {
    const output = makeOutput();
    const stream = createAssistantMessageEventStream();
    const parser = new ThinkingTagParser(output, stream);

    parser.processChunk("   ");
    parser.processChunk("<thinking>thought</thinking>\n\nText");
    parser.finalize();

    expect(output.content[0]?.type).toBe("thinking");
    expect((output.content[0] as { thinking: string }).thinking).toBe("thought");
    expect(output.content[1]?.type).toBe("text");
    expect((output.content[1] as { text: string }).text).toBe("Text");
  });

  it("newline before tag in single chunk — trimmed and recognized", async () => {
    const events = await run(["\n<thinking>reasoning</thinking>\n\nOutput"]);
    expect(deltas(events, "thinking_delta")).toBe("reasoning");
    expect(deltas(events, "text_delta")).toBe("Output");
  });

  it("non-whitespace before tag — still treated as text", async () => {
    const output = finalOutput(["x <thinking>deep thought</thinking>\n\nAnswer"]);
    expect(output.content).toHaveLength(1);
    expect(output.content[0]?.type).toBe("text");
  });
});
describe("Feature 7: Close tag false-positive defense", () => {

  it("ignores close tag wrapped in backticks inside thinking", async () => {
    const events = await run([
      "<thinking>The parser uses `</thinking>` to detect end\n\nreal reasoning</thinking>\n\nHello",
    ]);
    expect(deltas(events, "thinking_delta")).toBe(
      "The parser uses `</thinking>` to detect end\n\nreal reasoning",
    );
    expect(deltas(events, "text_delta")).toBe("Hello");
  });

  it("handles multiple quoted close tags in thinking", async () => {
    const events = await run([
      "<thinking>`</thinking>` and `</thinking>` both fake\nreal</thinking>\n\nText",
    ]);
    expect(deltas(events, "thinking_delta")).toBe(
      "`</thinking>` and `</thinking>` both fake\nreal",
    );
    expect(deltas(events, "text_delta")).toBe("Text");
  });

  it("does NOT skip unquoted close tag (real close)", async () => {
    const events = await run(["<thinking>done</thinking>\n\nResult"]);
    expect(deltas(events, "thinking_delta")).toBe("done");
    expect(deltas(events, "text_delta")).toBe("Result");
  });

  it("handles quoted close tag split across chunks", async () => {
    const events = await run([
      "<thinking>uses `</thi",
      "nking>` to end\nactual reasoning</thinking>\n\nHi",
    ]);
    expect(deltas(events, "thinking_delta")).toBe(
      "uses `</thinking>` to end\nactual reasoning",
    );
    expect(deltas(events, "text_delta")).toBe("Hi");
  });

  it("handles quoted close tag where closing quote arrives in next chunk", async () => {
    const events = await run([
      "<thinking>uses `</thinking>",
      "` as text\nreal</thinking>\n\nHi",
    ]);
    expect(deltas(events, "thinking_delta")).toBe(
      "uses `</thinking>` as text\nreal",
    );
    expect(deltas(events, "text_delta")).toBe("Hi");
  });

  it("finalize handles quoted close tag (no real close)", async () => {
    const events = await run(["<thinking>mentions `</thinking>` but never closes"]);
    expect(deltas(events, "thinking_delta")).toBe(
      "mentions `</thinking>` but never closes",
    );
    expect(events.map((e) => e.type)).toContain("thinking_end");
  });

  it("handles token-by-token streaming where backtick and close tag arrive separately", async () => {
    const events = await run([
      "<thinking>wrap ",
      "`",
      "</thinking>",
      "` in backticks\nreal thinking</thinking>\n\nHello",
    ]);
    expect(deltas(events, "thinking_delta")).toBe(
      "wrap `</thinking>` in backticks\nreal thinking",
    );
    expect(deltas(events, "text_delta")).toBe("Hello");
  });
});

describe("Feature 7: partial reference behavior", () => {
  it("partial reflects latest state (shared reference, pi processes sequentially)", async () => {
    const output = makeOutput();
    const stream = createAssistantMessageEventStream();
    const parser = new ThinkingTagParser(output, stream);

    parser.processChunk("Hello world");

    // Non-whitespace → 즉시 text 전환
    expect(output.content[0]?.type).toBe("text");
    expect((output.content[0] as { text: string }).text).toBe("Hello world");

    parser.finalize();

    // Finalize doesn't change already-converted content
    expect(output.content[0]?.type).toBe("text");
    expect((output.content[0] as { text: string }).text).toBe("Hello world");
  });
});

describe("Feature 7: leading newline strip", () => {

  it("strips leading newlines from thinking content", async () => {
    const events = await run(["<thinking>\n\nreasoning here</thinking>\n\nAnswer"]);
    expect(deltas(events, "thinking_delta")).toBe("reasoning here");
    expect(deltas(events, "text_delta")).toBe("Answer");
  });

  it("strips leading newlines from thinking across chunks", async () => {
    const events = await run(["<thinking>\n", "\ndeep thought</thinking>\n\nText"]);
    expect(deltas(events, "thinking_delta")).toBe("deep thought");
    expect(deltas(events, "text_delta")).toBe("Text");
  });

  it("strips single newline after close tag", async () => {
    const events = await run(["<thinking>t</thinking>\nAnswer"]);
    expect(deltas(events, "text_delta")).toBe("Answer");
  });

  it("strips multiple newlines after close tag", async () => {
    const events = await run(["<thinking>t</thinking>\n\n\nAnswer"]);
    expect(deltas(events, "text_delta")).toBe("Answer");
  });

  it("strips leading newlines from text on type conversion (no tag)", () => {
    const output = finalOutput(["\n\nHello world"]);
    expect(output.content[0]?.type).toBe("text");
    expect((output.content[0] as { text: string }).text).toBe("Hello world");
  });

  it("preserves leading spaces/tabs in thinking content", async () => {
    const events = await run(["<thinking>  indented</thinking>\n\nText"]);
    expect(deltas(events, "thinking_delta")).toBe("  indented");
  });

  it("preserves leading spaces/tabs in text content", async () => {
    const events = await run(["<thinking>t</thinking>\n\n  indented text"]);
    expect(deltas(events, "text_delta")).toBe("  indented text");
  });

});

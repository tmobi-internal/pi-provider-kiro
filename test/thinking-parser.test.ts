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

  it("emits only text when no thinking block", async () => {
    const events = await run(["Just plain text"]);
    expect(events.map((e) => e.type)).not.toContain("thinking_start");
    expect(deltas(events, "text_delta")).toBe("Just plain text");
  });

  it("strips double newline between thinking and text", async () => {
    const events = await run(["<thinking>t</thinking>\n\nAnswer"]);
    expect(deltas(events, "text_delta")).toBe("Answer");
  });

  // =========================================================================
  // 스트리밍: processChunk에서 즉시 이벤트 발행
  // =========================================================================

  it("emits thinking_delta during processChunk (not waiting for finalize)", () => {
    const output = makeOutput();
    const stream = createAssistantMessageEventStream();
    const parser = new ThinkingTagParser(output, stream);

    parser.processChunk("<thinking>hello ");
    parser.processChunk("world");

    // finalize 전이지만 thinking이 이미 content에 누적되어야 함
    expect(output.content[0]?.type).toBe("thinking");
    expect((output.content[0] as { thinking: string }).thinking).toContain("hello ");
  });

  it("emits text_delta after thinking close tag during processChunk", () => {
    const output = makeOutput();
    const stream = createAssistantMessageEventStream();
    const parser = new ThinkingTagParser(output, stream);

    parser.processChunk("<thinking>reasoning</thinking>\n\nHello ");
    parser.processChunk("world");

    // finalize 전이지만 text가 이미 content에 누적되어야 함
    expect(output.content[1]?.type).toBe("text");
    expect((output.content[1] as { text: string }).text).toContain("Hello ");
  });

  it("streams text immediately when no thinking tag found", () => {
    const output = makeOutput();
    const stream = createAssistantMessageEventStream();
    const parser = new ThinkingTagParser(output, stream);

    // 충분히 긴 텍스트 — 태그 존재 불가능 확정
    parser.processChunk("This is plain text without any tags");

    // finalize 전이지만 text가 content에 있어야 함
    expect(output.content[0]?.type).toBe("text");
    expect((output.content[0] as { text: string }).text).toContain("This is plain text");
  });

  it("streams text containing non-thinking '<' immediately", () => {
    const output = makeOutput();
    const stream = createAssistantMessageEventStream();
    const parser = new ThinkingTagParser(output, stream);

    parser.processChunk("Hello <b>world</b> text");

    // '<b>' is not a thinking tag — should stream immediately
    expect(output.content[0]?.type).toBe("text");
    expect((output.content[0] as { text: string }).text).toContain("Hello <b>world</b>");
  });

  it("buffers short initial chunk that could be start of tag", () => {
    const output = makeOutput();
    const stream = createAssistantMessageEventStream();
    const parser = new ThinkingTagParser(output, stream);

    parser.processChunk("<th");

    // 아직 태그인지 판별 불가 — content가 비어있어야 함
    expect(output.content).toHaveLength(0);
  });

  it("holds back potential close tag prefix at chunk boundary", () => {
    const output = makeOutput();
    const stream = createAssistantMessageEventStream();
    const parser = new ThinkingTagParser(output, stream);

    parser.processChunk("<thinking>reasoning</thi");

    // '</thi'는 닫기 태그 후보이므로 홀드
    expect(output.content[0]?.type).toBe("thinking");
    const thinking = (output.content[0] as { thinking: string }).thinking;
    expect(thinking).toBe("reasoning");
    expect(thinking).not.toContain("</thi");
  });
  // =========================================================================
  // 인덱스 일관성: 발행된 이벤트의 contentIndex와 content 배열 위치 일치
  // =========================================================================

  it("contentIndex in events matches actual content array position", async () => {
    const events = await run(["<thinking>reasoning</thinking>\n\nAnswer"]);

    for (const event of events) {
      if ("contentIndex" in event && event.contentIndex !== undefined) {
        const idx = event.contentIndex as number;
        expect(idx).toBeLessThan(2); // thinking(0) + text(1)

        if (event.type === "thinking_start" || event.type === "thinking_delta" || event.type === "thinking_end") {
          expect(idx).toBe(0);
        }

        if (event.type === "text_start" || event.type === "text_delta") {
          expect(idx).toBe(1);
        }
      }
    }
  });

  it("contentIndex consistent when text arrives before thinking", async () => {
    const output = makeOutput();
    const stream = createAssistantMessageEventStream();
    const parser = new ThinkingTagParser(output, stream);

    parser.processChunk("Hello world");
    parser.processChunk("<thinking>reasoning</thinking>");
    parser.finalize();
    stream.end();

    const events: AssistantMessageEvent[] = [];
    for await (const e of stream) events.push(e);

    // thinking이 content[0], text가 content[1] (restructure 후 최종 상태)
    expect(output.content[0]?.type).toBe("thinking");
    expect(output.content[1]?.type).toBe("text");

    // thinking 이벤트는 항상 contentIndex=0
    for (const event of events) {
      if ("contentIndex" in event && event.contentIndex !== undefined) {
        const idx = event.contentIndex as number;

        if (event.type === "thinking_start" || event.type === "thinking_delta" || event.type === "thinking_end") {
          expect(idx).toBe(0);
        }
      }
    }
  });

  // =========================================================================
  // 청크 분할: 태그가 잘려서 오는 경우
  // =========================================================================

  it("detects thinking start tag split across chunks", async () => {
    const events = await run(["<thin", "king>deep thought</thinking>"]);
    expect(deltas(events, "thinking_delta")).toContain("deep thought");
  });

  it("detects thinking end tag split across chunks", async () => {
    const events = await run(["<thinking>thought</thi", "nking>\n\nAnswer"]);
    expect(events.map((e) => e.type)).toContain("thinking_end");
    expect(deltas(events, "text_delta")).toContain("Answer");
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

  it("handles <think> split across chunks", async () => {
    const events = await run(["<thi", "nk>deep thought</think>\n\nText"]);
    expect(deltas(events, "thinking_delta")).toContain("deep thought");
    expect(deltas(events, "text_delta")).toContain("Text");
  });

  it("handles <reasoning> split across chunks", async () => {
    const events = await run(["<reason", "ing>logic</reasoning>\n\nOutput"]);
    expect(deltas(events, "thinking_delta")).toContain("logic");
    expect(deltas(events, "text_delta")).toContain("Output");
  });

  it("handles close tag split across chunks for <think>", async () => {
    const events = await run(["<think>idea</th", "ink>\n\nText"]);
    expect(events.map((e) => e.type)).toContain("thinking_end");
    expect(deltas(events, "text_delta")).toContain("Text");
  });

  // =========================================================================
  // 태그 변형: 어레이 순서대로 첫 번째 변형이 아닌 가장 앞에 위치한 변형 선택
  // =========================================================================

  it("picks the earliest tag variant by position, not array order", async () => {
    // <thought> appears before <thinking> in the content
    const events = await run(["<thought>first</thought>\n\n<thinking>second</thinking>"]);
    expect(deltas(events, "thinking_delta")).toBe("first");
    expect(deltas(events, "text_delta")).toContain("<thinking>second</thinking>");
  });

  // =========================================================================
  // restructure: 스트리밍 중 텍스트 유지
  // =========================================================================

  it("preserves previously streamed text after restructure (before finalize)", () => {
    const output = makeOutput();
    const stream = createAssistantMessageEventStream();
    const parser = new ThinkingTagParser(output, stream);

    // text streams first
    parser.processChunk("This is plain text without any tags");
    expect(output.content[0]?.type).toBe("text");

    // thinking tag arrives — triggers restructure
    parser.processChunk("<thinking>reasoning</thinking>");

    // text should still be visible at index 1 immediately (no flicker)
    expect(output.content[0]?.type).toBe("thinking");
    expect(output.content[1]?.type).toBe("text");
    expect((output.content[1] as { text: string }).text).toContain("This is plain text");
  });

  // =========================================================================
  // text-before-thinking (Kiro API가 text를 먼저 보내는 경우)
  // =========================================================================

  it("correctly separates when text arrives before thinking", async () => {
    const output = makeOutput();
    const stream = createAssistantMessageEventStream();
    const parser = new ThinkingTagParser(output, stream);

    parser.processChunk("Hello world");
    parser.processChunk("<thinking>reasoning</thinking>");
    parser.finalize();
    stream.end();

    expect(output.content[0]?.type).toBe("thinking");
    expect(output.content[1]?.type).toBe("text");
    expect((output.content[0] as { thinking: string }).thinking).toBe("reasoning");
    expect((output.content[1] as { text: string }).text).toBe("Hello world");
  });

  it("handles text-before-thinking across multiple chunks", async () => {
    const output = makeOutput();
    const stream = createAssistantMessageEventStream();
    const parser = new ThinkingTagParser(output, stream);

    parser.processChunk("Hey! ");
    parser.processChunk("What can I help with?");
    parser.processChunk("<thinking>Let me think about this</thinking>");
    parser.finalize();
    stream.end();

    expect(output.content[0]?.type).toBe("thinking");
    expect(output.content[1]?.type).toBe("text");
    expect((output.content[0] as { thinking: string }).thinking).toBe("Let me think about this");
    expect((output.content[1] as { text: string }).text).toBe("Hey! What can I help with?");
  });

  // =========================================================================
  // getTextBlockIndex
  // =========================================================================

  it("getTextBlockIndex returns null before finalize", () => {
    const output = makeOutput();
    const stream = createAssistantMessageEventStream();
    const parser = new ThinkingTagParser(output, stream);
    expect(parser.getTextBlockIndex()).toBeNull();
  });

  it("getTextBlockIndex returns 0 for text-only content", () => {
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

  it("getTextBlockIndex returns 1 when text arrives before thinking", () => {
    const output = makeOutput();
    const stream = createAssistantMessageEventStream();
    const parser = new ThinkingTagParser(output, stream);
    parser.processChunk("Hello");
    parser.processChunk("<thinking>t</thinking>");
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
    const events = await run(["<thinking>just reasoning</thinking>"]);
    expect(deltas(events, "thinking_delta")).toBe("just reasoning");
    expect(events.map((e) => e.type)).not.toContain("text_start");
  });

  it("handles unclosed thinking tag (stream truncated)", async () => {
    const events = await run(["<thinking>unclosed reasoning"]);
    // 닫기 태그 없이 끝나도 thinking_end를 발행해야 함
    expect(deltas(events, "thinking_delta")).toBe("unclosed reasoning");
    expect(events.map((e) => e.type)).toContain("thinking_end");
  });
});

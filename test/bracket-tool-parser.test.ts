import { describe, expect, it } from "vitest";
import { parseBracketToolCalls } from "../src/bracket-tool-parser.js";

describe("bracket-tool-parser", () => {

  it("parses a single bracket-style tool call", () => {
    const text = '[Called read_file with args: {"path": "src/index.ts"}]';
    const result = parseBracketToolCalls(text);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("read_file");
    expect(result.toolCalls[0].arguments).toEqual({ path: "src/index.ts" });
    expect(result.cleanedText).toBe("");
  });

  it("parses multiple bracket-style tool calls", () => {
    const text = 'Here is output\n[Called read_file with args: {"path": "a.ts"}]\nsome text\n[Called write_file with args: {"path": "b.ts", "content": "x"}]';
    const result = parseBracketToolCalls(text);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].name).toBe("read_file");
    expect(result.toolCalls[1].name).toBe("write_file");
    expect(result.cleanedText).toContain("Here is output");
    expect(result.cleanedText).toContain("some text");
  });

  it("returns empty when no bracket tool calls", () => {
    const text = "Just regular text without any tool calls.";
    const result = parseBracketToolCalls(text);
    expect(result.toolCalls).toHaveLength(0);
    expect(result.cleanedText).toBe(text);
  });

  it("handles malformed JSON gracefully", () => {
    const text = '[Called bad_tool with args: {invalid json}]';
    const result = parseBracketToolCalls(text);
    expect(result.toolCalls).toHaveLength(0);
    expect(result.cleanedText).toBe(text);
  });

  it("generates a toolUseId for each call", () => {
    const text = '[Called my_tool with args: {"x": 1}]';
    const result = parseBracketToolCalls(text);
    expect(result.toolCalls[0].toolUseId).toBeDefined();
    expect(result.toolCalls[0].toolUseId.length).toBeGreaterThan(0);
  });

});

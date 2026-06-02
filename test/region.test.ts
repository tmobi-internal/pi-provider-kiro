import { describe, expect, it } from "vitest";
import { resolveApiRegion } from "../src/region.js";

describe("resolveApiRegion", () => {
  it("returns us-east-1 for empty string", () => {
    expect(resolveApiRegion("")).toBe("us-east-1");
  });

  it("passes through us-east-1 unchanged", () => {
    expect(resolveApiRegion("us-east-1")).toBe("us-east-1");
  });

  it("passes through eu-central-1 unchanged", () => {
    expect(resolveApiRegion("eu-central-1")).toBe("eu-central-1");
  });

  it("maps us-west-1 to us-east-1", () => {
    expect(resolveApiRegion("us-west-1")).toBe("us-east-1");
  });

  it("maps us-west-2 to us-east-1", () => {
    expect(resolveApiRegion("us-west-2")).toBe("us-east-1");
  });

  it("maps eu-west-1 to eu-central-1", () => {
    expect(resolveApiRegion("eu-west-1")).toBe("eu-central-1");
  });

  it("maps eu-west-2 to eu-central-1", () => {
    expect(resolveApiRegion("eu-west-2")).toBe("eu-central-1");
  });

  it("maps eu-north-1 to eu-central-1", () => {
    expect(resolveApiRegion("eu-north-1")).toBe("eu-central-1");
  });

  it("maps ap-northeast-1 to us-east-1", () => {
    expect(resolveApiRegion("ap-northeast-1")).toBe("us-east-1");
  });

  it("maps ap-northeast-2 to us-east-1", () => {
    expect(resolveApiRegion("ap-northeast-2")).toBe("us-east-1");
  });

  it("maps ap-southeast-1 to us-east-1", () => {
    expect(resolveApiRegion("ap-southeast-1")).toBe("us-east-1");
  });

  it("returns unknown region as-is (passthrough)", () => {
    expect(resolveApiRegion("sa-east-1")).toBe("sa-east-1");
  });
});

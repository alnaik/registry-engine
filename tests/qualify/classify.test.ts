import { describe, it, expect } from "vitest";
import { buildClassifyBatch, parseClassifyResponse } from "../../packages/qualify/src/pipeline/classify.js";
import type { ClassifyInput } from "../../packages/qualify/src/pipeline/classify.js";
import type { SearchIntent } from "../../packages/qualify/src/pipeline/intent.js";

const mockIntent: SearchIntent = {
  query: "independent jewelers that use princess cut diamonds",
  keywords: ["jewel", "gem", "diamond"],
  exclusions: ["pawn"],
  requirement: "sells or works with princess cut diamonds",
};

function makeItems(n: number): ClassifyInput[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `entity-${i}`,
    name: `Business ${i} LLC`,
    tradeDesc: "General merchandise and retail goods wholesale distribution services",
  }));
}

describe("buildClassifyBatch", () => {
  it("batch of 30 fits within 15k token budget (chars/4 heuristic)", () => {
    const items = makeItems(30);
    const { system, user } = buildClassifyBatch(items, mockIntent);
    const totalChars = system.length + user.length;
    const estimatedTokens = Math.ceil(totalChars / 4);
    expect(estimatedTokens).toBeLessThan(15000);
    console.log(`Classify batch (30): ~${estimatedTokens} tokens estimated`);
  });

  it("includes the raw query as the classification criterion", () => {
    const { system } = buildClassifyBatch(makeItems(1), mockIntent);
    expect(system).toContain(mockIntent.query);
  });

  it("tradeDesc is truncated to 120 chars per entity", () => {
    const items: ClassifyInput[] = [{
      id: "x", name: "Test LLC", tradeDesc: "a".repeat(300),
    }];
    const { user } = buildClassifyBatch(items, mockIntent);
    const parts = user.split("\t");
    expect((parts[2] ?? "").length).toBeLessThanOrEqual(120);
  });
});

describe("parseClassifyResponse", () => {
  it("parses valid Y/N/U verdicts", () => {
    const items = makeItems(3);
    const content = "0:Y\n1:N\n2:U";
    const result = parseClassifyResponse(content, items);
    expect(result.get("entity-0")).toBe("Y");
    expect(result.get("entity-1")).toBe("N");
    expect(result.get("entity-2")).toBe("U");
  });

  it("defaults missing lines to U", () => {
    const items = makeItems(3);
    const content = "0:Y";
    const result = parseClassifyResponse(content, items);
    expect(result.get("entity-1")).toBe("U");
    expect(result.get("entity-2")).toBe("U");
  });

  it("ignores unparseable lines", () => {
    const items = makeItems(2);
    const content = "0:Y\ngarbage line here\n1:N";
    const result = parseClassifyResponse(content, items);
    expect(result.get("entity-0")).toBe("Y");
    expect(result.get("entity-1")).toBe("N");
  });
});

import { describe, it, expect } from "vitest";
import { parseIntentResponse, fallbackIntent } from "../../packages/qualify/src/pipeline/intent.js";

const QUERY = "shops and jewelers that use princess cut diamonds";

describe("parseIntentResponse", () => {
  it("parses a well-formed intent", () => {
    const content = JSON.stringify({
      keywords: ["jewel", "gem", "diamond"],
      exclusions: ["pawn"],
      requirement: "sells or works with princess cut diamonds",
    });
    const intent = parseIntentResponse(content, QUERY);
    expect(intent.keywords).toEqual(["jewel", "gem", "diamond"]);
    expect(intent.exclusions).toEqual(["pawn"]);
    expect(intent.requirement).toContain("princess cut");
    expect(intent.query).toBe(QUERY);
  });

  it("strips markdown fences", () => {
    const content = '```json\n{"keywords":["jewel"],"exclusions":[],"requirement":"r"}\n```';
    const intent = parseIntentResponse(content, QUERY);
    expect(intent.keywords).toEqual(["jewel"]);
  });

  it("caps keyword and exclusion lists at 8 items", () => {
    const content = JSON.stringify({
      keywords: Array.from({ length: 20 }, (_, i) => `kw${i}`),
      exclusions: Array.from({ length: 20 }, (_, i) => `ex${i}`),
      requirement: "r",
    });
    const intent = parseIntentResponse(content, QUERY);
    expect(intent.keywords.length).toBeLessThanOrEqual(8);
    expect(intent.exclusions.length).toBeLessThanOrEqual(8);
  });

  it("drops non-string list entries", () => {
    const content = '{"keywords":["jewel", 42, {"a":1}],"exclusions":[],"requirement":"r"}';
    const intent = parseIntentResponse(content, QUERY);
    expect(intent.keywords).toEqual(["jewel"]);
  });

  it("falls back to naive extraction on unparseable output", () => {
    const intent = parseIntentResponse("not json at all", QUERY);
    expect(intent.keywords.length).toBeGreaterThan(0);
    expect(intent.requirement).toBe(QUERY);
  });
});

describe("fallbackIntent", () => {
  it("extracts content words, skipping stopwords", () => {
    const intent = fallbackIntent(QUERY);
    expect(intent.keywords).toContain("jewelers");
    expect(intent.keywords).toContain("princess");
    expect(intent.keywords).not.toContain("that");
    expect(intent.keywords).not.toContain("use");
  });
});

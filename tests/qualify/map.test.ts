import { describe, it, expect } from "vitest";
import { mapQuery, parseMapResponse } from "../../packages/qualify/src/verbs/map.js";
import { createLlm, type RawLlm } from "../../packages/qualify/src/llm/adapter.js";

const CO = { region: "US-CO", cities: ["Colorado Springs", "Denver", "Boulder"] };

function countingLlm(response: string) {
  let calls = 0;
  const backend: RawLlm = { complete: async () => { calls++; return response; } };
  return { llm: createLlm({ backend }), calls: () => calls };
}

describe("mapQuery — static table (zero LLM calls)", () => {
  it("golden query (a): jewelers needing princess cut diamonds, Denver", async () => {
    const { llm, calls } = countingLlm("SHOULD NOT BE CALLED");
    const r = await mapQuery("find jewelers that need princess cut diamonds in Denver", llm, CO);
    expect(calls()).toBe(0);
    expect(r.usedLlm).toBe(false);
    expect(r.intent.naics).toContain("339910");
    expect(r.keywords).toContain("jewel");
    expect(r.intent.geo).toEqual({ region: "US-CO", cities: ["Denver"] });
    expect(r.intent.direction).toBe("sell");
    // "need" must be flagged as proxy-inferred, and "princess cut" as unverifiable
    expect(r.caveats.some(c => c.includes("proxy-inferred"))).toBe(true);
    expect(r.caveats.some(c => c.includes("princess cut"))).toBe(true);
  });

  it("golden query (b): yukon gold potato supplier near me", async () => {
    const { llm, calls } = countingLlm("SHOULD NOT BE CALLED");
    const r = await mapQuery("yukon gold potato supplier near me", llm, CO);
    expect(calls()).toBe(0);
    expect(r.intent.naics).toContain("4244");
    expect(r.keywords).toContain("potato");
    expect(r.intent.direction).toBe("buy");
    expect(r.intent.geo.cities).toEqual([]); // "near me" -> whole region
    expect(r.caveats.some(c => c.includes("yukon gold"))).toBe(true);
  });

  it("resolves multi-word cities", async () => {
    const r = await mapQuery("bakeries in colorado springs", null, CO);
    expect(r.intent.geo.cities).toEqual(["Colorado Springs"]);
    expect(r.intent.naics).toContain("311811");
  });
});

describe("mapQuery — LLM fallback", () => {
  it("spends exactly one cheap call on unknown industries", async () => {
    const { llm, calls } = countingLlm(
      '{"naics":["336413","999999","aerospace"],"keywords":["aero","space"],"cities":["Boulder"],"direction":"sell","caveats":["titanium spec unverifiable"]}'
    );
    const r = await mapQuery("titanium fastener buyers in aerospace, Boulder", llm, CO);
    expect(calls()).toBe(1);
    expect(r.usedLlm).toBe(true);
    expect(r.intent.naics).toEqual(["336413"]); // invalid codes are dropped
    expect(r.keywords).toEqual(["aero", "space"]);
    expect(r.intent.geo.cities).toEqual(["Boulder"]);
    expect(r.caveats).toContain("titanium spec unverifiable");
  });

  it("falls back to naive keyword extraction on model garbage", async () => {
    const { llm } = countingLlm("I think you should try searching for... maybe?");
    const r = await mapQuery("quantum widget makers", llm, CO);
    expect(r.usedLlm).toBe(false);
    expect(r.intent.naics).toEqual([]);
    expect(r.keywords).toContain("quantum");
  });

  it("works with no LLM at all", async () => {
    const r = await mapQuery("quantum widget makers", null, CO);
    expect(r.keywords).toEqual(["quantum", "widget", "makers"]);
  });
});

describe("parseMapResponse hardening", () => {
  it("strips code fences and prose around the JSON", () => {
    const r = parseMapResponse('Here you go!\n```json\n{"keywords":["potato"],"naics":["424480"]}\n```', "US-CO", "sell", []);
    expect(r?.keywords).toEqual(["potato"]);
  });

  it("rejects responses without keywords", () => {
    expect(parseMapResponse('{"naics":["424480"]}', "US-CO", "sell", [])).toBeNull();
  });

  it("caps list sizes and string lengths", () => {
    const many = JSON.stringify({ keywords: Array.from({ length: 30 }, (_, i) => `kw${i}${"x".repeat(100)}`) });
    const r = parseMapResponse(many, "US-CO", "sell", []);
    expect(r!.keywords.length).toBeLessThanOrEqual(8);
    expect(r!.keywords[0]!.length).toBeLessThanOrEqual(40);
  });
});

import { describe, it, expect } from "vitest";
import { mapQuery, parseMapResponse } from "../../packages/qualify/src/verbs/map.js";
import { createLlm, type RawLlm } from "../../packages/qualify/src/llm/adapter.js";

const CO = { region: "US-CO", cities: ["Colorado Springs", "Denver", "Boulder"] };

function countingLlm(response: string) {
  let calls = 0;
  const backend: RawLlm = { complete: async () => { calls++; return response; } };
  return { llm: createLlm({ backend }), calls: () => calls };
}

describe("mapQuery — no LLM: supplier-side static table", () => {
  it("restaurants in boulder -> 7225 + city Boulder", async () => {
    const r = await mapQuery("restaurants in boulder", null, CO);
    expect(r.via).toBe("table");
    expect(r.usedLlm).toBe(false);
    expect(r.intent.naics).toContain("7225");
    expect(r.intent.geo).toEqual({ region: "US-CO", cities: ["Boulder"] });
    expect(r.intent.direction).toBe("buy");
  });

  it("region and role words never become keywords", async () => {
    const r = await mapQuery("packaging manufacturer in colorado", null, CO);
    expect(r.via).toBe("table");
    expect(r.intent.naics).toContain("322211");
    expect(r.keywords).not.toContain("colorado");
    expect(r.keywords).not.toContain("manufacturer");
    expect(r.keywords).toContain("pack");
  });

  it("a need is the buy direction", async () => {
    const r = await mapQuery("I need someone to sew tote bags", null, CO);
    expect(r.intent.direction).toBe("buy");
    expect(r.intent.naics).toContain("314910");
    expect(r.caveats).toEqual([]);
  });

  it("multi-word cities are detected and not used as keywords", async () => {
    const r = await mapQuery("bakeries in colorado springs", null, CO);
    expect(r.intent.geo.cities).toEqual(["Colorado Springs"]);
    expect(r.intent.naics).toContain("311811");
    expect(r.keywords).not.toContain("springs");
  });

  it("unknown industry -> no codes, name matches only, with a caveat", async () => {
    const r = await mapQuery("quantum widget makers", null, CO);
    expect(r.via).toBe("none");
    expect(r.intent.naics).toEqual([]);
    expect(r.keywords).toEqual(["quantum", "widget"]);
    expect(r.caveats.some(c => c.includes("--naics"))).toBe(true);
  });
});

describe("mapQuery — sell direction", () => {
  it("who would buy my hot sauce -> sell", async () => {
    const r = await mapQuery("who would buy my hot sauce", null, CO);
    expect(r.intent.direction).toBe("sell");
  });

  it("without an LLM: empty codes + keywords, and a caveat saying the LLM or --naics is needed", async () => {
    const r = await mapQuery("restaurants in boulder that buy produce", null, CO);
    expect(r.intent.direction).toBe("sell");
    expect(r.via).toBe("none");
    expect(r.intent.naics).toEqual([]);
    expect(r.keywords).toEqual([]);
    expect(r.caveats.some(c => c.includes("finding buyers needs the LLM step"))).toBe(true);
    expect(r.caveats.some(c => c.includes("never what it currently buys"))).toBe(true);
  });
});

describe("mapQuery — --naics override", () => {
  it("valid codes win, with zero LLM calls; invalid codes are dropped", async () => {
    const { llm, calls } = countingLlm("SHOULD NOT BE CALLED");
    const r = await mapQuery("metal fabrication in denver", llm, { ...CO, naics: ["332", "999999", "abc", "332312"] });
    expect(calls()).toBe(0);
    expect(r.via).toBe("override");
    expect(r.intent.naics).toEqual(["332", "332312"]);
    expect(r.keywords).toEqual(["metal", "fabrication"]);
    expect(r.intent.geo.cities).toEqual(["Denver"]);
  });

  it("all-invalid override falls through to the next step", async () => {
    const r = await mapQuery("restaurants in boulder", null, { ...CO, naics: ["000000"] });
    expect(r.via).toBe("table");
  });
});

describe("mapQuery — LLM", () => {
  it("spends exactly one cheap call, drops invalid codes, direction comes from the model", async () => {
    const { llm, calls } = countingLlm(
      '{"naics":["336413","999999","aerospace"],"keywords":["Aero!","space"],"cities":["boulder"],"direction":"sell","caveats":["titanium spec unverifiable"]}'
    );
    const r = await mapQuery("titanium fastener buyers in aerospace, Boulder", llm, CO);
    expect(calls()).toBe(1);
    expect(r.usedLlm).toBe(true);
    expect(r.via).toBe("llm");
    expect(r.intent.naics).toEqual(["336413"]);
    expect(r.keywords).toEqual(["aero", "space"]);
    expect(r.intent.geo.cities).toEqual(["Boulder"]);
    expect(r.intent.direction).toBe("sell");
    expect(r.caveats).toContain("titanium spec unverifiable");
    expect(r.caveats.some(c => c.includes("never what it currently buys"))).toBe(true);
  });

  it("all codes invalid -> falls back to the no-LLM path", async () => {
    const { llm, calls } = countingLlm('{"naics":["999999","12"],"keywords":["potato"]}');
    const r = await mapQuery("restaurants in boulder", llm, CO);
    expect(calls()).toBe(1);
    expect(r.usedLlm).toBe(false);
    expect(r.via).toBe("table");
    expect(r.intent.naics).toContain("7225");
  });

  it("falls back on model garbage", async () => {
    const { llm } = countingLlm("I think you should try searching for... maybe?");
    const r = await mapQuery("quantum widget makers", llm, CO);
    expect(r.usedLlm).toBe(false);
    expect(r.via).toBe("none");
    expect(r.intent.naics).toEqual([]);
    expect(r.keywords).toContain("quantum");
  });

  it("falls back when the call throws", async () => {
    const backend: RawLlm = { complete: async () => { throw new Error("boom"); } };
    const r = await mapQuery("restaurants in boulder", createLlm({ backend }), CO);
    expect(r.via).toBe("table");
  });
});

describe("parseMapResponse hardening", () => {
  it("strips code fences and prose around the JSON", () => {
    const r = parseMapResponse('Here you go!\n```json\n{"keywords":["potato"],"naics":["424480"]}\n```', "US-CO", "buy", []);
    expect(r?.keywords).toEqual(["potato"]);
    expect(r?.intent.naics).toEqual(["424480"]);
  });

  it("drops LLM keywords made only of stopwords, keeps real ones", () => {
    const r = parseMapResponse(
      '{"naics":["315210"],"keywords":["custom","Quality","bulk order","small batch","tote","cheap bag","services"]}',
      "US-CO", "buy", []);
    // "bulk order" and "cheap bag" keep a non-stopword word
    expect(r?.keywords).toEqual(["bulk order", "tote", "cheap bag"]);
  });

  it("rejects responses without a valid code", () => {
    expect(parseMapResponse('{"keywords":["potato"]}', "US-CO", "buy", [])).toBeNull();
    expect(parseMapResponse('{"naics":["999999"],"keywords":["potato"]}', "US-CO", "buy", [])).toBeNull();
  });

  it("dedupes and caps codes and keywords, truncation cannot forge a code", () => {
    const codes = ["332312", "332312", "332322", "332999", "332710", "332811", "332812", "332813", "3323129"];
    const many = JSON.stringify({
      naics: codes,
      keywords: Array.from({ length: 30 }, (_, i) => `kw${i}${"x".repeat(100)}`),
    });
    const r = parseMapResponse(many, "US-CO", "buy", []);
    expect(r!.intent.naics).toEqual(["332312", "332322", "332999", "332710", "332811", "332812"]);
    expect(r!.keywords).toHaveLength(6);
    expect(r!.keywords[0]!.length).toBeLessThanOrEqual(40);
  });

  it("falls back to the static direction when the model gives none", () => {
    const r = parseMapResponse('{"naics":["424480"]}', "US-CO", "sell", ["static caveat"]);
    expect(r!.intent.direction).toBe("sell");
    expect(r!.caveats).toContain("static caveat");
  });
});

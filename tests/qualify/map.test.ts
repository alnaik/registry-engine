import { describe, it, expect } from "vitest";
import { mapQuery, parseMapResponse, MAP_SYSTEM } from "../../packages/qualify/src/verbs/map.js";
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
    expect(r.caveats.some(c => c.includes("enter industry codes"))).toBe(true);
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
    expect(r.caveats.some(c => c.includes("finding buyers needs the AI step"))).toBe(true);
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

  it("passes the user's location to the model, and only when given", async () => {
    const prompts: string[] = [];
    const backend: RawLlm = { complete: async prompt => { prompts.push(prompt); return '{"naics":["332312"]}'; } };
    await mapQuery("metal fabrication shop", createLlm({ backend }), { ...CO, locationHint: "Castle Rock" });
    await mapQuery("metal fabrication shop", createLlm({ backend }), CO);
    expect(prompts[0]).toBe("metal fabrication shop\n\nUser's location: Castle Rock");
    expect(prompts[1]).toBe("metal fabrication shop");
    expect(MAP_SYSTEM).toContain("never add a caveat about a missing location");
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
    expect(r.llmError).toContain("boom");
  });

  it("garbage output sets llmError; success and no-LLM leave it undefined", async () => {
    const bad = await mapQuery("quantum widget makers", countingLlm("not json").llm, CO);
    expect(bad.llmError).toBe("the AI answer couldn't be used");
    const good = await mapQuery("restaurants in boulder", countingLlm('{"naics":["7225"],"keywords":["grill"]}').llm, CO);
    expect(good.llmError).toBeUndefined();
    expect((await mapQuery("restaurants in boulder", null, CO)).llmError).toBeUndefined();
    const over = await mapQuery("restaurants in boulder", countingLlm("x").llm, { ...CO, naics: ["7225"] });
    expect(over.llmError).toBeUndefined();
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

describe("mapQuery — gazetteer places", () => {
  const PLACES = ["denver", "castle rock", "golden", "boulder", "colorado springs", "springs"];

  it("detects a place after a locative", async () => {
    const r = await mapQuery("metal fabrication near castle rock", null, { region: "US-CO", cities: [], places: PLACES });
    expect(r.intent.geo.cities).toEqual(["Castle Rock"]);
    expect(r.intent.naics).toContain("332312");
    expect(r.keywords).not.toContain("castle");
    expect(r.keywords).not.toContain("rock");
  });

  it("does not read a place name used as an ordinary word", async () => {
    const r = await mapQuery("golden retriever groomer", null, { region: "US-CO", cities: [], places: PLACES });
    expect(r.intent.geo.cities).toEqual([]);
  });

  it("prefers the longest place and dedupes against curated cities", async () => {
    const r = await mapQuery("bakeries in colorado springs and near denver", null,
      { region: "US-CO", cities: ["Denver", "Colorado Springs"], places: PLACES });
    expect(r.intent.geo.cities).toEqual(["Colorado Springs", "Denver"]);
  });

  it("curated cities need a locative or the end of the query", async () => {
    const r = await mapQuery("bakeries near boulder", null, { ...CO, places: PLACES });
    expect(r.intent.geo.cities).toEqual(["Boulder"]);
    const none = await mapQuery("boulder bakeries", null, { ...CO, places: PLACES });
    expect(none.intent.geo.cities).toEqual([]);
  });

  it("a curated city that is also an ordinary word needs the guard (M5)", async () => {
    const r = await mapQuery("golden retriever groomer", null, { region: "US-CO", cities: ["Golden", "Denver"], places: PLACES });
    expect(r.intent.geo.cities).toEqual([]);
    const a = await mapQuery("produce supplier in denver", null, { region: "US-CO", cities: ["Golden", "Denver"], places: PLACES });
    expect(a.intent.geo.cities).toEqual(["Denver"]);
    const b = await mapQuery("produce suppliers denver", null, { region: "US-CO", cities: ["Golden", "Denver"], places: PLACES });
    expect(b.intent.geo.cities).toEqual(["Denver"]);
  });
});

describe("mapQuery — static table and direction (H2, M6)", () => {
  const CO2 = { region: "US-CO", cities: ["Denver"] };

  it("potato farm maps to exactly the potato crop and wholesaler codes", async () => {
    const r = await mapQuery("potato farm", null, CO2);
    expect(r.intent.naics).toEqual(["111211", "424480"]);
  });

  it("produce supplier prefers the produce wholesaler, then vegetable and fruit farms", async () => {
    const r = await mapQuery("produce supplier", null, CO2);
    expect(r.intent.naics).toEqual(["424480", "1112", "1113", "445230"]);
  });

  it("sell detection does not fire on 'sells' alone", async () => {
    expect((await mapQuery("a store that sells fabric near Denver", null, CO2)).intent.direction).toBe("buy");
    expect((await mapQuery("who would buy my hot sauce", null, CO2)).intent.direction).toBe("sell");
    expect((await mapQuery("restaurants that buy produce", null, CO2)).intent.direction).toBe("sell");
    expect((await mapQuery("I make candles, find me buyers", null, CO2)).intent.direction).toBe("sell");
  });
});

describe("mapQuery — fixed direction (7a)", () => {
  function capturingLlm(response: string) {
    const prompts: string[] = [];
    const backend: RawLlm = { complete: async (prompt: string) => { prompts.push(prompt); return response; } };
    return { llm: createLlm({ backend }), prompts };
  }

  it("fixed buy overrides a sell-sounding request on the static path", async () => {
    const r = await mapQuery("who would buy my hot sauce", null, { ...CO, direction: "buy" });
    expect(r.intent.direction).toBe("buy");
    expect(r.directionFixed).toBe(true);
    expect(r.caveats.some(c => c.includes("never what it currently buys"))).toBe(false);
    expect(r.intent.naics).toContain("311941");
  });

  it("fixed sell without an LLM returns no codes and the sell + needs-LLM caveats", async () => {
    const r = await mapQuery("produce supplier", null, { ...CO, direction: "sell" });
    expect(r.intent.direction).toBe("sell");
    expect(r.directionFixed).toBe(true);
    expect(r.intent.naics).toEqual([]);
    expect(r.caveats.some(c => c.includes("never what it currently buys"))).toBe(true);
    expect(r.caveats.some(c => c.includes("finding buyers needs the AI step"))).toBe(true);
  });

  it("fixed direction wins over the model's and is told to the model", async () => {
    const { llm, prompts } = capturingLlm('{"direction":"buy","naics":["311941"],"keywords":["sauce"],"cities":[],"caveats":[]}');
    const r = await mapQuery("hot sauce", llm, { ...CO, direction: "sell" });
    expect(r.intent.direction).toBe("sell");
    expect(r.directionFixed).toBe(true);
    expect(r.caveats.some(c => c.includes("never what it currently buys"))).toBe(true);
    expect(prompts[0]).toContain("Direction (fixed by the user): sell");
  });

  it("auto: directionFixed is false and the prompt has no fixed-direction line", async () => {
    const { llm, prompts } = capturingLlm('{"direction":"buy","naics":["311941"],"keywords":["sauce"],"cities":[],"caveats":[]}');
    const r = await mapQuery("hot sauce", llm, CO);
    expect(r.directionFixed).toBe(false);
    expect(prompts[0]).not.toContain("Direction (fixed");
  });
});

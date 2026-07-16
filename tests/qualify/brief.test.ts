import { describe, it, expect } from "vitest";
import { briefLeads, rankEntities, parseBriefResponse, templateBrief } from "../../packages/qualify/src/verbs/brief.js";
import { createLlm, type RawLlm, type RawCompleteOptions } from "../../packages/qualify/src/llm/adapter.js";
import type { Entity } from "../../packages/registry-core/src/entity.js";
import type { MapResult } from "../../packages/qualify/src/verbs/map.js";
import type { ProbeResult } from "../../packages/qualify/src/verbs/probe.js";

function entity(overrides: Partial<Entity>): Entity {
  return {
    id: "co_sos:1", name: "Acme LLC", names: [], status: "Good Standing",
    address: { city: "Denver" }, officers: [], categories: [], contacts: [],
    source_ids: ["co_sos"], evidence: [], ...overrides,
  };
}

function probeResult(id: string, overrides: Partial<ProbeResult> = {}): ProbeResult {
  return { entityId: id, domain: null, a: false, mx: false, emailGuess: null, published: false, tried: [], ...overrides };
}

const MAP: MapResult = {
  intent: { categories: ["produce"], geo: { region: "US-CO", cities: [] }, direction: "buy" },
  keywords: ["potato"],
  caveats: ['"yukon gold" is not verifiable from registry data — leads match the category, not this specific detail'],
  usedLlm: false,
};

describe("rankEntities", () => {
  it("multi-plane joins with contacts outrank single-source name matches", () => {
    const strong = entity({ id: "x:1", name: "Strong", source_ids: ["co_sos", "paca"], contacts: ["a@b.com"], categories: ["produce"] });
    const weak = entity({ id: "x:2", name: "Weak" });
    const probes = new Map([["x:1", probeResult("x:1", { mx: true })]]);
    const ranked = rankEntities([weak, strong], probes);
    expect(ranked[0]!.entity.id).toBe("x:1");
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });
});

describe("briefLeads", () => {
  it("makes exactly ONE batched call and applies parsed briefs", async () => {
    let calls = 0;
    let seen: { prompt: string; opts: RawCompleteOptions } | null = null;
    const backend: RawLlm = {
      complete: async (prompt, opts) => {
        calls++;
        seen = { prompt, opts };
        return '[{"i":0,"brief":"Best lead — produce-licensed, yukon gold stock is proxy-inferred."},{"i":1,"brief":"Second."}]';
      },
    };
    const llm = createLlm({ backend });
    const leads = await briefLeads(
      [entity({ id: "a", name: "Alpha Produce", source_ids: ["co_sos", "paca"] }), entity({ id: "b", name: "Beta" })],
      new Map(), MAP, llm
    );
    expect(calls).toBe(1);
    expect(leads[0]!.brief).toContain("Best lead");
    expect(leads[1]!.brief).toBe("Second.");
    // the one call is best-tier and carries the caveats
    expect(seen!.opts.model).toContain("sonnet");
    expect(seen!.prompt).toContain("yukon gold");
  });

  it("keeps zero-token template briefs when the model returns garbage", async () => {
    const backend: RawLlm = { complete: async () => "sorry, as an AI..." };
    const leads = await briefLeads([entity({ id: "a", name: "Alpha", contacts: ["x@alpha.com"] })], new Map(), MAP, createLlm({ backend }));
    expect(leads[0]!.brief).toContain("Alpha");
    expect(leads[0]!.brief).toContain("Caveat");
  });

  it("makes zero calls with no leads and works with llm=null", async () => {
    let calls = 0;
    const backend: RawLlm = { complete: async () => { calls++; return "[]"; } };
    expect(await briefLeads([], new Map(), MAP, createLlm({ backend }))).toEqual([]);
    expect(calls).toBe(0);
    const leads = await briefLeads([entity({ id: "a" })], new Map(), MAP, null);
    expect(leads[0]!.brief.length).toBeGreaterThan(0);
  });

  it("caps the number of briefed leads", async () => {
    const many = Array.from({ length: 30 }, (_, i) => entity({ id: `e${i}`, name: `E${i}` }));
    const leads = await briefLeads(many, new Map(), MAP, null, { maxLeads: 5 });
    expect(leads).toHaveLength(5);
  });
});

describe("parseBriefResponse hardening", () => {
  it("parses fenced arrays and ignores malformed items", () => {
    const m = parseBriefResponse('```json\n[{"i":0,"brief":"ok"},{"i":"x","brief":"bad"},{"i":2,"brief":""}]\n```');
    expect(m.get(0)).toBe("ok");
    expect(m.size).toBe(1);
  });

  it("returns empty map on non-JSON", () => {
    expect(parseBriefResponse("no json here").size).toBe(0);
  });
});

describe("templateBrief", () => {
  it("carries category, sources, contacts and caveats", () => {
    const lead = { entity: entity({ categories: ["produce"], source_ids: ["co_sos", "paca"], contacts: ["info@x.com"] }), score: 0, probe: undefined, brief: "" };
    const text = templateBrief(lead, MAP);
    expect(text).toContain("produce");
    expect(text).toContain("co_sos + paca");
    expect(text).toContain("info@x.com");
    expect(text).toContain("yukon gold");
  });
});

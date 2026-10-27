import { describe, it, expect } from "vitest";
import type { Driver, DriverRegistry, Entity, RecentRequest, SourceSpec } from "../../packages/registry-core/src/index.js";
import { search, type EngineEvent, type SearchConfig } from "../../packages/qualify/src/engine.js";
import { memoryContactCache } from "../../packages/qualify/src/verbs/contacts.js";

// Recently registered filings over stub drivers: no network, no LLM.

const SOURCES: SourceSpec[] = [
  {
    id: "co_sos", name: "Colorado SoS", plane: "existence", driver: "socrata",
    coverage: { geo: ["US-CO"], naics: ["*"] }, endpoint: "https://x",
    fields: { id: "entityid", name: "entityname", formedDate: "entityformdate" },
    quirks: { datasetId: "x", cities: ["Denver", "Pueblo"] },
  },
];

function ent(id: string, name: string, address: Entity["address"], formedDate: string): Entity {
  return {
    id: `co_sos:${id}`, name, names: [], status: "Good Standing", address, officers: [], naics: [],
    contacts: [], source_ids: ["co_sos"], evidence: [{ source: "co_sos", field: "entityname", value: name, note: 'matched "taco"' }],
    formedDate,
  };
}

const RECENT = [
  ent("1", "OLDER TACO LLC", { city: "Denver", zip: "80202" }, "2026-08-01"),
  ent("2", "PUEBLO TACO LLC", { city: "Pueblo", zip: "81001" }, "2026-10-01"),
  ent("3", "NEWER TACO LLC", { city: "Denver", zip: "80204" }, "2026-10-15"),
];

function drivers(sinces: RecentRequest[], fail = false): DriverRegistry {
  const socrata: Driver = {
    kind: "socrata",
    fetch: async () => [],
    fetchRecent: async (_s, req) => {
      sinces.push(req);
      if (fail) throw new Error("boom");
      return structuredClone(RECENT);
    },
  };
  return { socrata };
}

const base: SearchConfig = {
  sources: SOURCES, region: "US-CO", naics: ["722513"], probeLimit: 0, contacts: null, contactCache: memoryContactCache(),
  now: new Date("2026-10-27T12:00:00Z"),
};

describe("engine — recently registered", () => {
  it("keeps in-radius name matches formed in the last 90 days, newest first, without touching the LLM budget", async () => {
    const reqs: RecentRequest[] = [];
    const events: EngineEvent[] = [];
    const out = await search("taco restaurant near denver", { ...base, drivers: drivers(reqs), onEvent: e => events.push(e) });
    expect(reqs).toHaveLength(1);
    expect(reqs[0]!.since).toBe("2026-07-29");
    expect(reqs[0]!.keywords.length).toBeGreaterThan(0);
    expect(out.recent.map(l => l.entity.name)).toEqual(["NEWER TACO LLC", "OLDER TACO LLC"]);
    expect(out.recentWindow).toEqual({ days: 90, radiusMi: 25 });
    expect(events.find(e => e.type === "recent")).toEqual({ type: "recent", count: 2 });
    expect(out.llmCalls).toBe(0);
    expect(out.recent.every(l => l.brief === "" && l.opener === "")).toBe(true);
  });

  it("a wider radius keeps Pueblo", async () => {
    const out = await search("taco restaurant near denver", { ...base, drivers: drivers([]), radiusMi: 150 });
    expect(out.recent.map(l => l.entity.name)).toEqual(["NEWER TACO LLC", "PUEBLO TACO LLC", "OLDER TACO LLC"]);
    expect(out.recentWindow).toEqual({ days: 90, radiusMi: 150 });
  });

  it("does not run without an origin", async () => {
    const reqs: RecentRequest[] = [];
    const out = await search("taco restaurant in colorado", { ...base, drivers: drivers(reqs) });
    expect(out.origin).toBeNull();
    expect(reqs).toHaveLength(0);
    expect(out.recent).toEqual([]);
    expect(out.recentWindow).toBeNull();
  });

  it("a failing fetchRecent emits source_error and the search still completes", async () => {
    const events: EngineEvent[] = [];
    const out = await search("taco restaurant near denver", { ...base, drivers: drivers([], true), onEvent: e => events.push(e) });
    const err = events.find(e => e.type === "source_error");
    expect(err).toMatchObject({ type: "source_error", sourceId: "co_sos" });
    expect((err as { message: string }).message.startsWith("recent filings: ")).toBe(true);
    expect(out.recent).toEqual([]);
    expect(events.some(e => e.type === "done")).toBe(true);
  });
});

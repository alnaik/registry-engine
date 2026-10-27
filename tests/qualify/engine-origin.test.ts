import { describe, it, expect } from "vitest";
import type { Driver, DriverRegistry, Entity, FetchRequest, SourceSpec } from "../../packages/registry-core/src/index.js";
import { search, type EngineEvent, type SearchConfig } from "../../packages/qualify/src/engine.js";
import { memoryContactCache, type WebSearchProvider } from "../../packages/qualify/src/verbs/contacts.js";

// Origin + distance bands over stub drivers: no network, no cache on disk.

const SOURCES: SourceSpec[] = [
  {
    id: "ppp", name: "SBA PPP loan records", plane: "category", driver: "static_shard",
    coverage: { geo: ["US"], naics: ["*"] }, endpoint: "repo:tests/fixtures/shards/none", fields: {},
    quirks: { cities: ["Denver", "Boulder"] },
  },
];

function ent(id: string, name: string, address: Entity["address"], over: Partial<Entity> = {}): Entity {
  return {
    id: `ppp:${id}`, name, names: [], status: "", address, officers: [], naics: ["332312"],
    contacts: [], source_ids: ["ppp"], evidence: [{ source: "ppp", field: "registry", value: "ppp" }], ...over,
  };
}

const ROWS = [
  ent("1", "FAR METAL (PUEBLO)", { city: "Pueblo", zip: "81001" }, { employees: 50 }),     // ~100+ mi
  ent("2", "NEAR METAL A", { city: "Denver", zip: "80202" }, { employees: 5 }),             // < 10 mi
  ent("3", "NEAR METAL B", { city: "Denver", zip: "80204" }, { employees: 9 }),             // < 10 mi
  ent("4", "BOULDER METAL", { city: "Boulder", zip: "80301" }),                             // 25-50 mi
  ent("7", "ARVADA METAL", { city: "Arvada", zip: "80002" }),                               // 10-25 mi
  ent("5", "NOWHERE METAL", { city: "Atlantis" }),                                          // unknown
  ent("6", "COLORADO SPRINGS METAL", { city: "Colorado Springs", zip: "80903" }),           // 50-100 mi
];

function drivers(seen: FetchRequest[]): DriverRegistry {
  const shard: Driver = { kind: "static_shard", fetch: async (_s, req) => { seen.push(req); return structuredClone(ROWS); } };
  return { static_shard: shard };
}

const base: SearchConfig = { sources: SOURCES, region: "US-CO", naics: ["332312"], probeLimit: 0, contacts: null, contactCache: memoryContactCache() };

describe("engine — origin and distance bands", () => {
  it("a city in the query becomes the origin: drivers get the whole region, leads are banded nearest first", async () => {
    const seen: FetchRequest[] = [];
    const events: EngineEvent[] = [];
    const out = await search("metal fabrication near denver", { ...base, drivers: drivers(seen), onEvent: e => events.push(e) });

    expect(out.map.intent.geo.cities).toEqual(["Denver"]);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.cities).toEqual([]);

    expect(out.origin).toMatchObject({ label: "Denver, CO" });
    expect(events.find(e => e.type === "origin")).toEqual({ type: "origin", origin: out.origin });
    expect(events.findIndex(e => e.type === "origin")).toBe(events.findIndex(e => e.type === "map") + 1);

    expect(out.ranked.map(l => l.entity.name)).toEqual([
      "NEAR METAL A", "NEAR METAL B", "ARVADA METAL", "BOULDER METAL", "COLORADO SPRINGS METAL", "FAR METAL (PUEBLO)", "NOWHERE METAL",
    ]);
    expect(out.ranked.map(l => l.band)).toEqual([
      "within 10 mi", "within 10 mi", "10–25 mi", "25–50 mi", "50–100 mi", "100+ mi", "distance unknown",
    ]);
    const nowhere = out.ranked.find(l => l.entity.name === "NOWHERE METAL")!;
    expect(nowhere.distanceMi).toBeNull();
    for (const l of out.ranked.filter(l => l.distanceMi !== null)) {
      expect(Math.round(l.distanceMi! * 10)).toBe(l.distanceMi! * 10);
    }
    // equal score, B has more jobs, but A is closer: distance decides before headcount
    const [first, second] = out.ranked;
    expect(first!.score).toBe(second!.score);
    expect(first!.distanceMi!).toBeLessThanOrEqual(second!.distanceMi!);
  });

  it("--near overrides the query city", async () => {
    const out = await search("metal fabrication near denver", { ...base, drivers: drivers([]), near: "80301" });
    expect(out.origin?.label).toBe("ZIP 80301");
    expect(out.ranked[0]!.entity.name).toBe("BOULDER METAL");
    expect(out.ranked[0]!.band).toBe("within 10 mi");
  });

  it("radiusMi drops farther leads and, with an origin, leads with unknown distance", async () => {
    const out = await search("metal fabrication near denver", { ...base, drivers: drivers([]), radiusMi: 30 });
    expect(out.ranked.map(l => l.entity.name)).toEqual(["NEAR METAL A", "NEAR METAL B", "ARVADA METAL", "BOULDER METAL"]);
  });

  it("no origin: city filtering stays, no bands, the old ordering, radius ignored", async () => {
    const seen: FetchRequest[] = [];
    const out = await search("metal fabrication in colorado", { ...base, drivers: drivers(seen), radiusMi: 5 });
    expect(out.origin).toBeNull();
    expect(out.map.intent.geo.cities).toEqual([]);
    expect(out.ranked).toHaveLength(ROWS.length);
    expect(out.ranked.every(l => l.band === "" && l.distanceMi === null)).toBe(true);
    // score ties fall to employees desc, then name
    expect(out.ranked[0]!.entity.name).toBe("FAR METAL (PUEBLO)");
  });

  it("an unresolvable city leaves the origin null and keeps the city filter", async () => {
    const seen: FetchRequest[] = [];
    const sources: SourceSpec[] = [{ ...SOURCES[0]!, quirks: { cities: ["Mocktown"] } }];
    const out = await search("metal fabrication in mocktown", { ...base, sources, drivers: drivers(seen) });
    expect(out.origin).toBeNull();
    expect(seen[0]!.cities).toEqual(["Mocktown"]);
  });

  it("web contact lookup runs on the final ranked leads after the radius filter and never changes the order", async () => {
    const queries: string[] = [];
    const provider: WebSearchProvider = {
      name: "stub",
      search: async query => { queries.push(query); return { results: [], costDollars: 0.01 }; },
    };
    const events: EngineEvent[] = [];
    const out = await search("metal fabrication near denver", {
      ...base, drivers: drivers([]), contacts: provider, radiusMi: 30, maxLeads: 2, onEvent: e => events.push(e),
    });
    expect(queries).toHaveLength(2);
    expect(queries[0]).toContain("NEAR METAL A");
    expect(out.contactLookups).toEqual({ provider: "stub", looked: 2, found: 0, costDollars: 0.02 });
    expect(events.find(e => e.type === "contacts")).toMatchObject({ type: "contacts", provider: "stub", looked: 2 });
    expect(out.ranked[0]!.found?.status).toBe("not-found");
    expect(out.ranked[2]!.found).toBeUndefined();
  });
});

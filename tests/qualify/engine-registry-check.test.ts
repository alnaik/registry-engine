import { describe, it, expect, vi, afterEach } from "vitest";
import { loadManifest } from "../../packages/registry-core/src/manifest.js";
import { SocrataDriver } from "../../packages/registry-core/src/drivers/socrata.js";
import { StaticShardDriver } from "../../packages/registry-core/src/drivers/staticShard.js";
import { search, planBackfill } from "../../packages/qualify/src/engine.js";
import type { Entity } from "../../packages/registry-core/src/entity.js";

// Tri-state registry standing (v6 Phase A): a lead is "matched" only when it
// joined a registry record, "checked_not_found" only when its name was really
// sent to the registry lookup, and "not_checked" otherwise. Capped fetches
// say so on the fetched event.

const MANIFEST = {
  sources: [
    {
      id: "xx_sos", name: "Mockland Secretary of State", plane: "existence", driver: "socrata",
      coverage: { geo: ["US-XX"], naics: ["*"] }, endpoint: "https://data.example.gov/resource",
      fields: { id: "biz_number", name: "biz_legal_name", status: "standing", city: "office_city" },
      quirks: { datasetId: "zzzz-9999", statusValue: "ACTIVE" },
    },
    {
      id: "xx_cat", name: "Mockland Produce Shard", plane: "category", driver: "static_shard",
      coverage: { geo: ["US-XX"], naics: ["4244"] }, endpoint: "https://shards.example/xx_cat",
      fields: { id: "biz_id", name: "biz_name", status: "biz_status", city: "biz_city", naics: "naics" },
      quirks: { shardRegions: ["US-XX"] },
    },
  ],
};

// Ranked by name (same score): ALPHA, BRAVO, CHARLIE, DELTA.
const SHARD = [
  { biz_id: "1", biz_name: "ALPHA PRODUCE LLC", biz_status: "ACTIVE", biz_city: "MOCKTOWN", naics: "424480" },
  { biz_id: "2", biz_name: "BRAVO PRODUCE LLC", biz_status: "ACTIVE", biz_city: "MOCKTOWN", naics: "424480" },
  { biz_id: "3", biz_name: "CHARLIE PRODUCE LLC", biz_status: "ACTIVE", biz_city: "MOCKTOWN", naics: "424480" },
  { biz_id: "4", biz_name: "DELTA PRODUCE LLC", biz_status: "ACTIVE", biz_city: "MOCKTOWN", naics: "424480" },
];
// ALPHA joins; BRAVO exists but in another town (not joined).
const REGISTRY = [
  { biz_number: "77", biz_legal_name: "ALPHA PRODUCE, LLC", standing: "ACTIVE", office_city: "MOCKTOWN" },
  { biz_number: "78", biz_legal_name: "BRAVO PRODUCE LLC", standing: "ACTIVE", office_city: "FARAWAY" },
];

let sent: string[] = [];
afterEach(() => vi.unstubAllGlobals());

function stubFetch(failRegistry = false): void {
  sent = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("shards.example/xx_cat/US-XX.json")) {
      return { ok: true, status: 200, json: async () => ({ records: SHARD }) } as unknown as Response;
    }
    if (url.includes("data.example.gov/resource")) {
      if (failRegistry) return { ok: false, status: 400, json: async () => ({}) } as unknown as Response;
      const where = decodeURIComponent(url.split("$where=")[1]!.split("&")[0]!);
      sent.push(where);
      const rows = REGISTRY.filter(r => where.includes(`%${r.biz_legal_name.split(/[^A-Z]+/)[0]}%`));
      return { ok: true, status: 200, json: async () => rows } as unknown as Response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch);
}

class CappedSocrata extends SocrataDriver {
  override readonly maxBackfillNames = 2;
}

describe("engine — tri-state registry check", () => {
  it("matched / checked_not_found / not_checked follow what was really sent", async () => {
    stubFetch();
    const events: { type: string; [k: string]: unknown }[] = [];
    const out = await search("produce suppliers", {
      sources: loadManifest(MANIFEST), region: "US-XX", naics: ["4244"],
      drivers: { socrata: new CappedSocrata(), static_shard: new StaticShardDriver() },
      contacts: null,
      onEvent: e => events.push(e as { type: string; [k: string]: unknown }),
    });
    const by = (n: string) => out.ranked.find(l => l.entity.name.startsWith(n))!;
    expect(by("ALPHA").registryCheck).toBe("matched");
    expect(by("BRAVO").registryCheck).toBe("checked_not_found");
    expect(by("BRAVO").registeredElsewhere).toBe(true);
    expect(by("CHARLIE").registryCheck).toBe("not_checked");
    expect(by("DELTA").registryCheck).toBe("not_checked");
    expect(out.registryLookup).toEqual({ status: "ran", namesChecked: 2, nameCap: 2, candidates: 4 });
    // the probe's evidence note doesn't claim a not-checked lead was "not found"
    const charlie = by("CHARLIE").entity.evidence.find(ev => ev.field === "existence");
    expect(charlie?.note).toContain("not checked against xx_sos");
    expect(by("BRAVO").entity.evidence.find(ev => ev.field === "existence")?.note).toContain("not found in xx_sos");
    expect(sent.join(" ")).not.toContain("CHARLIE");
    // the static shard has no cap, so it is never "capped"
    expect(events.find(e => e.type === "fetched" && e["sourceId"] === "xx_cat")).toMatchObject({ capped: false, count: 4 });
  });

  it("a failed registry lookup leaves every unmatched lead not_checked", async () => {
    stubFetch(true);
    const out = await search("produce suppliers", {
      sources: loadManifest(MANIFEST), region: "US-XX", naics: ["4244"], contacts: null,
      fetchOpts: { maxRetries: 0 },
    });
    expect(out.registryLookup.status).toBe("failed");
    expect(out.ranked.every(l => l.registryCheck === "not_checked")).toBe(true);
  });

  it("a fetch that returns exactly its row cap is flagged capped", async () => {
    stubFetch();
    const events: { type: string; [k: string]: unknown }[] = [];
    await search("produce suppliers", {
      sources: loadManifest(MANIFEST), region: "US-XX", naics: ["4244"], contacts: null, limit: 4,
      onEvent: e => events.push(e as { type: string; [k: string]: unknown }),
    });
    expect(events.find(e => e.type === "fetched" && e["sourceId"] === "xx_cat")).toMatchObject({ capped: true, count: 4 });
  });
});

describe("planBackfill", () => {
  const ent = (name: string, names: string[] = []): Entity => ({
    id: name, name, names, status: "", address: {}, officers: [], naics: [], contacts: [], source_ids: ["x"], evidence: [],
  });
  it("replicates the driver's dedupe-and-cap and skips names with no key", () => {
    const driver = new CappedSocrata();
    const plan = planBackfill([ent("AB"), ent("ALPHA PRODUCE LLC", ["ALPHA PRODUCE"]), ent("BRAVO CO"), ent("CHARLIE CO")], driver);
    // "AB" has no usable pattern; ALPHA's aka shares its key; cap 2 stops CHARLIE
    expect(plan.checked.map(e => e.name)).toEqual(["ALPHA PRODUCE LLC", "BRAVO CO"]);
    expect(plan.keyCount).toBe(2);
    expect(plan.names).toEqual(["ALPHA PRODUCE LLC", "ALPHA PRODUCE", "BRAVO CO"]);
  });
});

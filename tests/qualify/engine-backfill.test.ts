import { describe, it, expect, vi, afterEach } from "vitest";
import { loadManifest } from "../../packages/registry-core/src/manifest.js";
import { search, type EngineEvent } from "../../packages/qualify/src/engine.js";
import { SocrataDriver } from "../../packages/registry-core/src/drivers/socrata.js";
import { StaticShardDriver } from "../../packages/registry-core/src/drivers/staticShard.js";
import type { SourceSpec, FetchByNamesExtra } from "../../packages/registry-core/src/driver.js";
import type { Entity } from "../../packages/registry-core/src/entity.js";
import type { FetchRetryOptions } from "../../packages/registry-core/src/util/http.js";

// Fictional US-XX manifest, modeled on engine-region.test.ts: proves the
// existence-backfill pass (ADR 0013) end-to-end through the real search() —
// a category-plane entity whose legal name carries no search keyword still
// joins the existence plane via a targeted name lookup, and leads without a
// published domain get a web-search link instead of a DNS-guessed one.

const MOCKLAND_MANIFEST = {
  sources: [
    {
      id: "xx_sos",
      name: "Mockland Secretary of State",
      plane: "existence",
      driver: "socrata",
      coverage: { geo: ["US-XX"], naics: ["*"] },
      endpoint: "https://data.example.gov/resource",
      fields: {
        id: "biz_number",
        name: "biz_legal_name",
        status: "standing",
        city: "office_city",
      },
      quirks: { datasetId: "zzzz-9999", statusValue: "ACTIVE" },
    },
    {
      id: "xx_cat",
      name: "Mockland Produce Category Shard",
      plane: "category",
      driver: "static_shard",
      coverage: { geo: ["US-XX"], naics: ["4244"] },
      endpoint: "https://shards.example/xx_cat",
      fields: {
        id: "biz_id",
        name: "biz_name",
        status: "biz_status",
        city: "biz_city",
      },
      quirks: { shardRegions: ["US-XX"] },
    },
  ],
};

const SHARD_RECORDS = [
  { biz_id: "1", biz_name: "MOCK TRADING LLC", biz_status: "ACTIVE", biz_city: "MOCKTOWN" },
  { biz_id: "2", biz_name: "GHOST VENTURES LLC", biz_status: "ACTIVE", biz_city: "MOCKTOWN" },
];

const BACKFILL_ROW = {
  biz_number: "77",
  biz_legal_name: "MOCK TRADING, LLC",
  standing: "ACTIVE",
  office_city: "MOCKTOWN",
};

afterEach(() => vi.unstubAllGlobals());

function stubFetch(): void {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("cloudflare-dns.com")) {
      throw new Error(`unexpected DNS-over-HTTPS request: ${url}`);
    }
    if (url.includes("shards.example/xx_cat/US-XX.json")) {
      return {
        ok: true, status: 200,
        json: async () => ({ records: SHARD_RECORDS }),
      } as unknown as Response;
    }
    if (url.includes("data.example.gov/resource")) {
      const where = decodeURIComponent(url.split("$where=")[1]!.split("&")[0]!);
      const rows = where.includes("%MOCK%TRADING%") ? [BACKFILL_ROW] : [];
      return { ok: true, status: 200, json: async () => rows } as unknown as Response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch);
}

describe("engine — existence backfill by name, zero-token path", () => {
  it("joins a category-plane entity with no keyword-matching legal name via fetchByNames, and gives both leads a search URL", async () => {
    const sources = loadManifest(MOCKLAND_MANIFEST);
    stubFetch();

    const events: { type: string; [k: string]: unknown }[] = [];
    const out = await search("produce suppliers in mocktown", {
      sources,
      region: "US-XX",
      probeLimit: 25,
      onEvent: e => events.push(e as { type: string; [k: string]: unknown }),
    });

    const backfilled = events.find(e => e.type === "backfilled");
    expect(backfilled).toEqual({ type: "backfilled", sourceId: "xx_sos", count: 1 });

    const mock = out.entities.find(e => e.source_ids.includes("xx_sos"));
    expect(mock).toBeDefined();
    expect(mock!.source_ids).toEqual(expect.arrayContaining(["xx_sos", "xx_cat"]));
    expect(mock!.name).toBe("MOCK TRADING, LLC");
    expect(mock!.evidence.some(ev => ev.note?.startsWith("not found in xx_sos"))).toBe(false);

    const ghost = out.entities.find(e => e.name === "GHOST VENTURES LLC");
    expect(ghost).toBeDefined();
    expect(ghost!.source_ids).toEqual(["xx_cat"]);
    expect(ghost!.evidence.some(ev => ev.note?.startsWith("not found in xx_sos"))).toBe(true);

    expect(out.leads.length).toBeGreaterThan(0);
    for (const lead of out.leads) {
      expect(lead.searchUrl).not.toBeNull();
      expect(lead.searchUrl).toContain("duckduckgo.com");
    }

    expect(out.llmCalls).toBe(0);
  });
});

// v7b H2: the default run caps the names sent; "check all" (backfillAll)
// sends every coded lead's name, uncapped, and reports progress per chunk.
describe("engine — check all names against the registry", () => {
  const MANIFEST = {
    sources: [
      MOCKLAND_MANIFEST.sources[0]!,
      {
        ...MOCKLAND_MANIFEST.sources[1]!,
        fields: { ...MOCKLAND_MANIFEST.sources[1]!.fields, naics: "naics" },
      },
    ],
  };
  const words = ["ALPHA", "BRAVO", "CHARLIE", "DELTA", "ECHO", "FOXTROT", "GOLF", "HOTEL", "INDIA", "JULIET", "KILO", "LIMA", "MIKE", "NOVEMBER"];
  // 196 distinct name patterns, all coded 424480.
  const RECORDS = words.flatMap((a, i) => words.map((b, j) => ({
    biz_id: `${i}-${j}`, biz_name: `${a} ${b} PRODUCE LLC`, biz_status: "ACTIVE", biz_city: "MOCKTOWN", naics: "424480",
  })));

  class RecordingSocrata extends SocrataDriver {
    calls: { names: string[]; extra: FetchByNamesExtra | undefined }[] = [];
    override async fetchByNames(source: SourceSpec, names: string[], opts?: FetchRetryOptions, extra?: FetchByNamesExtra): Promise<Entity[]> {
      this.calls.push({ names, extra });
      return super.fetchByNames(source, names, opts, extra);
    }
  }

  function stub(): void {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("shards.example/xx_cat/US-XX.json")) {
        return { ok: true, status: 200, json: async () => ({ records: RECORDS }) } as unknown as Response;
      }
      if (url.includes("data.example.gov/resource")) {
        return { ok: true, status: 200, json: async () => [] } as unknown as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch);
  }

  async function run(backfillAll: boolean) {
    stub();
    const driver = new RecordingSocrata();
    const events: EngineEvent[] = [];
    const out = await search("produce suppliers", {
      sources: loadManifest(MANIFEST), region: "US-XX", naics: ["4244"], contacts: null, probeLimit: 0,
      drivers: { socrata: driver, static_shard: new StaticShardDriver() },
      backfillAll,
      onEvent: e => events.push(e),
    });
    const progress = events.filter((e): e is Extract<EngineEvent, { type: "backfill_progress" }> => e.type === "backfill_progress");
    return { out, driver, progress };
  }

  it("a default run is capped: maxNames undefined, at most 150 names, 80 checked of all 196", async () => {
    const { out, driver, progress } = await run(false);
    expect(driver.calls).toHaveLength(1);
    expect(driver.calls[0]!.extra?.maxNames).toBeUndefined();
    expect(typeof driver.calls[0]!.extra?.onProgress).toBe("function");
    expect(driver.calls[0]!.names.length).toBeLessThanOrEqual(150);
    expect(out.registryLookup).toMatchObject({ status: "ran", namesChecked: 80, nameCap: 80, totalNames: 196 });
    // progress is reported on every run, over the capped pattern count
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.every(p => p.total === 80 && p.sourceId === "xx_sos")).toBe(true);
    expect(progress[progress.length - 1]!.checked).toBe(80);
  });

  it("backfillAll sends every coded name with maxNames Infinity, and progress climbs to the total", async () => {
    const { out, driver, progress } = await run(true);
    expect(driver.calls).toHaveLength(1);
    expect(driver.calls[0]!.extra?.maxNames).toBe(Infinity);
    expect(driver.calls[0]!.names).toHaveLength(196);
    expect(out.registryLookup).toMatchObject({ status: "ran", namesChecked: 196, nameCap: null, totalNames: 196 });
    // one event per 25-name chunk, in order, each with the full total
    expect(progress).toHaveLength(Math.ceil(196 / 25));
    expect(progress.every(p => p.total === 196)).toBe(true);
    const checked = progress.map(p => p.checked);
    expect(checked).toEqual([...checked].sort((a, b) => a - b));
    expect(checked[checked.length - 1]).toBe(196);
    // every coded lead was checked: none is left "not_checked"
    expect(out.ranked.every(l => l.registryCheck !== "not_checked")).toBe(true);
  });
});

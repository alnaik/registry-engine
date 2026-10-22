import { describe, it, expect, vi, afterEach } from "vitest";
import { loadManifest } from "../../packages/registry-core/src/manifest.js";
import { search } from "../../packages/qualify/src/engine.js";

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
    expect(mock!.evidence.some(ev => ev.note?.startsWith("no xx_sos match"))).toBe(false);

    const ghost = out.entities.find(e => e.name === "GHOST VENTURES LLC");
    expect(ghost).toBeDefined();
    expect(ghost!.source_ids).toEqual(["xx_cat"]);
    expect(ghost!.evidence.some(ev => ev.note?.startsWith("no xx_sos match"))).toBe(true);

    expect(out.leads.length).toBeGreaterThan(0);
    for (const lead of out.leads) {
      expect(lead.searchUrl).not.toBeNull();
      expect(lead.searchUrl).toContain("duckduckgo.com");
    }

    expect(out.llmCalls).toBe(0);
  });
});

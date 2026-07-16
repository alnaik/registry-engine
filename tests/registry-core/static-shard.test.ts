import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { StaticShardDriver } from "../../packages/registry-core/src/drivers/staticShard.js";
import type { SourceSpec, FetchRequest } from "../../packages/registry-core/src/driver.js";

const shard = JSON.parse(
  readFileSync(join(import.meta.dirname, "../fixtures/paca-us-co-shard.json"), "utf-8")
) as { records: Record<string, unknown>[] };

const PACA: SourceSpec = {
  id: "paca",
  name: "USDA PACA produce license registry",
  plane: "category",
  driver: "static_shard",
  coverage: { geo: ["US"], categories: ["produce"] },
  endpoint: "https://example.com/shards/paca",
  fields: {
    id: "license_number", name: "name_of_business", status: "license_status",
    city: "physical_city", state: "physical_state", zip: "physical_zip_code",
  },
  contact_fields: ["telephone_number", "email_address", "website"],
  quirks: {
    statusValue: "Active",
    namesField: "trade_names",
    officersField: "principals",
    shardRegions: ["US-CO"],
  },
};

function req(overrides: Partial<FetchRequest> = {}): FetchRequest {
  return { keywords: [], region: "US-CO", cities: [], categories: ["produce"], ...overrides };
}

function stubShardFetch() {
  const fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => shard,
  }) as unknown as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("StaticShardDriver", () => {
  const driver = new StaticShardDriver();

  it("fetches <endpoint>/<region>.json", async () => {
    const fetchMock = stubShardFetch();
    await driver.fetch(PACA, req());
    expect(fetchMock).toHaveBeenCalledWith("https://example.com/shards/paca/US-CO.json", expect.anything());
  });

  it("returns [] without any request for regions with no shard", async () => {
    const fetchMock = stubShardFetch();
    expect(await driver.fetch(PACA, req({ region: "US-WA" }))).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps only Active records and maps contacts, officers, aliases, category", async () => {
    stubShardFetch();
    const results = await driver.fetch(PACA, req());
    expect(results.length).toBe(shard.records.filter(r => r["license_status"] === "Active").length);
    expect(results.some(e => e.name === "GONE BUST PRODUCE INC")).toBe(false);

    const leevers = results.find(e => e.name.startsWith("LEEVERS"));
    expect(leevers).toBeDefined();
    expect(leevers!.categories).toEqual(["produce"]);
    expect(leevers!.contacts.some(c => c.includes("@"))).toBe(true);
    expect(leevers!.officers.length).toBeGreaterThan(0);
    expect(leevers!.id).toMatch(/^paca:\d+$/);
    expect(leevers!.evidence.some(ev => ev.field === "registry" && ev.note === "licensed: produce")).toBe(true);
  });

  it("filters by city but keeps non-keyword category members", async () => {
    stubShardFetch();
    const monteVista = await driver.fetch(PACA, req({ cities: ["Monte Vista"] }));
    expect(monteVista.length).toBeGreaterThan(0);
    expect(monteVista.every(e => e.address.city?.toUpperCase().includes("MONTE VISTA"))).toBe(true);

    // Keywords annotate evidence but do not exclude category members.
    const all = await driver.fetch(PACA, req());
    const withKw = await driver.fetch(PACA, req({ keywords: ["potato"] }));
    expect(withKw.length).toBe(all.length);
    const hit = withKw.find(e => e.name.includes("POTATO"));
    expect(hit!.evidence.some(ev => ev.note?.includes('matched "potato"'))).toBe(true);
  });

  it("throws a loud error on a missing shard file", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as unknown as Response));
    await expect(driver.fetch(PACA, req())).rejects.toThrow(/HTTP 404/);
  });
});

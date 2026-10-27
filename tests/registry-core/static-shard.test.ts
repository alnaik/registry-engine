import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { readFile } from "node:fs/promises";
import { join } from "path";
import { StaticShardDriver } from "../../packages/registry-core/src/drivers/staticShard.js";
import type { SourceSpec, FetchRequest } from "../../packages/registry-core/src/driver.js";

// Spy on disk reads (real implementation kept) to assert which shard files a
// repo: endpoint actually touches.
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

const shard = JSON.parse(
  readFileSync(join(import.meta.dirname, "../fixtures/paca-us-co-shard.json"), "utf-8")
) as { records: Record<string, unknown>[] };

const PACA: SourceSpec = {
  id: "paca",
  name: "USDA PACA produce license registry",
  plane: "category",
  driver: "static_shard",
  coverage: { geo: ["US"], naics: ["4244"] },
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
    defaultNaics: ["424480"],
  },
};

function req(overrides: Partial<FetchRequest> = {}): FetchRequest {
  return { keywords: [], region: "US-CO", cities: [], naics: ["4244"], ...overrides };
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

  it("keeps only Active records and maps contacts, officers, aliases, default NAICS", async () => {
    stubShardFetch();
    const results = await driver.fetch(PACA, req());
    expect(results.length).toBe(shard.records.filter(r => r["license_status"] === "Active").length);
    expect(results.some(e => e.name === "GONE BUST PRODUCE INC")).toBe(false);

    const leevers = results.find(e => e.name.startsWith("LEEVERS"));
    expect(leevers).toBeDefined();
    expect(leevers!.naics).toEqual(["424480"]);
    expect(leevers!.contacts.some(c => c.includes("@"))).toBe(true);
    expect(leevers!.officers.length).toBeGreaterThan(0);
    expect(leevers!.id).toMatch(/^paca:\d+$/);
    expect(leevers!.evidence.some(ev => ev.field === "registry" && ev.note === "NAICS 424480")).toBe(true);
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

// PPP-style source: sector-sharded, read from the repo, filtered by NAICS.
const PPP: SourceSpec = {
  id: "ppp",
  name: "SBA PPP loan records",
  plane: "category",
  driver: "static_shard",
  coverage: { geo: ["US"], naics: ["*"] },
  endpoint: "repo:tests/fixtures/shards/ppp",
  fields: {
    id: "loan_number", name: "name", street: "address", city: "city", state: "state", zip: "zip",
    naics: "naics", employees: "jobs", date: "date_approved",
  },
  quirks: { shardBy: "naics2", shardRegions: ["US-CO"], evidenceFields: ["business_type", "business_age"] },
};

function readPaths(): string[] {
  return vi.mocked(readFile).mock.calls.map(c => String(c[0]));
}

describe("StaticShardDriver — repo: endpoints and sector shards", () => {
  const driver = new StaticShardDriver();

  beforeEach(() => { vi.mocked(readFile).mockClear(); });

  it("reads repo: shards from disk, with no network", async () => {
    const fetchMock = stubShardFetch();
    const results = await driver.fetch(PPP, req({ naics: ["332"] }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readPaths().map(p => p.split("tests/fixtures/")[1])).toEqual(["shards/ppp/US-CO/33.json"]);
    expect(results.map(e => e.name)).toEqual(["FIXTURE FABRICATION LLC", "SAMPLE WELDING INC"]);
  });

  it("maps naics, employees, lastSeen, address and evidence fields", async () => {
    const [e] = await driver.fetch(PPP, req({ naics: ["332312"] }));
    expect(e!.id).toBe("ppp:1001");
    expect(e!.naics).toEqual(["332312"]);
    expect(e!.employees).toBe(8);
    expect(e!.lastSeen).toBe("2021-02-10");
    expect(e!.address).toEqual({ street: "100 Test Way", city: "Boulder", state: "CO", zip: "80301" });
    expect(e!.evidence.some(ev => ev.field === "registry" && ev.note === "NAICS 332312")).toBe(true);
    expect(e!.evidence.some(ev => ev.field === "business_type" && ev.value === "Limited Liability Company(LLC)")).toBe(true);
  });

  it("reads only the sector files the codes fall in", async () => {
    const results = await driver.fetch(PPP, req({ naics: ["332", "424480"] }));
    expect(readPaths().map(p => p.split("US-CO/")[1]).sort()).toEqual(["33.json", "42.json"]);
    expect(results.map(e => e.name)).toEqual(["FIXTURE FABRICATION LLC", "SAMPLE WELDING INC", "NOT REAL PRODUCE LLC"]);

    vi.mocked(readFile).mockClear();
    await driver.fetch(PPP, req({ naics: ["332312", "332999"] }));
    expect(readPaths()).toHaveLength(1);
  });

  it("skips a missing sector file as 'no records there'", async () => {
    const results = await driver.fetch(PPP, req({ naics: ["999999", "424480"] }));
    expect(results.map(e => e.name)).toEqual(["NOT REAL PRODUCE LLC"]);
    expect(await driver.fetch(PPP, req({ naics: ["999999"] }))).toEqual([]);
  });

  it("filters rows by code relation within a sector", async () => {
    const results = await driver.fetch(PPP, req({ naics: ["333"] }));
    expect(results.map(e => e.name)).toEqual(["TOY MACHINERY CO"]);
    const exact = await driver.fetch(PPP, req({ naics: ["332999"] }));
    expect(exact.map(e => e.name)).toEqual(["SAMPLE WELDING INC"]);
  });

  it("returns [] without reading anything when the request has no codes", async () => {
    const fetchMock = stubShardFetch();
    expect(await driver.fetch(PPP, req({ naics: [] }))).toEqual([]);
    expect(readPaths()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("applies the city filter and the limit across sector files", async () => {
    const denver = await driver.fetch(PPP, req({ naics: ["33", "42"], cities: ["Denver"] }));
    expect(denver.map(e => e.address.city)).toEqual(["Denver", "Denver", "Denver"]);
    const limited = await driver.fetch(PPP, req({ naics: ["33", "42"], limit: 2 }));
    expect(limited).toHaveLength(2);
  });

  it("does not code-filter sources without a mapped naics field", async () => {
    stubShardFetch();
    const all = await new StaticShardDriver().fetch(PACA, req({ naics: ["4244"] }));
    const other = await new StaticShardDriver().fetch(PACA, req({ naics: ["999999"] }));
    expect(other.length).toBe(all.length);
  });

  it("throws on a missing repo shard when the source is not sector-sharded", async () => {
    const flat: SourceSpec = { ...PPP, endpoint: "repo:tests/fixtures/shards/ppp", quirks: {} };
    await expect(driver.fetch(flat, req({ region: "US-CO" }))).rejects.toThrow(/not found/);
  });

  it("treats an HTTP 404 sector file as empty for sector-sharded http endpoints", async () => {
    const httpPpp: SourceSpec = { ...PPP, endpoint: "https://example.com/shards/ppp" };
    const sector42 = JSON.parse(readFileSync(
      join(import.meta.dirname, "../fixtures/shards/ppp/US-CO/42.json"), "utf-8"));
    const fetchMock = vi.fn(async (url: string) => url.endsWith("/US-CO/42.json")
      ? ({ ok: true, status: 200, json: async () => sector42 }) as unknown as Response
      : ({ ok: false, status: 404, json: async () => ({}) }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    const results = await driver.fetch(httpPpp, req({ naics: ["33", "42"] }));
    expect(results.map(e => e.name)).toEqual(["NOT REAL PRODUCE LLC"]);
    expect(fetchMock).toHaveBeenCalledWith("https://example.com/shards/ppp/US-CO/33.json", expect.anything());
  });

  it("rejects a region that is not a plain region code, for repo: and http endpoints, reading nothing", async () => {
    const fetchMock = stubShardFetch();
    const httpPpp: SourceSpec = { ...PPP, endpoint: "https://example.com/shards/ppp" };
    for (const spec of [PPP, httpPpp, { ...PPP, quirks: {} }]) {
      for (const region of ["../../etc", "us-co", "US-COLO", ""]) {
        await expect(driver.fetch(spec, req({ region, naics: ["33"] })))
          .rejects.toThrow(`source "ppp": invalid region "${region}"`);
      }
    }
    expect(vi.mocked(readFile)).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    // a valid region still works
    expect((await driver.fetch(PPP, req({ region: "US-CO", naics: ["33"] }))).length).toBeGreaterThan(0);
  });
});

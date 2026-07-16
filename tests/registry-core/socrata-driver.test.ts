import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { SocrataDriver, soqlSafeLiteral } from "../../packages/registry-core/src/drivers/socrata.js";
import type { SourceSpec, FetchRequest } from "../../packages/registry-core/src/driver.js";

const entityRows = JSON.parse(
  readFileSync(join(import.meta.dirname, "../fixtures/entities-good-standing.json"), "utf-8")
) as Record<string, unknown>[];
const tradeRows = JSON.parse(
  readFileSync(join(import.meta.dirname, "../fixtures/trade-names.json"), "utf-8")
) as Record<string, unknown>[];

const CO_SOS: SourceSpec = {
  id: "co_sos",
  name: "Colorado Secretary of State",
  plane: "existence",
  driver: "socrata",
  coverage: { geo: ["US-CO"], categories: ["*"] },
  endpoint: "https://data.colorado.gov/resource",
  fields: {
    id: "entityid", name: "entityname", status: "entitystatus",
    street: "principaladdress1", city: "principalcity", state: "principalstate", zip: "principalzipcode",
    officer_first: "agentfirstname", officer_last: "agentlastname", officer_org: "agentorganizationname",
  },
  quirks: {
    datasetId: "4ykn-tg5h",
    statusValue: "Good Standing",
    tradeNames: {
      datasetId: "u7sb-g482",
      statusValue: "GOOD",
      fields: { entityId: "entityid", description: "tradenamedescription", status: "entitystatus", city: "city" },
    },
  },
};

function req(overrides: Partial<FetchRequest> = {}): FetchRequest {
  return { keywords: ["jewel"], region: "US-CO", cities: ["Denver"], categories: [], ...overrides };
}

// Recorded-fixture fetch: answers each SoQL request from the fixture rows the
// way the live API would, and records every URL for assertions.
let urls: string[] = [];
function fixtureFetch(entityMatches: Record<string, unknown>[], tradeMatches: Record<string, unknown>[]) {
  return vi.fn(async (url: string) => {
    urls.push(url);
    const where = decodeURIComponent(url.split("$where=")[1]!.split("&")[0]!);
    let rows: Record<string, unknown>[] = [];
    if (url.includes("4ykn-tg5h")) {
      rows = where.includes(" IN (")
        ? entityRows.filter(r => where.includes(`'${String(r["entityid"])}'`))
        : entityMatches;
    } else if (url.includes("u7sb-g482")) {
      rows = where.includes(" IN (")
        ? tradeMatches.filter(r => where.includes(`'${String(r["entityid"])}'`))
        : tradeMatches;
    }
    return { ok: true, status: 200, json: async () => rows } as unknown as Response;
  });
}

beforeEach(() => { urls = []; });
afterEach(() => vi.unstubAllGlobals());

describe("soqlSafeLiteral", () => {
  it("strips quote, wildcard and underscore characters", () => {
    expect(soqlSafeLiteral("o'brien %_jewels")).toBe("OBRIEN JEWELS");
  });
});

describe("SocrataDriver", () => {
  const driver = new SocrataDriver();

  it("returns [] and makes zero requests without usable keywords", async () => {
    const fetchMock = fixtureFetch([], []);
    vi.stubGlobal("fetch", fetchMock);
    expect(await driver.fetch(CO_SOS, req({ keywords: [] }))).toEqual([]);
    expect(await driver.fetch(CO_SOS, req({ keywords: ["ab"] }))).toEqual([]); // <3 chars
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps rows to canonical entities with officers and evidence", async () => {
    vi.stubGlobal("fetch", fixtureFetch([entityRows[0]!], []));
    const kw = String(entityRows[0]!["entityname"]).slice(0, 5).toLowerCase();
    const [e] = await driver.fetch(CO_SOS, req({ keywords: [kw] }));
    expect(e).toBeDefined();
    expect(e!.id).toBe(`co_sos:${String(entityRows[0]!["entityid"])}`);
    expect(e!.name).toBe(String(entityRows[0]!["entityname"]));
    expect(e!.status).toBe("Good Standing");
    expect(e!.source_ids).toEqual(["co_sos"]);
    expect(e!.evidence.some(ev => ev.field === "entityname" && ev.note?.includes(kw))).toBe(true);
  });

  it("puts status, keyword and city filters into the SoQL where clause", async () => {
    vi.stubGlobal("fetch", fixtureFetch([], []));
    await driver.fetch(CO_SOS, req({ keywords: ["jewel"], cities: ["Denver"] }));
    const entityUrl = decodeURIComponent(urls.find(u => u.includes("4ykn-tg5h"))!);
    expect(entityUrl).toContain("entitystatus='Good Standing'");
    expect(entityUrl).toContain("upper(entityname) LIKE '%JEWEL%'");
    expect(entityUrl).toContain("upper(principalcity) LIKE '%DENVER%'");
  });

  it("escapes SoQL injection attempts in keywords and cities", async () => {
    vi.stubGlobal("fetch", fixtureFetch([], []));
    await driver.fetch(CO_SOS, req({ keywords: ["jew'el%"], cities: ["Den'ver"] }));
    const entityUrl = decodeURIComponent(urls.find(u => u.includes("4ykn-tg5h"))!);
    expect(entityUrl).toContain("'%JEWEL%'");
    expect(entityUrl).toContain("'%DENVER%'");
    expect(entityUrl).not.toContain("JEW'EL");
  });

  it("joins trade-name matches back to entities and hydrates names[]", async () => {
    const trade = tradeRows[0]!;
    const owner = entityRows.find(r => String(r["entityid"]) === String(trade["entityid"]));
    // Fixture sanity guarantees at least one trade row; its owner may or may
    // not be in the entity fixture — synthesize one if needed.
    const ownerRow = owner ?? { ...entityRows[0]!, entityid: trade["entityid"] };
    vi.stubGlobal("fetch", fixtureFetch([], [trade]));
    const kw = String(trade["tradenamedescription"]).slice(0, 4).toLowerCase();
    // Patch the by-id lookup to find the owner row.
    entityRows.push(ownerRow);
    const results = await driver.fetch(CO_SOS, req({ keywords: [kw], cities: [] }));
    entityRows.pop();
    expect(results).toHaveLength(1);
    expect(results[0]!.names).toContain(String(trade["tradenamedescription"]));
    expect(results[0]!.evidence.some(ev => ev.field === "tradenamedescription")).toBe(true);
  });

  it("respects the limit", async () => {
    vi.stubGlobal("fetch", fixtureFetch(entityRows, []));
    const results = await driver.fetch(CO_SOS, req({ keywords: ["a e i o u llc inc".slice(0, 3)], limit: 1, cities: [] }));
    expect(results.length).toBeLessThanOrEqual(1);
  });
});

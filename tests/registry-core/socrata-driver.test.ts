import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { SocrataDriver, soqlSafeLiteral, namePattern } from "../../packages/registry-core/src/drivers/socrata.js";
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
  coverage: { geo: ["US-CO"], naics: ["*"] },
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
  return { keywords: ["jewel"], region: "US-CO", cities: ["Denver"], naics: [], ...overrides };
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

// A category-plane source like the Colorado farm-products filings: no status
// field, keywords searched across several fields, one-line address.
const FARMS: SourceSpec = {
  id: "co_farm_products",
  name: "Colorado farm-products financing statements",
  plane: "category",
  driver: "socrata",
  coverage: { geo: ["US-CO"], naics: ["11"] },
  endpoint: "https://data.colorado.gov/resource",
  fields: { id: "debtorid", name: "debtorname", address_line: "debtoraddress", date: "recordiddate" },
  quirks: {
    datasetId: "ej2c-jkvh",
    keywordFields: ["farmproduct", "additionalfarmproduct"],
    evidenceFields: ["farmproduct", "securedparty"],
    defaultNaics: ["11"],
  },
};

const FARM_ROW = {
  farmproduct: "All Field Crops",
  debtorname: "17 SQUARED LLC",
  debtorid: "5179196033",
  debtoraddress: "15030 US Highway 50, Las Animas, CO, 81054",
  securedparty: "McClave State Bank, PO Box 3",
  additionalfarmproduct: "Corn; Cotton (Field Or Row Crop); Hay; Oats",
  recordiddate: "2024-06-26T00:00:00.000",
};

describe("SocrataDriver — keywordFields, optional status, address_line cities", () => {
  const driver = new SocrataDriver();

  function whereOf(): string {
    return decodeURIComponent(urls[0]!.split("$where=")[1]!.split("&")[0]!);
  }

  it("ORs the keyword clause across every keyword field", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => [] } as unknown as Response;
    }));
    await driver.fetch(FARMS, req({ keywords: ["corn", "hay"], cities: [] }));
    expect(whereOf()).toBe(
      "((upper(farmproduct) LIKE '%CORN%' OR upper(farmproduct) LIKE '%HAY%')" +
      " OR (upper(additionalfarmproduct) LIKE '%CORN%' OR upper(additionalfarmproduct) LIKE '%HAY%'))"
    );
  });

  it("adds no status clause when quirks.statusValue is absent", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => [] } as unknown as Response;
    }));
    await driver.fetch(FARMS, req({ keywords: ["corn"], cities: [] }));
    expect(whereOf()).not.toContain("=");   // LIKE clauses only, no status equality
    expect(urls).toHaveLength(1);
  });

  it("falls back to address_line for the city filter, and ignores cities when neither is mapped", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => [] } as unknown as Response;
    }));
    await driver.fetch(FARMS, req({ keywords: ["corn"], cities: ["Las Animas"] }));
    expect(whereOf()).toContain("upper(debtoraddress) LIKE '%LAS ANIMAS%'");

    urls = [];
    const noAddress: SourceSpec = { ...FARMS, fields: { id: "debtorid", name: "debtorname" } };
    await driver.fetch(noAddress, req({ keywords: ["corn"], cities: ["Las Animas"] }));
    expect(whereOf()).not.toContain("LAS ANIMAS");
  });

  it("keeps the single-field default: keywords against fields.name only", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => [] } as unknown as Response;
    }));
    const plain: SourceSpec = { ...FARMS, quirks: { datasetId: "ej2c-jkvh" } };
    await driver.fetch(plain, req({ keywords: ["corn"], cities: [] }));
    expect(whereOf()).toBe("(upper(debtorname) LIKE '%CORN%')");
  });

  it("maps address_line, naics default, lastSeen, and keyword + field evidence", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => (
      { ok: true, status: 200, json: async () => [FARM_ROW] } as unknown as Response)));
    const [e] = await driver.fetch(FARMS, req({ keywords: ["corn"], cities: [] }));
    expect(e!.id).toBe("co_farm_products:5179196033");
    expect(e!.address).toEqual({ street: "15030 US Highway 50", city: "Las Animas", state: "CO", zip: "81054" });
    expect(e!.naics).toEqual(["11"]);
    expect(e!.lastSeen).toBe("2024-06-26");
    // keyword evidence runs over each keyword field's value
    expect(e!.evidence.some(ev => ev.field === "additionalfarmproduct" && ev.note === 'matched "corn"')).toBe(true);
    expect(e!.evidence.some(ev => ev.field === "farmproduct" && ev.note?.startsWith("matched"))).toBe(false);
    // evidenceFields land as plain evidence
    expect(e!.evidence).toContainEqual({ source: "co_farm_products", field: "securedparty", value: "McClave State Bank, PO Box 3" });
    expect(e!.evidence).toContainEqual({ source: "co_farm_products", field: "farmproduct", value: "All Field Crops" });
  });

  it("fetchByNames also drops the status clause when absent", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => [] } as unknown as Response;
    }));
    await driver.fetchByNames(FARMS, ["17 SQUARED LLC"]);
    expect(whereOf()).toContain("LIKE '%%17%SQUARED%%'");
    expect(whereOf()).not.toContain("=");
  });

  it("requires only quirks.datasetId", async () => {
    const bad: SourceSpec = { ...FARMS, quirks: {} };
    await expect(driver.fetch(bad, req({ keywords: ["corn"] }))).rejects.toThrow(/quirks\.datasetId/);
  });
});

describe("SocrataDriver.fetchByNames", () => {
  const driver = new SocrataDriver();

  it("builds normalized LIKE patterns and a status filter", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => [] } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    await driver.fetchByNames(CO_SOS, ["ALPINE SUMMIT SALES, INC.", "COLO-PAC PRODUCE, INC."]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const where = decodeURIComponent(urls[0]!.split("$where=")[1]!.split("&")[0]!);
    expect(where).toContain("%ALPINE%SUMMIT%SALES%");
    expect(where).toContain("%COLO%PAC%PRODUCE%");
    expect(where).toContain("entitystatus='Good Standing'");
    expect(where).not.toContain("principalcity");
  });

  it("returns [] with zero requests when no name survives normalization", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => [] }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    const result = await driver.fetchByNames(CO_SOS, ["A", "!!", "Co"]);
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("chunks names across requests", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => [] } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const names = Array.from({ length: 30 }, (_, i) => `DISTINCT ENTITY NUMBER ${i} INC`);
    await driver.fetchByNames(CO_SOS, names);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("builds patterns from the raw name so & and ' survive", async () => {
    expect(namePattern("PAUL'S CUSTOM CANVAS INC")).toBe("%PAUL%S%CUSTOM%CANVAS%");
    expect(namePattern("IRON & STEEL")).toBe("%IRON%STEEL%");
    expect(namePattern("SMITH AND SONS")).toBe("%SMITH%SONS%");
    expect(namePattern("Co")).toBeNull();

    const fetchMock = vi.fn(async (url: string) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => [] } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    await driver.fetchByNames(CO_SOS, ["PAUL'S CUSTOM CANVAS INC"]);
    const where = decodeURIComponent(urls[0]!.split("$where=")[1]!.split("&")[0]!);
    expect(where).toContain("PAUL%S%CUSTOM%CANVAS");
  });

  it("escapes injection attempts", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => [] } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    await driver.fetchByNames(CO_SOS, ["PRODUCE'); DELETE--"]);
    const where = decodeURIComponent(urls[0]!.split("$where=")[1]!.split("&")[0]!);
    const insidePatterns = [...where.matchAll(/'%[^']*%'/g)].map(m => m[0]);
    expect(insidePatterns.every(p => !p.slice(1, -1).includes("'"))).toBe(true);
  });

  it("maps rows and stamps backfill evidence", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true, status: 200, json: async () => [entityRows[0]!],
    }) as unknown as Response);
    const [e] = await driver.fetchByNames(CO_SOS, [String(entityRows[0]!["entityname"])]);
    expect(e).toBeDefined();
    expect(e!.id).toBe(`co_sos:${String(entityRows[0]!["entityid"])}`);
    expect(e!.name).toBe(String(entityRows[0]!["entityname"]));
    expect(e!.evidence.some(ev => ev.note === "existence backfill — name match from another plane")).toBe(true);
  });

  it("dedupes rows repeated across chunks by id", async () => {
    const names = Array.from({ length: 30 }, (_, i) => `DISTINCT ENTITY NUMBER ${i} INC`);
    const row = { ...entityRows[0]! };
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200, json: async () => [row],
    }) as unknown as Response));
    const results = await driver.fetchByNames(CO_SOS, names);
    expect(results).toHaveLength(1);
  });
});

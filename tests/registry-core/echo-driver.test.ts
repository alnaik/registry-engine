import { describe, it, expect, vi, afterEach } from "vitest";
import { EchoDriver } from "../../packages/registry-core/src/drivers/echo.js";
import type { SourceSpec, FetchRequest } from "../../packages/registry-core/src/driver.js";

const ECHO: SourceSpec = {
  id: "epa_echo",
  name: "EPA ECHO regulated facilities",
  plane: "category",
  driver: "echo",
  coverage: { geo: ["US"], naics: ["*"] },
  endpoint: "https://echodata.epa.gov/echo",
  fields: {
    id: "RegistryID", name: "FacName", street: "FacStreet", city: "FacCity", state: "FacState",
    zip: "FacZip", naics: "FacNAICSCodes", date: "FacDateLastInspection",
  },
};

function req(overrides: Partial<FetchRequest> = {}): FetchRequest {
  return { keywords: [], region: "US-CO", cities: ["Denver"], naics: ["332"], ...overrides };
}

function facility(id: string, name: string, city = "DENVER", extra: Record<string, unknown> = {}) {
  return {
    FacName: name, FacStreet: "4650 S LEYDEN ST UNIT A", FacCity: city, FacState: "CO", FacZip: "80123",
    RegistryID: id, FacNAICSCodes: "332813", FacDateLastInspection: "09/02/2008", ...extra,
  };
}

// Stubs ECHO's two-step API. `pages` maps a city (or "" for none) to the
// pages of facilities get_qid returns; past the end it returns Facilities: [].
let urls: URL[] = [];
function stubEcho(pages: Record<string, Record<string, unknown>[][]>, startOverride?: unknown) {
  const fetchMock = vi.fn(async (url: string) => {
    const u = new URL(url);
    urls.push(u);
    const respond = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
    if (u.pathname.endsWith("get_facilities")) {
      if (startOverride !== undefined) return respond(startOverride);
      const city = u.searchParams.get("p_ct") ?? "";
      return respond({ Results: { Message: "Success", QueryRows: "1", QueryID: `q:${city}` } });
    }
    const city = u.searchParams.get("qid")!.slice(2);
    const page = Number(u.searchParams.get("pageno"));
    return respond({ Results: { PageNo: String(page), Facilities: pages[city]?.[page - 1] ?? [] } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => { vi.unstubAllGlobals(); urls = []; });

describe("EchoDriver", () => {
  const driver = new EchoDriver();

  it("runs the two-step query and maps facilities to entities", async () => {
    stubEcho({ DENVER: [[facility("110069391438", "ACME MANUFACTURING COMPANY INC")]] });
    const [e, ...rest] = await driver.fetch(ECHO, req());
    expect(rest).toEqual([]);
    expect(e!.id).toBe("epa_echo:110069391438");
    expect(e!.name).toBe("ACME MANUFACTURING COMPANY INC");
    expect(e!.naics).toEqual(["332813"]);
    expect(e!.lastSeen).toBe("2008-09-02");
    expect(e!.address).toEqual({ street: "4650 S LEYDEN ST UNIT A", city: "DENVER", state: "CO", zip: "80123" });
    expect(e!.evidence).toContainEqual({
      source: "epa_echo", field: "registry", value: "EPA ECHO regulated facilities",
      note: "NAICS 332813 · last inspection 2008-09-02",
    });

    const start = urls.find(u => u.pathname.endsWith("get_facilities"))!;
    expect(start.origin + start.pathname).toBe("https://echodata.epa.gov/echo/echo_rest_services.get_facilities");
    expect(Object.fromEntries(start.searchParams)).toEqual({
      output: "JSON", p_st: "CO", p_ncs: "332", p_act: "Y", p_ct: "DENVER",
    });
    const page = urls.find(u => u.pathname.endsWith("get_qid"))!;
    expect(Object.fromEntries(page.searchParams)).toMatchObject({
      output: "JSON", qid: "q:DENVER", pageno: "1", responseset: "500",
    });
  });

  it("notes a facility with no inspection date", async () => {
    stubEcho({ DENVER: [[facility("1", "NEVER INSPECTED INC", "DENVER", { FacDateLastInspection: "" })]] });
    const [e] = await driver.fetch(ECHO, req());
    expect(e!.lastSeen).toBeUndefined();
    expect(e!.evidence.find(ev => ev.field === "registry")!.note).toBe("NAICS 332813 · last inspection none on record");
  });

  it("pages until an empty page", async () => {
    const fetchMock = stubEcho({ DENVER: [[facility("1", "A INC"), facility("2", "B INC")], [facility("3", "C INC")]] });
    const results = await driver.fetch(ECHO, req());
    expect(results.map(e => e.name)).toEqual(["A INC", "B INC", "C INC"]);
    const pageNos = urls.filter(u => u.pathname.endsWith("get_qid")).map(u => u.searchParams.get("pageno"));
    expect(pageNos).toEqual(["1", "2", "3"]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("stops once the limit is reached and sizes pages to it", async () => {
    stubEcho({ DENVER: [[facility("1", "A INC"), facility("2", "B INC")], [facility("3", "C INC")]] });
    const results = await driver.fetch(ECHO, req({ limit: 2 }));
    expect(results).toHaveLength(2);
    const pages = urls.filter(u => u.pathname.endsWith("get_qid"));
    expect(pages).toHaveLength(1);
    expect(pages[0]!.searchParams.get("responseset")).toBe("2");
  });

  it("caps the page size at 1000", async () => {
    stubEcho({ DENVER: [[facility("1", "A INC")]] });
    await driver.fetch(ECHO, req({ limit: 5000 }));
    expect(urls.find(u => u.pathname.endsWith("get_qid"))!.searchParams.get("responseset")).toBe("1000");
  });

  it("searches each city with p_ct and dedupes facilities across cities", async () => {
    stubEcho({
      DENVER: [[facility("1", "SHARED INC"), facility("2", "DENVER ONLY INC")]],
      AURORA: [[facility("1", "SHARED INC"), facility("3", "AURORA ONLY INC", "AURORA")]],
    });
    const results = await driver.fetch(ECHO, req({ cities: ["Denver", "Aurora"] }));
    expect(results.map(e => e.id).sort()).toEqual(["epa_echo:1", "epa_echo:2", "epa_echo:3"]);
    const cities = urls.filter(u => u.pathname.endsWith("get_facilities")).map(u => u.searchParams.get("p_ct")).sort();
    expect(cities).toEqual(["AURORA", "DENVER"]);
  });

  it("searches the whole state once, without p_ct, when no city is given", async () => {
    stubEcho({ "": [[facility("1", "A INC")]] });
    const results = await driver.fetch(ECHO, req({ cities: [], naics: ["332", "3329"] }));
    expect(results).toHaveLength(1);
    const starts = urls.filter(u => u.pathname.endsWith("get_facilities"));
    expect(starts).toHaveLength(1);
    expect(starts[0]!.searchParams.has("p_ct")).toBe(false);
    expect(starts[0]!.searchParams.get("p_ncs")).toBe("332,3329");
  });

  it("makes no request without a usable code (3-6 digits) or a state", async () => {
    const fetchMock = stubEcho({});
    expect(await driver.fetch(ECHO, req({ naics: [] }))).toEqual([]);
    expect(await driver.fetch(ECHO, req({ naics: ["33"] }))).toEqual([]);
    expect(await driver.fetch(ECHO, req({ region: "US" }))).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws on Results.Error", async () => {
    stubEcho({}, { Results: { Error: { ErrorMessage: "Invalid NAICS code" } } });
    await expect(driver.fetch(ECHO, req())).rejects.toThrow('source "epa_echo": Invalid NAICS code');
  });

  it("throws when the search returns no QueryID", async () => {
    stubEcho({}, { Results: { Message: "Success" } });
    await expect(driver.fetch(ECHO, req())).rejects.toThrow(/source "epa_echo"/);
  });
});

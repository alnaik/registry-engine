import { describe, it, expect } from "vitest";
import { normalizeName, mergeEntities, localityCompatible, type Entity } from "../../packages/registry-core/src/entity.js";

function entity(overrides: Partial<Entity>): Entity {
  return {
    id: "src:1",
    name: "Acme LLC",
    names: [],
    status: "",
    address: {},
    officers: [],
    naics: [],
    contacts: [],
    source_ids: ["src"],
    evidence: [],
    ...overrides,
  };
}

describe("normalizeName", () => {
  it("uppercases and strips punctuation", () => {
    expect(normalizeName("Rocky-Mountain  Produce, Inc.")).toBe("ROCKY MOUNTAIN PRODUCE");
  });

  it("strips stacked org suffixes", () => {
    expect(normalizeName("Acme Holdings Co LLC")).toBe("ACME HOLDINGS");
  });

  it("keeps at least one token even if it is a suffix word", () => {
    expect(normalizeName("Co")).toBe("CO");
  });

  it("treats & as AND", () => {
    expect(normalizeName("B&B Farms")).toBe("B AND B FARMS");
  });

  it("does not strip suffix words mid-name", () => {
    expect(normalizeName("Company Store LLC")).toBe("COMPANY STORE");
  });
});

describe("mergeEntities", () => {
  it("merges records whose primary names normalize equal", () => {
    const merged = mergeEntities([
      entity({ id: "co_sos:1", name: "Acme Produce LLC", status: "Good Standing", source_ids: ["co_sos"] }),
      entity({ id: "paca:9", name: "ACME PRODUCE, INC.", naics: ["424480"], source_ids: ["paca"] }),
    ]);
    expect(merged).toHaveLength(1);
    const m = merged[0]!;
    expect(m.id).toBe("co_sos:1");             // first contributor wins
    expect(m.name).toBe("Acme Produce LLC");
    expect(m.status).toBe("Good Standing");
    expect(m.naics).toEqual(["424480"]);
    expect(m.source_ids).toEqual(["co_sos", "paca"]);
  });

  it("merges via alias names (trade name matches another source's legal name)", () => {
    const merged = mergeEntities([
      entity({ id: "co_sos:1", name: "JMB Holdings LLC", names: ["Yukon Gold Farms"] }),
      entity({ id: "paca:2", name: "Yukon Gold Farms Inc", source_ids: ["paca"] }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.names).toContain("Yukon Gold Farms");
  });

  it("does not merge different businesses", () => {
    const merged = mergeEntities([
      entity({ id: "a:1", name: "Alpha Diamonds" }),
      entity({ id: "b:2", name: "Beta Jewelry" }),
    ]);
    expect(merged).toHaveLength(2);
  });

  it("unions contacts and officers case-insensitively, keeps evidence from all sources", () => {
    const merged = mergeEntities([
      entity({
        name: "Acme LLC",
        officers: ["Jane Roe"],
        contacts: ["info@acme.com"],
        evidence: [{ source: "co_sos", field: "entityname", value: "Acme LLC" }],
      }),
      entity({
        id: "paca:2",
        name: "Acme Inc",
        officers: ["JANE ROE", "Bo Diddley"],
        contacts: ["INFO@ACME.COM", "303-555-0100"],
        evidence: [{ source: "paca", field: "businessName", value: "Acme Inc" }],
      }),
    ]);
    const m = merged[0]!;
    expect(m.officers).toEqual(["Jane Roe", "Bo Diddley"]);
    expect(m.contacts).toEqual(["info@acme.com", "303-555-0100"]);
    expect(m.evidence.map(e => e.source)).toEqual(["co_sos", "paca"]);
  });

  it("fills missing address fields without overwriting present ones", () => {
    const merged = mergeEntities([
      entity({ name: "Acme", address: { city: "Denver" } }),
      entity({ id: "x:2", name: "Acme", address: { city: "denver", zip: "80202", state: "CO" } }),
    ]);
    expect(merged[0]!.address).toEqual({ city: "Denver", zip: "80202", state: "CO" });
  });

  it("primary name never repeats in names[]", () => {
    const merged = mergeEntities([
      entity({ name: "Acme LLC", names: ["ACME, L.L.C."] }),
    ]);
    expect(merged[0]!.names).toEqual([]);
  });
});

describe("mergeEntities — locality guard", () => {
  it("keeps same-named businesses in different towns apart", () => {
    const merged = mergeEntities([
      entity({ id: "co_sos:1", name: "Green Valley Farms LLC", address: { city: "Greeley", zip: "80631" } }),
      entity({ id: "ppp:2", name: "GREEN VALLEY FARMS LLC", address: { city: "Monte Vista", zip: "81144" } }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.map(m => m.id)).toEqual(["co_sos:1", "ppp:2"]);
  });

  it("merges same-named records with the same ZIP5 even if the city spelling differs", () => {
    const merged = mergeEntities([
      entity({ id: "co_sos:1", name: "Green Valley Farms LLC", address: { city: "Greeley", zip: "80631" } }),
      entity({ id: "ppp:2", name: "GREEN VALLEY FARMS LLC", address: { city: "GREELEY CO", zip: "80631-1234" } }),
    ]);
    expect(merged).toHaveLength(1);
  });

  it("merges same-named records in the same city when a ZIP is missing", () => {
    const merged = mergeEntities([
      entity({ id: "a:1", name: "Acme Welding", address: { city: "Denver" } }),
      entity({ id: "b:2", name: "ACME WELDING INC", address: { city: " denver ", zip: "80202" } }),
    ]);
    expect(merged).toHaveLength(1);
  });

  it("merges when one side has no locality at all", () => {
    const merged = mergeEntities([
      entity({ id: "a:1", name: "Acme Welding", address: {} }),
      entity({ id: "b:2", name: "Acme Welding", address: { city: "Denver", zip: "80202" } }),
    ]);
    expect(merged).toHaveLength(1);
  });

  it("joins a later record to the compatible group, not the first same-named one", () => {
    const merged = mergeEntities([
      entity({ id: "a:1", name: "Green Valley Farms", address: { city: "Greeley" } }),
      entity({ id: "b:2", name: "Green Valley Farms", address: { city: "Monte Vista" } }),
      entity({ id: "c:3", name: "GREEN VALLEY FARMS LLC", address: { city: "Monte Vista" }, naics: ["111"] }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[1]!.naics).toEqual(["111"]);
    expect(merged[1]!.source_ids).toEqual(["src"]);
    expect(merged[0]!.naics).toEqual([]);
  });

  it("localityCompatible follows the zip/city rules", () => {
    const at = (address: Entity["address"]) => entity({ address });
    expect(localityCompatible(at({}), at({ city: "Denver" }))).toBe(true);
    expect(localityCompatible(at({ street: "1 Main" }), at({ zip: "80202" }))).toBe(true);
    expect(localityCompatible(at({ zip: "80202" }), at({ zip: "80202-9999" }))).toBe(true);
    expect(localityCompatible(at({ zip: "80202" }), at({ zip: "80203" }))).toBe(false);
    expect(localityCompatible(at({ city: "Denver" }), at({ city: "DENVER" }))).toBe(true);
    expect(localityCompatible(at({ city: "Denver" }), at({ city: "Aurora" }))).toBe(false);
    expect(localityCompatible(at({ city: "Denver" }), at({ zip: "80202" }))).toBe(false);
  });
});

describe("mergeEntities — employees and lastSeen", () => {
  it("takes the largest headcount and the most recent date from any side", () => {
    const merged = mergeEntities([
      entity({ id: "a:1", name: "Acme", employees: 4, lastSeen: "2021-03-05" }),
      entity({ id: "b:2", name: "Acme", employees: 12, lastSeen: "2024-06-26" }),
      entity({ id: "c:3", name: "Acme" }),
      entity({ id: "d:4", name: "Acme", employees: 7, lastSeen: "2008-09-02" }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.employees).toBe(12);
    expect(merged[0]!.lastSeen).toBe("2024-06-26");
  });

  it("leaves both unset when no side has them, and picks up a later one", () => {
    const none = mergeEntities([entity({ name: "Acme" }), entity({ id: "b:2", name: "Acme" })]);
    expect(none[0]!.employees).toBeUndefined();
    expect(none[0]!.lastSeen).toBeUndefined();
    const later = mergeEntities([entity({ name: "Acme" }), entity({ id: "b:2", name: "Acme", employees: 3, lastSeen: "2022-01-01" })]);
    expect(later[0]!.employees).toBe(3);
    expect(later[0]!.lastSeen).toBe("2022-01-01");
  });
});

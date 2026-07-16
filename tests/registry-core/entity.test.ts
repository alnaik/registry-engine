import { describe, it, expect } from "vitest";
import { normalizeName, mergeEntities, type Entity } from "../../packages/registry-core/src/entity.js";

function entity(overrides: Partial<Entity>): Entity {
  return {
    id: "src:1",
    name: "Acme LLC",
    names: [],
    status: "",
    address: {},
    officers: [],
    categories: [],
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
      entity({ id: "paca:9", name: "ACME PRODUCE, INC.", categories: ["produce"], source_ids: ["paca"] }),
    ]);
    expect(merged).toHaveLength(1);
    const m = merged[0]!;
    expect(m.id).toBe("co_sos:1");             // first contributor wins
    expect(m.name).toBe("Acme Produce LLC");
    expect(m.status).toBe("Good Standing");
    expect(m.categories).toEqual(["produce"]);
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
      entity({ id: "x:2", name: "Acme", address: { city: "Aurora", zip: "80202", state: "CO" } }),
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

import { describe, it, expect } from "vitest";
import { rowToEntity, fieldEvidence } from "../../packages/registry-core/src/drivers/mapRow.js";
import type { SourceSpec } from "../../packages/registry-core/src/driver.js";

function spec(fields: Record<string, string>, quirks?: Record<string, unknown>): SourceSpec {
  return {
    id: "t", name: "Test registry", plane: "category", driver: "static_shard",
    coverage: { geo: ["US"], naics: ["*"] }, endpoint: "", fields: { id: "id", name: "name", ...fields },
    ...(quirks !== undefined ? { quirks } : {}),
  };
}

describe("rowToEntity — naics", () => {
  const s = spec({ naics: "codes" });

  it("splits multiple codes on whitespace and commas, dropping junk", () => {
    expect(rowToEntity(s, { id: "1", name: "A", codes: "33299 332999, 811121  n/a 7" }).naics)
      .toEqual(["33299", "332999", "811121"]);
  });

  it("falls back to quirks.defaultNaics when the field is unmapped or yields nothing", () => {
    const withDefault = spec({ naics: "codes" }, { defaultNaics: ["424480"] });
    expect(rowToEntity(withDefault, { id: "1", name: "A", codes: "" }).naics).toEqual(["424480"]);
    expect(rowToEntity(withDefault, { id: "1", name: "A", codes: "none" }).naics).toEqual(["424480"]);
    const unmapped = spec({}, { defaultNaics: ["11"] });
    expect(rowToEntity(unmapped, { id: "1", name: "A" }).naics).toEqual(["11"]);
    expect(rowToEntity(withDefault, { id: "1", name: "A", codes: "332312" }).naics).toEqual(["332312"]);
  });

  it("is empty with neither a code nor a default", () => {
    expect(rowToEntity(spec({}), { id: "1", name: "A" }).naics).toEqual([]);
  });
});

describe("rowToEntity — employees and date", () => {
  const s = spec({ employees: "jobs", date: "when" });

  it("parses employees and sets it only when finite and >= 0", () => {
    expect(rowToEntity(s, { id: "1", name: "A", jobs: "12" }).employees).toBe(12);
    expect(rowToEntity(s, { id: "1", name: "A", jobs: 0 }).employees).toBe(0);
    expect(rowToEntity(s, { id: "1", name: "A", jobs: "-3" }).employees).toBeUndefined();
    expect(rowToEntity(s, { id: "1", name: "A", jobs: "many" }).employees).toBeUndefined();
    expect(rowToEntity(s, { id: "1", name: "A" }).employees).toBeUndefined();
  });

  it("reads both date formats into ISO lastSeen", () => {
    expect(rowToEntity(s, { id: "1", name: "A", when: "2024-06-26T00:00:00.000" }).lastSeen).toBe("2024-06-26");
    expect(rowToEntity(s, { id: "1", name: "A", when: "09/02/2008" }).lastSeen).toBe("2008-09-02");
  });

  it("ignores anything else", () => {
    expect(rowToEntity(s, { id: "1", name: "A", when: "Sept 2 2008" }).lastSeen).toBeUndefined();
    expect(rowToEntity(s, { id: "1", name: "A", when: "" }).lastSeen).toBeUndefined();
  });
});

describe("rowToEntity — address_line", () => {
  const s = spec({ address_line: "addr" });

  it("splits street, city, state and zip", () => {
    const e = rowToEntity(s, { id: "1", name: "A", addr: "15030 US Highway 50, Las Animas, CO, 81054" });
    expect(e.address).toEqual({ street: "15030 US Highway 50", city: "Las Animas", state: "CO", zip: "81054" });
  });

  it("keeps commas inside the street and trims a ZIP+4 to 5 digits", () => {
    const e = rowToEntity(s, { id: "1", name: "A", addr: "PO Box 3, Suite 4, Denver, CO, 80202-1234" });
    expect(e.address).toEqual({ street: "PO Box 3, Suite 4", city: "Denver", state: "CO", zip: "80202" });
  });

  it("ignores placeholder addresses", () => {
    const e = rowToEntity(s, { id: "1", name: "A", addr: "NO ADDRESS, NO CITY, NO STATE, NO ZIP" });
    expect(e.address).toEqual({});
  });

  it("drops placeholder parts but keeps real ones", () => {
    const e = rowToEntity(s, { id: "1", name: "A", addr: "NO ADDRESS, Denver, CO, 80202" });
    expect(e.address).toEqual({ city: "Denver", state: "CO", zip: "80202" });
  });

  it("fills only keys not already set by their own fields", () => {
    const both = spec({ address_line: "addr", city: "town" });
    const e = rowToEntity(both, { id: "1", name: "A", town: "Aurora", addr: "1 Main St, Denver, CO, 80202" });
    expect(e.address).toEqual({ street: "1 Main St", city: "Aurora", state: "CO", zip: "80202" });
  });
});

describe("fieldEvidence", () => {
  const s = spec({}, { evidenceFields: ["crop", "lender", "missing"] });

  it("emits one Evidence per non-empty configured field, trimmed and capped at 200 chars", () => {
    const ev = fieldEvidence(s, { crop: "  Corn; Hay ", lender: "x".repeat(300), other: "ignored" });
    expect(ev).toEqual([
      { source: "t", field: "crop", value: "Corn; Hay" },
      { source: "t", field: "lender", value: "x".repeat(200) },
    ]);
  });

  it("is empty without quirks.evidenceFields", () => {
    expect(fieldEvidence(spec({}), { crop: "Corn" })).toEqual([]);
  });
});

describe("rowToEntity — statusDisplay", () => {
  it("replaces the raw status field value when quirks.statusDisplay is set", () => {
    const s = spec({ status: "juris" }, { statusDisplay: "Active (domestic)" });
    expect(rowToEntity(s, { id: "1", name: "A", juris: "New York" }).status).toBe("Active (domestic)");
    expect(rowToEntity(spec({ status: "juris" }), { id: "1", name: "A", juris: "New York" }).status).toBe("New York");
  });
});

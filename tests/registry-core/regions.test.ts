import { describe, it, expect } from "vitest";
import { knownRegions, defaultRegion, regionCities } from "../../packages/registry-core/src/regions.js";
import { SOURCES } from "../../packages/registry-core/src/sources/index.js";
import { loadManifest } from "../../packages/registry-core/src/manifest.js";

describe("knownRegions / defaultRegion / regionCities over the shipped manifest", () => {
  it("knownRegions(SOURCES) is [\"US-CO\", \"US-CT\", \"US-NY\"] — paca's bare US geo is excluded, its shardRegions dedupes", () => {
    expect(knownRegions(SOURCES)).toEqual(["US-CO", "US-CT", "US-NY"]);
  });

  it("defaultRegion(SOURCES) is US-CO", () => {
    expect(defaultRegion(SOURCES)).toBe("US-CO");
  });

  it("regionCities(SOURCES, \"US-CO\") contains denver and colorado springs, lowercased", () => {
    const cities = regionCities(SOURCES, "US-CO");
    expect(cities).toContain("denver");
    expect(cities).toContain("colorado springs");
  });
});

const FICTIONAL_MANIFEST = {
  sources: [
    {
      id: "xx_sos",
      name: "Mockland Secretary of State",
      plane: "existence",
      driver: "socrata",
      coverage: { geo: ["US-XX"], naics: ["*"] },
      endpoint: "https://data.mockland.gov/resource",
      fields: { id: "biz_number", name: "biz_legal_name" },
      quirks: { cities: ["Mocktown"] },
    },
    {
      id: "yy_cat",
      name: "Fictional category registry",
      plane: "category",
      driver: "static_shard",
      coverage: { geo: ["US"], naics: ["4244"] },
      endpoint: "",
      fields: { id: "id", name: "name" },
      quirks: { shardRegions: ["US-XX", "US-YY"] },
    },
  ],
};

describe("knownRegions / defaultRegion / regionCities over a fictional two-state manifest", () => {
  const sources = loadManifest(FICTIONAL_MANIFEST);

  it("knownRegions collects US-XX and US-YY", () => {
    expect(knownRegions(sources)).toEqual(["US-XX", "US-YY"]);
  });

  it("defaultRegion picks US-XX (first among existence sources)", () => {
    expect(defaultRegion(sources)).toBe("US-XX");
  });

  it("regionCities(.., US-YY) is empty — no source's coverage or shardRegions names it with cities", () => {
    expect(regionCities(sources, "US-YY")).toEqual([]);
  });

  it("regionCities(.., US-XX) is [\"mocktown\"]", () => {
    expect(regionCities(sources, "US-XX")).toEqual(["mocktown"]);
  });
});

describe("defaultRegion([]) throws", () => {
  it("throws when there is no region-level coverage in the manifest", () => {
    expect(() => defaultRegion([])).toThrow(/no region-level coverage/);
  });
});

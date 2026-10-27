import { describe, it, expect } from "vitest";
import { route } from "../../packages/registry-core/src/route.js";
import { SOURCES } from "../../packages/registry-core/src/sources/index.js";
import type { Intent, SourceSpec } from "../../packages/registry-core/src/driver.js";

function intent(overrides: Partial<Intent> = {}): Intent {
  return { naics: [], geo: { region: "US-CO", cities: [] }, direction: "sell", ...overrides };
}

function source(id: string, naics: string[], geo = ["US-CO"]): SourceSpec {
  return {
    id, name: id, plane: "category", driver: "static_shard",
    coverage: { geo, naics }, endpoint: "", fields: { id: "id", name: "name" },
  };
}

describe("route over the shipped manifest", () => {
  it("shipped manifest validates at load", () => {
    expect(SOURCES.map(s => s.id)).toEqual([
      "co_sos", "ct_sos", "ny_dos", "paca", "ppp", "epa_echo", "co_farm_products",
    ]);
  });

  it("produce wholesale query in CO routes to the * sources plus paca and the farm filings", () => {
    const picked = route(intent({ naics: ["424480"] }), SOURCES);
    expect(picked.map(s => s.id).sort()).toEqual(["co_sos", "epa_echo", "paca", "ppp"]);
  });

  it("crop farming query in CO also reaches the farm-products financing statements", () => {
    const picked = route(intent({ naics: ["111211"] }), SOURCES);
    expect(picked.map(s => s.id).sort()).toEqual(["co_farm_products", "co_sos", "epa_echo", "paca", "ppp"]);
  });

  it("jewelry query in CO routes only to the * sources (no category-specific source carries it)", () => {
    const picked = route(intent({ naics: ["339910"] }), SOURCES);
    expect(picked.map(s => s.id).sort()).toEqual(["co_sos", "epa_echo", "ppp"]);
  });

  it("produce query outside the shard regions routes to epa_echo only (no PACA/PPP shards there)", () => {
    const picked = route(intent({ naics: ["424480"], geo: { region: "US-WA", cities: [] } }), SOURCES);
    expect(picked.map(s => s.id).sort()).toEqual(["epa_echo"]);
  });

  it("a source whose quirks.shardRegions excludes the region is not routed", () => {
    const sharded: SourceSpec = { ...source("s", ["*"], ["US"]), quirks: { shardRegions: ["US-CO"] } };
    expect(route(intent({ geo: { region: "US-CO", cities: [] } }), [sharded])).toHaveLength(1);
    expect(route(intent({ geo: { region: "US-NY", cities: [] } }), [sharded])).toEqual([]);
  });

  it("US coverage covers subregions but not the other way around", () => {
    const usOnly: SourceSpec = { ...SOURCES[1]!, coverage: { geo: ["US-CO"], naics: ["*"] } };
    expect(route(intent({ geo: { region: "US", cities: [] } }), [usOnly])).toEqual([]);
  });

  it("produce query in NY routes to ny_dos, paca and epa_echo (PPP ships CO only)", () => {
    const picked = route(intent({ naics: ["424480"], geo: { region: "US-NY", cities: [] } }), SOURCES);
    expect(picked.map(s => s.id).sort()).toEqual(["epa_echo", "ny_dos", "paca"]);
  });
});

describe("route — NAICS prefix matching", () => {
  it("a prefix in coverage matches a longer query code, and the reverse", () => {
    expect(route(intent({ naics: ["332312"] }), [source("a", ["332"])]).map(s => s.id)).toEqual(["a"]);
    expect(route(intent({ naics: ["332"] }), [source("a", ["332312"])]).map(s => s.id)).toEqual(["a"]);
  });

  it("unrelated codes do not match", () => {
    expect(route(intent({ naics: ["333"] }), [source("a", ["332"])])).toEqual([]);
    expect(route(intent({ naics: ["332312"] }), [source("a", ["332999"])])).toEqual([]);
  });

  it("matches when any query code relates to any coverage code", () => {
    const picked = route(intent({ naics: ["722511", "424480"] }), [source("a", ["111", "4244"])]);
    expect(picked.map(s => s.id)).toEqual(["a"]);
  });

  it('"*" matches anything, including an empty query', () => {
    const star = source("star", ["*"]);
    expect(route(intent({ naics: ["332312"] }), [star])).toHaveLength(1);
    expect(route(intent({ naics: [] }), [star])).toHaveLength(1);
  });

  it("an empty intent.naics picks only * sources", () => {
    const picked = route(intent({ naics: [] }), [source("a", ["332"]), source("star", ["*"])]);
    expect(picked.map(s => s.id)).toEqual(["star"]);
  });
});

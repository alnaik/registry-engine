import { describe, it, expect } from "vitest";
import { route } from "../../packages/registry-core/src/route.js";
import { SOURCES } from "../../packages/registry-core/src/sources/index.js";
import type { Intent, SourceSpec } from "../../packages/registry-core/src/driver.js";

function intent(overrides: Partial<Intent> = {}): Intent {
  return { categories: [], geo: { region: "US-CO", cities: [] }, direction: "sell", ...overrides };
}

describe("route over the shipped manifest", () => {
  it("shipped manifest validates at load", () => {
    expect(SOURCES.map(s => s.id)).toEqual(["co_sos", "ct_sos", "ny_dos", "paca"]);
  });

  it("produce query in CO routes to both co_sos and paca", () => {
    const picked = route(intent({ categories: ["produce"] }), SOURCES);
    expect(picked.map(s => s.id).sort()).toEqual(["co_sos", "paca"]);
  });

  it("jewelry query in CO routes to co_sos only (no category source carries it)", () => {
    const picked = route(intent({ categories: ["jewelry"] }), SOURCES);
    expect(picked.map(s => s.id)).toEqual(["co_sos"]);
  });

  it("produce query outside CO routes to paca only", () => {
    const picked = route(intent({ categories: ["produce"], geo: { region: "US-WA", cities: [] } }), SOURCES);
    expect(picked.map(s => s.id)).toEqual(["paca"]);
  });

  it("US coverage covers subregions but not the other way around", () => {
    const usOnly: SourceSpec = { ...SOURCES[1]!, coverage: { geo: ["US-CO"], categories: ["*"] } };
    expect(route(intent({ geo: { region: "US", cities: [] } }), [usOnly])).toEqual([]);
  });

  it("produce query in NY routes to ny_dos and paca", () => {
    const picked = route(intent({ categories: ["produce"], geo: { region: "US-NY", cities: [] } }), SOURCES);
    expect(picked.map(s => s.id).sort()).toEqual(["ny_dos", "paca"]);
  });
});

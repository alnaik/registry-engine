import { describe, it, expect } from "vitest";
import { summaryLines } from "../../apps/cli/src/summary.js";
import type { Lead } from "../../packages/qualify/src/verbs/brief.js";

function lead(naics: string[], web: Lead["web"]): Lead {
  return {
    entity: {
      id: `x:${naics.join("")}${web}`, name: "Acme", names: [], status: "", address: {}, officers: [],
      naics, contacts: [], source_ids: ["ppp"], evidence: [],
    },
    score: 0, probe: undefined, web, brief: "", opener: "", searchUrl: null,
  };
}

describe("summaryLines", () => {
  it("counts coded leads by relation to the map codes, the rest as name matches", () => {
    const ranked = [lead(["332312"], "none"), lead(["33"], "verified"), lead(["722511"], "none"), lead([], "unresolved")];
    expect(summaryLines(ranked, ["332"])).toEqual([
      "Found 4 businesses: 2 with an industry code for this request, 2 name matches only (lower confidence).",
      "2 have no website listed in the records searched — each has a search link.",
    ]);
  });
});

import { describe, it, expect } from "vitest";
import { summaryLines } from "../../packages/qualify/src/summary.js";
import type { Lead } from "../../packages/qualify/src/verbs/brief.js";

function lead(naics: string[], web: Lead["web"]): Lead {
  return {
    entity: {
      id: `x:${naics.join("")}${web}`, name: "Acme", names: [], status: "", address: {}, officers: [],
      naics, contacts: [], source_ids: ["ppp"], evidence: [],
    },
    score: 0, probe: undefined, web, brief: "", opener: "", searchUrl: null, distanceMi: null, band: "",
  };
}

describe("summaryLines", () => {
  it("counts coded leads by relation to the map codes, the rest as name matches", () => {
    const ranked = [lead(["332312"], "none"), lead(["33"], "verified"), lead(["722511"], "none"), lead([], "unresolved")];
    expect(summaryLines(ranked, ["332"])).toEqual([
      "Found 2 businesses with an industry code for this request (+2 name matches, lower confidence)",
      "2 have no website listed in the records searched — business records get a search link.",
    ]);
  });

  it("counts individuals' records apart from businesses", () => {
    const person = lead(["332312"], "none");
    person.entity = { ...person.entity, name: "SMITH, JOHN A" };
    expect(summaryLines([lead(["332312"], "none"), person], ["332"])).toEqual([
      "Found 1 businesses with an industry code for this request (+1 individuals' records, listed separately)",
    ]);
  });

  it("omits the name-match clause when there are none, and the no-website line when it is true of all", () => {
    const ranked = [lead(["332312"], "none"), lead(["33"], "none")];
    expect(summaryLines(ranked, ["332"])).toEqual(["Found 2 businesses with an industry code for this request"]);
  });
});

describe("sheetCounts / hasPhone", () => {
  it("counts over coded businesses only: radius, confirmed, phones; individuals apart", async () => {
    const { sheetCounts, hasPhone } = await import("../../packages/qualify/src/summary.js");
    const a = { ...lead(["332312"], "none"), distanceMi: 4, registryCheck: "matched" as const };
    a.entity = { ...a.entity, contacts: ["(303) 555-0100"] };
    const b = { ...lead(["332"], "none"), distanceMi: 40, registryCheck: "not_checked" as const, found: { status: "found", provider: "exa", phone: "303-555-0199", listings: [], sourceUrls: [] } as unknown as Lead["found"] };
    const c = { ...lead(["332312"], "none"), distanceMi: null, registryCheck: "checked_not_found" as const };
    const d = { ...lead([], "none"), distanceMi: 1, registryCheck: "matched" as const };
    d.entity = { ...d.entity, contacts: ["555 0100"] };
    expect(hasPhone(a)).toBe(true);
    expect(hasPhone(b)).toBe(true);
    expect(hasPhone(d)).toBe(false);
    c.entity = { ...c.entity, name: "SMITH, JOHN A" };
    const c2 = { ...c, registryCheck: "matched" as const };
    const counts = sheetCounts([a, b, c2, d], ["332"], { radiusMi: 25, hasOrigin: true });
    // the individual's record (c2) is matched but counts only as an individual
    expect(counts).toEqual({ total: 4, coded: 3, businesses: 2, listed: 2, nameOnly: 1, individuals: 1, withinRadius: 1, radiusMi: 25, confirmed: 1, withPhone: 2 });
    expect(sheetCounts([a, b], ["332"], { radiusMi: 25, hasOrigin: true, listCap: 1 }).listed).toBe(1);
    expect(sheetCounts([a], ["332"], { radiusMi: 25, hasOrigin: false }).withinRadius).toBeNull();
  });
});

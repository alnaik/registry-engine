import { describe, it, expect } from "vitest";
import { naicsTitle, naicsLabel, isNaicsCode, naicsIndex, naicsRelated, lookupCodes } from "../../packages/registry-core/src/naics.js";

describe("naics lookup", () => {
  it("titles known codes at several levels", () => {
    expect(naicsTitle("332312")).toBe("Fabricated Structural Metal Manufacturing");
    expect(naicsTitle("332")).toBe("Fabricated Metal Product Manufacturing");
    expect(naicsTitle("999999")).toBeUndefined();
  });

  it("naicsLabel falls back to the longest prefix with a title", () => {
    expect(naicsLabel("332312")).toBe("Fabricated Structural Metal Manufacturing");
    expect(naicsTitle("323110")).toBeUndefined();   // a 2022 code, absent from the 2017 table
    expect(naicsLabel("323110")).toBe("Printing");
    expect(naicsLabel("99")).toBeUndefined();
    expect(isNaicsCode("323110")).toBe(false);
  });

  it("expands sector ranges like 31-33", () => {
    expect(naicsTitle("31")).toBe("Manufacturing");
    expect(naicsTitle("33")).toBe("Manufacturing");
  });

  it("isNaicsCode needs digits AND a real code", () => {
    expect(isNaicsCode("332312")).toBe(true);
    expect(isNaicsCode("999999")).toBe(false);
    expect(isNaicsCode("33a")).toBe(false);
    expect(isNaicsCode("3")).toBe(false);
    expect(isNaicsCode("constructor")).toBe(false);
  });

  it("naicsIndex lists 6-digit code/description pairs", () => {
    const index = naicsIndex();
    expect(index.length).toBeGreaterThan(10000);
    expect(index.every(([code]) => /^\d{6}$/.test(code))).toBe(true);
  });

  it("naicsRelated is true when one code prefixes the other", () => {
    expect(naicsRelated("332", "332312")).toBe(true);
    expect(naicsRelated("332312", "332")).toBe(true);
    expect(naicsRelated("332312", "332312")).toBe(true);
    expect(naicsRelated("332", "333")).toBe(false);
  });
});

describe("lookupCodes", () => {
  it("ranks entries matching every stem first and dedupes by code", () => {
    const hits = lookupCodes(["CANVAS", "bag"]);
    expect(hits.map(h => h.code)).toContain("314910");
    expect(new Set(hits.map(h => h.code)).size).toBe(hits.length);
    const top = hits[0]!;
    expect(`${top.description} ${top.title}`.toLowerCase()).toContain("canva");
    expect(`${top.description} ${top.title}`.toLowerCase()).toContain("bag");
    for (const h of hits) expect(h.title).not.toBe("");
  });

  it("stems query words so its own examples work", () => {
    const fab = lookupCodes(["metal", "fabrication"]).slice(0, 5).map(h => h.code);
    expect(fab.some(c => c === "332312" || c === "332322")).toBe(true);
    expect(lookupCodes(["hot", "sauce"]).map(h => h.code)).toContain("311941");
    expect(lookupCodes(["canvas", "bag"]).map(h => h.code)).toContain("314910");
  });

  it("honors max and returns [] for no words or no matches", () => {
    expect(lookupCodes(["metal"], 3).length).toBeLessThanOrEqual(3);
    expect(lookupCodes([])).toEqual([]);
    expect(lookupCodes(["zzzzqqqq"])).toEqual([]);
  });
});

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

  it("matches stems only at a word start", () => {
    const codes = lookupCodes(["canvas", "bag"]).map(h => h.code);
    expect(codes).not.toContain("111219");
    expect(codes).not.toContain("236210");
    expect(codes[0]).toBe("314910");
    const fab = lookupCodes(["metal", "fabrication"]).map(h => h.code);
    expect(fab.some(c => c === "332312" || c === "332322")).toBe(true);
  });

  it("short stems must end the word: no bakeries or bagasse for bag", () => {
    const codesOf = (q: string) => lookupCodes(q.split(" ")).map(h => h.code);
    const titlesOf = (q: string) => lookupCodes(q.split(" ")).map(h => h.title);
    const canvasBag = lookupCodes(["canvas", "bag"]);
    expect(canvasBag[0]!.code).toBe("314910");
    for (const h of canvasBag) expect(h.title).not.toMatch(/baker|pulp/i);
    for (const t of titlesOf("bag")) expect(t).not.toMatch(/baker|pulp/i);
    expect(codesOf("bag")).toEqual(expect.arrayContaining(["314910", "322220", "326111"]));
    expect(codesOf("hot sauce")).toContain("311941");
    for (const t of titlesOf("hot sauce")) expect(t).not.toMatch(/hotel|casino/i);
    const tote = codesOf("sew tote bags");
    expect(tote.slice(0, 5)).not.toContain("221320");
    expect(tote.slice(0, 5)).not.toContain("237110");
    expect(tote).toEqual(expect.arrayContaining(["315210", "314910"]));
    expect(codesOf("machining")).toContain("332710");
    expect(codesOf("welding")).toContain("333992");
    expect(codesOf("welders")).toContain("333992");
    expect(codesOf("bakeries")).toEqual(expect.arrayContaining(["311811", "311812"]));
    expect(codesOf("bakery")).toContain("311811");
    expect(codesOf("brewery")).toContain("312120");
    expect(codesOf("printing")).toContain("323111");
    expect(codesOf("gasoline")).toContain("447110");
  });

  it("honors max and returns [] for no words or no matches", () => {
    expect(lookupCodes(["metal"], 3).length).toBeLessThanOrEqual(3);
    expect(lookupCodes([])).toEqual([]);
    expect(lookupCodes(["zzzzqqqq"])).toEqual([]);
  });
});

describe("naicsPhrase", () => {
  it("rewrites titles as plain sentence fragments", async () => {
    const { naicsPhrase } = await import("../../packages/registry-core/src/naics.js");
    expect(naicsPhrase("Textile Bag and Canvas Mills")).toBe("Makes textile bag and canvas products");
    expect(naicsPhrase("Fabricated Structural Metal Manufacturing")).toBe("Makes fabricated structural metal");
    expect(naicsPhrase("Cut and Sew Apparel Contractors")).toBe("Cut and sew apparel contractor");
    expect(naicsPhrase("Fresh Fruit and Vegetable Merchant Wholesalers")).toBe("Fresh fruit and vegetable wholesaler");
    expect(naicsPhrase("Supermarkets and Other Grocery (except Convenience) Stores")).toBe("Runs supermarkets and grocery stores");
    expect(naicsPhrase("Full-Service Restaurants")).toBe("Runs a full-service restaurant");
    expect(naicsPhrase("Potato Farming")).toBe("Runs a potato farm");
    expect(naicsPhrase("Beef Cattle Ranching and Farming")).toBe("Beef cattle ranching and farming");
    expect(naicsPhrase("Janitorial Services")).toBe("Provides janitorial services");
    expect(naicsPhrase("All Other Miscellaneous Textile Product Mills")).toBe("Makes miscellaneous textile products");
    expect(naicsPhrase("")).toBe("");
  });
});

import { describe, it, expect } from "vitest";
import { naicsTitle, isNaicsCode, naicsIndex, naicsRelated } from "../../packages/registry-core/src/naics.js";

describe("naics lookup", () => {
  it("titles known codes at several levels", () => {
    expect(naicsTitle("332312")).toBe("Fabricated Structural Metal Manufacturing");
    expect(naicsTitle("332")).toBe("Fabricated Metal Product Manufacturing");
    expect(naicsTitle("999999")).toBeUndefined();
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

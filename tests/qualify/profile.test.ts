import { describe, it, expect } from "vitest";
import { validateProfile } from "../../packages/qualify/src/profiles/schema.js";
import { applyFeedback } from "../../packages/qualify/src/profiles/feedback.js";
import { readFileSync } from "fs";
import { join } from "path";

describe("validateProfile", () => {
  it("validates the diamond-prospect starter", () => {
    const raw = JSON.parse(readFileSync(
      join(import.meta.dirname, "../../packages/qualify/src/profiles/starters/diamond-prospect.json"),
      "utf-8"
    )) as unknown;
    const profile = validateProfile(raw);
    expect(profile.id).toBe("diamond-prospect-v1");
    expect(profile.direction).toBe("find_customers");
  });

  it("validates all three starters", () => {
    const files = ["diamond-prospect.json", "supplier-search.json", "event-vendor.json"];
    for (const file of files) {
      const raw = JSON.parse(readFileSync(
        join(import.meta.dirname, `../../packages/qualify/src/profiles/starters/${file}`),
        "utf-8"
      )) as unknown;
      expect(() => validateProfile(raw)).not.toThrow();
    }
  });

  it("rejects invalid direction", () => {
    expect(() => validateProfile({ id: "x", name: "x", direction: "wrong", description: "x", mustHave: [], niceToHave: [], exclude: [], feedback: { approvedTraits: [], rejectedTraits: [] }, version: "1" })).toThrow();
  });
});

describe("applyFeedback", () => {
  it("adds approved trait and bumps version", () => {
    const raw = JSON.parse(readFileSync(
      join(import.meta.dirname, "../../packages/qualify/src/profiles/starters/diamond-prospect.json"),
      "utf-8"
    )) as unknown;
    const profile = validateProfile(raw);
    const updated = applyFeedback(profile, { entityId: "1", entityName: "Test", verdict: "approved", rationale: "sells loose diamonds" });
    expect(updated.feedback.approvedTraits).toContain("sells loose diamonds");
    expect(parseInt(updated.version, 10)).toBeGreaterThan(parseInt(profile.version, 10));
  });

  it("caps feedback arrays at 10 items", () => {
    let p = validateProfile(JSON.parse(readFileSync(
      join(import.meta.dirname, "../../packages/qualify/src/profiles/starters/diamond-prospect.json"),
      "utf-8"
    ) as string) as unknown);
    for (let i = 0; i < 15; i++) {
      p = applyFeedback(p, { entityId: String(i), entityName: "T", verdict: "approved", rationale: `trait ${i}` });
    }
    expect(p.feedback.approvedTraits.length).toBeLessThanOrEqual(10);
  });
});

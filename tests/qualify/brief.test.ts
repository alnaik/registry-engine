import { describe, it, expect } from "vitest";
import { assembleBrief } from "../../packages/qualify/src/pipeline/brief.js";
import type { VerifiedLead } from "../../packages/qualify/src/pipeline/verify.js";
import type { NormalizedEntity } from "@registry-engine/registry-core";

function makeEntity(formDate: string): NormalizedEntity {
  return {
    id: "123", name: "Vivid Gems LLC", status: "Good Standing", type: "DLLC",
    formDate, zipCode: "80202",
    city: "Denver", state: "CO", address: "500 16th St",
    jurisdiction: "CO",
    agent: { firstName: "Jane", lastName: "Smith" },
    tradeNames: [{ id: "t1", description: "Denver Diamond Works", dateAdded: "", effectiveDate: "" }],
    source: { provider: "colorado-sos", datasetId: "4ykn-tg5h", fetchedAt: "" },
  };
}

describe("assembleBrief", () => {
  it("includes entity facts and verification results for a verified lead", () => {
    const lead: VerifiedLead = {
      entity: makeEntity("2020-06-01T00:00:00.000"),
      score: 82, rationale: "Custom jeweler focused on loose stones",
      webPresence: "found", contact: "info@vividgems.com",
      sells: "diamonds", buys: "rough stones", verified: true,
    };
    const brief = assembleBrief(lead);
    expect(brief.text).toContain("Vivid Gems LLC");
    expect(brief.text).toContain("82/100");
    expect(brief.text).toContain("Denver Diamond Works");
    expect(brief.text).toContain("registered agent");
    expect(brief.outreachDraft).toBeNull();
  });

  it("marks unverified leads as name-level matches only", () => {
    const lead: VerifiedLead = {
      entity: makeEntity("2020-06-01T00:00:00.000"),
      score: 0, rationale: "", webPresence: "none", contact: null,
      sells: "", buys: "", verified: false,
    };
    const brief = assembleBrief(lead);
    expect(brief.text).toContain("Not yet verified");
    expect(brief.text).not.toContain("/100");
  });

  it("notes recent registration as a timing signal", () => {
    const recent = new Date();
    recent.setDate(recent.getDate() - 20);
    const lead: VerifiedLead = {
      entity: makeEntity(recent.toISOString()),
      score: 50, rationale: "ok", webPresence: "none", contact: null,
      sells: "", buys: "", verified: true,
    };
    const brief = assembleBrief(lead);
    expect(brief.text).toContain("days ago");
  });
});

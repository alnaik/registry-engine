import { describe, it, expect } from "vitest";
import { assembleDossier } from "../../packages/qualify/src/pipeline/dossier.js";
import type { QualifiedLead } from "../../packages/qualify/src/pipeline/qualifyLead.js";
import type { NormalizedEntity } from "@registry-engine/registry-core";

function makeEntity(): NormalizedEntity {
  return {
    id: "123", name: "Vivid Gems LLC", status: "Good Standing", type: "DLLC",
    formDate: "2026-06-01T00:00:00.000", zipCode: "80202",
    city: "Denver", state: "CO", address: "500 16th St",
    jurisdiction: "CO",
    agent: { firstName: "Jane", lastName: "Smith" },
    tradeNames: [{ id: "t1", description: "Denver Diamond Works", dateAdded: "", effectiveDate: "" }],
    source: { provider: "colorado-sos", datasetId: "4ykn-tg5h", fetchedAt: "" },
  };
}

describe("assembleDossier", () => {
  it("includes entity name and score in brief", () => {
    const lead: QualifiedLead = {
      entity: makeEntity(), score: 82, rationale: "Custom jeweler focused on loose stones",
      webPresence: "found", contact: "info@vividgems.com", sells: "diamonds", buys: "rough stones",
      signals: [{ type: "NEW_FILING", entityId: "123", entityName: "Vivid Gems LLC", date: "2026-06-01T00:00:00.000", summary: "Registered 36 days ago" }],
      profileId: "diamond-prospect-v1",
    };
    const dossier = assembleDossier(lead);
    expect(dossier.brief).toContain("Vivid Gems LLC");
    expect(dossier.brief).toContain("82/100");
    expect(dossier.brief).toContain("Denver Diamond Works");
    expect(dossier.brief).toContain("Registered 36 days ago");
    expect(dossier.outreachDraft).toBeNull();
  });
});

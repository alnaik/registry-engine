import { describe, it, expect } from "vitest";
import { applyPatterns, fetchPatterns } from "../../packages/qualify/src/pipeline/prefilter.js";
import { TokenBudgeter } from "../../packages/qualify/src/llm/budgeter.js";
import type { LlmBackend, LlmRequest, LlmResponse } from "../../packages/qualify/src/llm/LlmBackend.js";
import type { NormalizedEntity } from "@registry-engine/registry-core";
import type { QualificationProfile } from "../../packages/qualify/src/profiles/schema.js";

const mockProfile: QualificationProfile = {
  id: "test", name: "Test", direction: "find_customers",
  description: "Independent jewelers",
  mustHave: ["jewel", "gem", "diamond"],
  niceToHave: ["custom", "estate"],
  exclude: ["pawn"],
  feedback: { approvedTraits: [], rejectedTraits: [] },
  version: "1",
};

function makeEntity(name: string, tradeDesc?: string): NormalizedEntity {
  return {
    id: name, name, status: "Good Standing", type: "DLLC",
    formDate: "2020-01-01T00:00:00.000", zipCode: "80202",
    city: "Denver", state: "CO", address: "123 Main St",
    jurisdiction: "CO", agent: {}, tradeNames: tradeDesc ? [{ id: "1", description: tradeDesc, dateAdded: "", effectiveDate: "" }] : [],
    source: { provider: "colorado-sos", datasetId: "4ykn-tg5h", fetchedAt: "" },
  };
}

describe("applyPatterns", () => {
  it("includes entities matching include patterns", () => {
    const entity = makeEntity("Vivid Gems LLC");
    const result = applyPatterns([entity], {
      includePatterns: ["gem", "jewel"],
      excludePatterns: ["pawn"],
      ambiguousOk: true,
    });
    expect(result.included).toHaveLength(1);
    expect(result.excluded).toHaveLength(0);
  });

  it("excludes entities matching exclude patterns", () => {
    const entity = makeEntity("Quick Pawn Shop LLC");
    const result = applyPatterns([entity], {
      includePatterns: ["gem"],
      excludePatterns: ["pawn"],
      ambiguousOk: true,
    });
    expect(result.excluded).toHaveLength(1);
    expect(result.included).toHaveLength(0);
  });

  it("moves ambiguous entities to ambiguous bucket when ambiguousOk", () => {
    const entity = makeEntity("Mystery Holdings LLC");
    const result = applyPatterns([entity], {
      includePatterns: ["gem"],
      excludePatterns: ["pawn"],
      ambiguousOk: true,
    });
    expect(result.ambiguous).toHaveLength(1);
  });

  it("excludes ambiguous entities when ambiguousOk is false", () => {
    const entity = makeEntity("Mystery Holdings LLC");
    const result = applyPatterns([entity], {
      includePatterns: ["gem"],
      excludePatterns: ["pawn"],
      ambiguousOk: false,
    });
    expect(result.excluded).toHaveLength(1);
    expect(result.ambiguous).toHaveLength(0);
  });
});

describe("fetchPatterns — prompt budget", () => {
  it("prefilter user message fits well under budget", async () => {
    const backend: LlmBackend = {
      async call(req: LlmRequest): Promise<LlmResponse> {
        const totalChars = (req.system?.length ?? 0) + req.messages.reduce((s, m) => s + m.content.length, 0);
        expect(totalChars).toBeLessThan(2000);
        return {
          content: JSON.stringify({ includePatterns: ["gem"], excludePatterns: ["pawn"], ambiguousOk: true }),
          usage: { inputTokens: 80, outputTokens: 30 },
          stopReason: "end_turn",
        };
      },
    };
    const budgeter = new TokenBudgeter(backend, {});
    const patterns = await fetchPatterns(mockProfile, budgeter);
    expect(patterns.includePatterns).toContain("gem");
  });
});

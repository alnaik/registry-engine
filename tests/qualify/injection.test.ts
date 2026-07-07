import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { TokenBudgeter } from "../../packages/qualify/src/llm/budgeter.js";
import { qualifyLead } from "../../packages/qualify/src/pipeline/qualifyLead.js";
import type { LlmBackend, LlmRequest, LlmResponse } from "../../packages/qualify/src/llm/LlmBackend.js";
import type { NormalizedEntity } from "@registry-engine/registry-core";
import type { QualificationProfile } from "../../packages/qualify/src/profiles/schema.js";

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, "../fixtures/injection-attempt.json"), "utf-8")
) as { injectedModelOutput: string; adversarialWebContent: string };

function makeEntity(): NormalizedEntity {
  return {
    id: "test-123", name: "Acme LLC", status: "Good Standing", type: "DLLC",
    formDate: "2024-01-01T00:00:00.000", zipCode: "80202",
    city: "Denver", state: "CO", address: "1 Main St",
    jurisdiction: "CO", agent: {}, tradeNames: [],
    source: { provider: "colorado-sos", datasetId: "4ykn-tg5h", fetchedAt: "" },
  };
}

const mockProfile: QualificationProfile = {
  id: "p1", name: "Test", direction: "find_customers",
  description: "jewelers", mustHave: ["jewel"], niceToHave: [], exclude: [],
  feedback: { approvedTraits: [], rejectedTraits: [] }, version: "1",
};

function injectedBackend(): LlmBackend {
  return {
    async call(_req: LlmRequest): Promise<LlmResponse> {
      return {
        content: fixture.injectedModelOutput,
        usage: { inputTokens: 100, outputTokens: 50 },
        stopReason: "end_turn",
      };
    },
  };
}

describe("prompt injection resilience", () => {
  it("clamps score to 100 even when model returns 999", async () => {
    const budgeter = new TokenBudgeter(injectedBackend(), {});
    const lead = await qualifyLead(makeEntity(), mockProfile, [], budgeter);
    expect(lead.score).toBeLessThanOrEqual(100);
    expect(lead.score).toBeGreaterThanOrEqual(0);
  });

  it("caps rationale at 200 chars regardless of model output length", async () => {
    const budgeter = new TokenBudgeter(injectedBackend(), {});
    const lead = await qualifyLead(makeEntity(), mockProfile, [], budgeter);
    expect(lead.rationale.length).toBeLessThanOrEqual(200);
  });

  it("caps contact at 200 chars regardless of model output length", async () => {
    const budgeter = new TokenBudgeter(injectedBackend(), {});
    const lead = await qualifyLead(makeEntity(), mockProfile, [], budgeter);
    expect(lead.contact === null || (lead.contact.length <= 200)).toBe(true);
  });

  it("drops unknown keys — only known fields present on output", async () => {
    const budgeter = new TokenBudgeter(injectedBackend(), {});
    const lead = await qualifyLead(makeEntity(), mockProfile, [], budgeter);
    const ALLOWED_KEYS = new Set(["entity", "score", "rationale", "webPresence", "contact", "sells", "buys", "signals", "profileId", "uccRelationships"]);
    for (const key of Object.keys(lead)) {
      expect(ALLOWED_KEYS.has(key)).toBe(true);
    }
  });

  it("does not pollute Object prototype via injected __proto__", async () => {
    const budgeter = new TokenBudgeter(injectedBackend(), {});
    await qualifyLead(makeEntity(), mockProfile, [], budgeter);
    expect((Object.prototype as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("webPresence only accepts 'found' or 'none' — never arbitrary strings", async () => {
    const backend: LlmBackend = {
      async call(): Promise<LlmResponse> {
        return {
          content: JSON.stringify({ score: 50, rationale: "ok", webPresence: "hacked", contact: null, sells: "", buys: "" }),
          usage: { inputTokens: 10, outputTokens: 10 },
          stopReason: "end_turn",
        };
      },
    };
    const budgeter = new TokenBudgeter(backend, {});
    const lead = await qualifyLead(makeEntity(), mockProfile, [], budgeter);
    expect(lead.webPresence === "found" || lead.webPresence === "none").toBe(true);
  });

  it("preserves entity signals regardless of model output", async () => {
    const signals = [{ type: "NEW_FILING" as const, entityId: "test-123", entityName: "Acme LLC", date: "2026-01-01T00:00:00.000", summary: "Registered 5 days ago" }];
    const budgeter = new TokenBudgeter(injectedBackend(), {});
    const lead = await qualifyLead(makeEntity(), mockProfile, signals, budgeter);
    expect(lead.signals).toHaveLength(1);
    expect(lead.signals[0]?.type).toBe("NEW_FILING");
  });
});

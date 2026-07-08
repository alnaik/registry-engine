import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseVerifyResponse } from "../../packages/qualify/src/pipeline/verify.js";
import type { NormalizedEntity } from "@registry-engine/registry-core";

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, "../fixtures/injection-attempt.json"), "utf-8")
) as { injectedModelOutput: string };

function makeEntity(): NormalizedEntity {
  return {
    id: "test-123", name: "Acme LLC", status: "Good Standing", type: "DLLC",
    formDate: "2024-01-01T00:00:00.000", zipCode: "80202",
    city: "Denver", state: "CO", address: "1 Main St",
    jurisdiction: "CO", agent: {}, tradeNames: [],
    source: { provider: "colorado-sos", datasetId: "4ykn-tg5h", fetchedAt: "" },
  };
}

// The verify stage's output parser is the trust boundary: a model response
// influenced by adversarial web content must not escape these constraints.
describe("prompt injection resilience", () => {
  const lead = parseVerifyResponse(fixture.injectedModelOutput, makeEntity());

  it("clamps score to 100 even when model returns 999", () => {
    expect(lead.score).toBeLessThanOrEqual(100);
    expect(lead.score).toBeGreaterThanOrEqual(0);
  });

  it("caps rationale at 200 chars regardless of model output length", () => {
    expect(lead.rationale.length).toBeLessThanOrEqual(200);
  });

  it("caps contact at 200 chars regardless of model output length", () => {
    expect(lead.contact === null || lead.contact.length <= 200).toBe(true);
  });

  it("drops unknown keys — only known fields present on output", () => {
    const ALLOWED_KEYS = new Set(["entity", "score", "rationale", "webPresence", "contact", "sells", "buys", "verified"]);
    for (const key of Object.keys(lead)) {
      expect(ALLOWED_KEYS.has(key)).toBe(true);
    }
  });

  it("does not pollute Object prototype via injected __proto__", () => {
    expect((Object.prototype as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("webPresence only accepts 'found' or 'none' — never arbitrary strings", () => {
    const hacked = parseVerifyResponse(
      JSON.stringify({ score: 50, rationale: "ok", webPresence: "hacked", contact: null, sells: "", buys: "" }),
      makeEntity()
    );
    expect(hacked.webPresence === "found" || hacked.webPresence === "none").toBe(true);
  });

  it("unparseable output degrades to a zero-score verified lead", () => {
    const garbage = parseVerifyResponse("I refuse to output JSON", makeEntity());
    expect(garbage.score).toBe(0);
    expect(garbage.verified).toBe(true);
  });
});

import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";
import { normalizeEntity } from "../../packages/registry-core/src/sources/colorado/normalize.js";

const raw = JSON.parse(
  readFileSync(join(import.meta.dirname, "../fixtures/entities-good-standing.json"), "utf-8")
) as Record<string, unknown>[];

describe("normalizeEntity", () => {
  it("maps all required fields", () => {
    const entity = normalizeEntity(raw[0]!, new Date().toISOString());
    expect(entity.id).toBeTruthy();
    expect(entity.name).toBeTruthy();
    expect(entity.status).toBe("Good Standing");
    expect(entity.zipCode).toBeTruthy();
    expect(entity.source.provider).toBe("colorado-sos");
  });

  it("returns empty tradeNames array", () => {
    const entity = normalizeEntity(raw[0]!, new Date().toISOString());
    expect(entity.tradeNames).toEqual([]);
  });

  it("maps agent fields for individual-agent entities", () => {
    // Second fixture entity has agentfirstname / agentlastname
    const entity = normalizeEntity(raw[1]!, new Date().toISOString());
    expect(entity.agent.firstName).toBeTruthy();
    expect(entity.agent.lastName).toBeTruthy();
  });

  it("maps agent orgName for org-agent entities", () => {
    // Third fixture entity has agentorganizationname
    const entity = normalizeEntity(raw[2]!, new Date().toISOString());
    expect(entity.agent.orgName).toBeTruthy();
  });

  it("maps source metadata correctly", () => {
    const fetchedAt = new Date().toISOString();
    const entity = normalizeEntity(raw[0]!, fetchedAt);
    expect(entity.source.provider).toBe("colorado-sos");
    expect(entity.source.datasetId).toBe("4ykn-tg5h");
    expect(entity.source.fetchedAt).toBe(fetchedAt);
  });
});

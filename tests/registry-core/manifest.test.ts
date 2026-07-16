import { describe, it, expect } from "vitest";
import { loadManifest, ManifestError } from "../../packages/registry-core/src/manifest.js";

function validSource(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "mock_sos",
    name: "Mockland Secretary of State",
    plane: "existence",
    driver: "socrata",
    coverage: { geo: ["US-XX"], categories: ["*"] },
    endpoint: "https://data.mockland.gov/resource/abcd-1234.json",
    fields: { id: "entityid", name: "entityname", status: "entitystatus", city: "principalcity" },
    ...overrides,
  };
}

describe("loadManifest", () => {
  it("parses a valid manifest", () => {
    const specs = loadManifest({ sources: [validSource()] });
    expect(specs).toHaveLength(1);
    expect(specs[0]!.id).toBe("mock_sos");
    expect(specs[0]!.coverage.geo).toEqual(["US-XX"]);
  });

  it("accepts optional contact_fields and quirks", () => {
    const specs = loadManifest({
      sources: [validSource({ contact_fields: ["email"], quirks: { statusValue: "GOOD" } })],
    });
    expect(specs[0]!.contact_fields).toEqual(["email"]);
    expect(specs[0]!.quirks).toEqual({ statusValue: "GOOD" });
  });

  it("rejects a non-object manifest", () => {
    expect(() => loadManifest([])).toThrow(ManifestError);
  });

  it("rejects unknown driver", () => {
    expect(() => loadManifest({ sources: [validSource({ driver: "graphql" })] })).toThrow(/driver/);
  });

  it("rejects unknown plane", () => {
    expect(() => loadManifest({ sources: [validSource({ plane: "vibes" })] })).toThrow(/plane/);
  });

  it("rejects empty coverage.geo", () => {
    expect(() => loadManifest({ sources: [validSource({ coverage: { geo: [], categories: ["*"] } })] }))
      .toThrow(/coverage\.geo/);
  });

  it("rejects a missing fields.name mapping", () => {
    expect(() => loadManifest({ sources: [validSource({ fields: { id: "entityid" } })] }))
      .toThrow(/fields\.name/);
  });

  it("rejects duplicate source ids", () => {
    expect(() => loadManifest({ sources: [validSource(), validSource()] })).toThrow(/duplicate/);
  });

  it("rejects empty endpoint except for static_shard", () => {
    expect(() => loadManifest({ sources: [validSource({ endpoint: "" })] })).toThrow(/endpoint/);
    const specs = loadManifest({ sources: [validSource({ endpoint: "", driver: "static_shard" })] });
    expect(specs[0]!.driver).toBe("static_shard");
  });
});

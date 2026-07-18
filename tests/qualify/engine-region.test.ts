import { describe, it, expect, vi, afterEach } from "vitest";
import { loadManifest } from "../../packages/registry-core/src/manifest.js";
import { search } from "../../packages/qualify/src/engine.js";

// Fictional US-XX manifest, modeled on the zero-code-state socket test:
// proves --region flows end-to-end (map -> route -> fetch) purely from
// manifest data, with no LLM call.

const MOCKLAND_MANIFEST = {
  sources: [
    {
      id: "xx_sos",
      name: "Mockland Secretary of State",
      plane: "existence",
      driver: "socrata",
      coverage: { geo: ["US-XX"], categories: ["*"] },
      endpoint: "https://data.mockland.gov/resource",
      fields: {
        id: "biz_number",
        name: "biz_legal_name",
        status: "standing",
        city: "office_city",
        state: "office_state",
        zip: "office_postal",
        officer: "registered_agent",
      },
      quirks: { datasetId: "zzzz-9999", statusValue: "ACTIVE", cities: ["Mocktown"] },
    },
  ],
};

const MOCKLAND_ROWS = [
  {
    biz_number: "MX-100",
    biz_legal_name: "MOCKTOWN JEWELERS LLC",
    standing: "ACTIVE",
    office_city: "Mocktown",
    office_state: "XX",
    office_postal: "99999",
    registered_agent: "Minnie Mock",
  },
];

afterEach(() => vi.unstubAllGlobals());

function stubFetch(): void {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () =>
      decodeURIComponent(url).includes("upper(biz_legal_name) LIKE '%JEWEL%'") ? MOCKLAND_ROWS : [],
  }) as unknown as Response));
}

describe("engine — region flows from manifest, zero-token path", () => {
  it("search() with an explicit region routes and returns the Mockland lead", async () => {
    const sources = loadManifest(MOCKLAND_MANIFEST);
    stubFetch();

    const out = await search("jewelers in mocktown", { sources, region: "US-XX", probeLimit: 0 });

    expect(out.map.intent.geo).toEqual({ region: "US-XX", cities: ["Mocktown"] });
    expect(out.routed).toHaveLength(1);
    expect(out.routed[0]!.id).toBe("xx_sos");
    expect(out.leads[0]!.entity.name).toBe("MOCKTOWN JEWELERS LLC");
    expect(out.llmCalls).toBe(0);
  });

  it("search() with region omitted derives it from the manifest via defaultRegion", async () => {
    const sources = loadManifest(MOCKLAND_MANIFEST);
    stubFetch();

    const out = await search("jewelers in mocktown", { sources, probeLimit: 0 });

    expect(out.map.intent.geo.region).toBe("US-XX");
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { loadManifest } from "../../packages/registry-core/src/manifest.js";
import { route } from "../../packages/registry-core/src/route.js";
import { defaultDrivers } from "../../packages/registry-core/src/drivers/index.js";
import type { Intent } from "../../packages/registry-core/src/driver.js";

// THE architectural guarantee of v3: onboarding a new state is a manifest
// entry, nothing else. This test wires a fictional state ("Mockland",
// US-XX) through the UNMODIFIED loader, router and socrata driver — with
// field names deliberately different from Colorado's — and gets canonical
// entities out. If this test ever needs a code change to pass for a new
// real state, the socket is broken.

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
      quirks: { datasetId: "zzzz-9999", statusValue: "ACTIVE" },
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

describe("zero-code-change state onboarding", () => {
  it("config entry alone takes a query to canonical entities", async () => {
    const sources = loadManifest(MOCKLAND_MANIFEST);

    const intent: Intent = {
      categories: ["jewelry"],
      geo: { region: "US-XX", cities: ["Mocktown"] },
      direction: "sell",
    };
    const picked = route(intent, sources);
    expect(picked).toHaveLength(1);

    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        decodeURIComponent(url).includes("upper(biz_legal_name) LIKE '%JEWEL%'") ? MOCKLAND_ROWS : [],
    }) as unknown as Response));

    const driver = defaultDrivers[picked[0]!.driver]!;
    const entities = await driver.fetch(picked[0]!, {
      keywords: ["jewel"],
      region: intent.geo.region,
      cities: intent.geo.cities,
      categories: intent.categories,
    });

    expect(entities).toHaveLength(1);
    const e = entities[0]!;
    expect(e.id).toBe("xx_sos:MX-100");
    expect(e.name).toBe("MOCKTOWN JEWELERS LLC");
    expect(e.status).toBe("ACTIVE");
    expect(e.address).toEqual({ city: "Mocktown", state: "XX", zip: "99999" });
    expect(e.officers).toEqual(["Minnie Mock"]);
    expect(e.source_ids).toEqual(["xx_sos"]);
    expect(e.evidence.some(ev => ev.note === 'matched "jewel"')).toBe(true);
  });
});

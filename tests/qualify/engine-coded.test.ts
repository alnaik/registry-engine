import { describe, it, expect, vi, afterEach } from "vitest";
import type { Driver, DriverRegistry, Entity, FetchRequest, SourceSpec } from "../../packages/registry-core/src/index.js";
import { search } from "../../packages/qualify/src/engine.js";
import type { RawLlm } from "../../packages/qualify/src/llm/adapter.js";

// Engine golden over stub drivers (no network, no shard files): "metal
// fabrication in denver" is routed by NAICS code, so businesses whose names
// carry no keyword still surface; same-name rows from two planes merge into
// one lead; and the SoS backfill joins only locality-compatible rows.

const SOURCES: SourceSpec[] = [
  {
    id: "co_sos", name: "Colorado Secretary of State", plane: "existence", driver: "socrata",
    coverage: { geo: ["US-CO"], naics: ["*"] }, endpoint: "https://sos.example", fields: {},
    quirks: { cities: ["Denver", "Pueblo"] },
  },
  {
    id: "epa_echo", name: "EPA ECHO regulated facilities", plane: "category", driver: "echo",
    coverage: { geo: ["US"], naics: ["*"] }, endpoint: "https://echo.example", fields: {},
  },
  {
    id: "ppp", name: "SBA PPP loan records", plane: "category", driver: "static_shard",
    coverage: { geo: ["US"], naics: ["*"] }, endpoint: "repo:tests/fixtures/shards/none", fields: {},
  },
];

function ent(source: string, id: string, name: string, over: Partial<Entity> = {}): Entity {
  return {
    id: `${source}:${id}`, name, names: [], status: "", address: { city: "Denver", zip: "80207" },
    officers: [], naics: [], contacts: [], source_ids: [source],
    evidence: [{ source, field: "registry", value: source }], ...over,
  };
}

const ECHO_ROWS = [
  ent("epa_echo", "1", "HEGGEM LUNDQUIST", { naics: ["332312"], lastSeen: "2025-06-01" }),
  ent("epa_echo", "2", "VISSER PRECISION CAST", { naics: ["332999"], lastSeen: "2025-02-02" }),
  ent("epa_echo", "3", "GREEN METAL WORKS", { naics: ["332322"] }),
];
const PPP_ROWS = [
  ent("ppp", "10", "VISSER PRECISION CAST LLC", { naics: ["332999"], employees: 14, contacts: ["info@visser.example"], lastSeen: "2021-03-01" }),
  ent("ppp", "11", "ALPHA METAL CO", {
    naics: ["332710"], employees: 3,
    evidence: [{ source: "ppp", field: "name", value: "ALPHA METAL CO", note: 'matched "metal"' }],
  }),
];
// What the SoS name lookup returns: one row that joins GREEN METAL WORKS, one
// same-name row in another town (must be dropped), one unrelated overmatch.
const SOS_ROWS = [
  ent("co_sos", "a", "GREEN METAL WORKS LLC", { status: "Good Standing" }),
  ent("co_sos", "b", "GREEN METAL WORKS INC", { status: "Good Standing", address: { city: "Pueblo", zip: "81001" } }),
  ent("co_sos", "c", "RANDOM OTHER CO", { status: "Good Standing" }),
];

function stubDrivers(seen: FetchRequest[]): DriverRegistry {
  const socrata: Driver = {
    kind: "socrata",
    fetch: async (_s, req) => { seen.push(req); return []; },
    fetchByNames: async () => structuredClone(SOS_ROWS),
  };
  const echo: Driver = { kind: "echo", fetch: async (_s, req) => { seen.push(req); return structuredClone(ECHO_ROWS); } };
  const shard: Driver = { kind: "static_shard", fetch: async () => structuredClone(PPP_ROWS) };
  return { socrata, echo, static_shard: shard };
}

const MAP_JSON = '{"direction":"buy","naics":["332"],"keywords":["metal"],"cities":["Denver"],"caveats":["capacity is not verifiable"]}';

function stubLlm() {
  let calls = 0;
  const backend: RawLlm = {
    complete: async (prompt, opts) => {
      calls++;
      if (opts.system?.includes("NAICS 2017")) return MAP_JSON;
      const ids = [...prompt.matchAll(/^#(\d+) /gm)].map(m => Number(m[1]));
      return JSON.stringify(ids.map(i => ({ i, brief: `brief ${i}`, opener: `opener ${i}` })));
    },
  };
  return { backend, calls: () => calls };
}

// DNS-over-HTTPS: visser.example resolves; nothing else is published.
function stubDns() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const name = new URL(url).searchParams.get("name");
    const ok = name === "visser.example";
    return { ok: true, status: 200, json: async () => ({ Status: ok ? 0 : 3, Answer: ok ? [{ data: "x" }] : [] }) } as unknown as Response;
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe("engine — AI step failure", () => {
  it("a throwing map call sets llmError and spends no brief call", async () => {
    stubDns();
    let calls = 0;
    const backend: RawLlm = { complete: async () => { calls++; throw new Error("not logged in"); } };
    const out = await search("metal fabrication in denver", {
      sources: SOURCES, drivers: stubDrivers([]), region: "US-CO", llm: { backend },
    });
    expect(out.map.llmError).toContain("not logged in");
    expect(calls).toBe(1);
  });
});

describe("engine — activity-coded discovery", () => {
  it("finds code-matched businesses with no keyword in their name, merges planes, and stays within 2 LLM calls", async () => {
    stubDns();
    const seen: FetchRequest[] = [];
    const { backend, calls } = stubLlm();
    const out = await search("metal fabrication in denver", {
      sources: SOURCES, drivers: stubDrivers(seen), region: "US-CO", llm: { backend },
    });

    expect(out.map.via).toBe("llm");
    expect(seen.every(r => r.naics.join() === "332")).toBe(true);
    expect(out.llmCalls).toBe(2);
    expect(calls()).toBe(2);

    // no "metal" in the name, still a lead
    expect(out.ranked.some(l => l.entity.name === "HEGGEM LUNDQUIST")).toBe(true);

    // ECHO + PPP rows of the same name and city are one 2-source lead
    const visser = out.ranked.filter(l => l.entity.name.includes("VISSER"));
    expect(visser).toHaveLength(1);
    expect(visser[0]!.entity.source_ids.sort()).toEqual(["epa_echo", "ppp"]);
    expect(visser[0]!.entity.employees).toBe(14);
    expect(visser[0]!.web).toBe("verified");
    expect(visser[0]!.searchUrl).toBeNull();

    // every ranked lead has a template brief + opener; the top slice has the model's
    expect(out.ranked.every(l => l.brief.length > 0 && l.opener.length > 0)).toBe(true);
    expect(out.leads[0]!.brief).toMatch(/^brief \d+$/);
    expect(out.leads).toEqual(out.ranked.slice(0, out.leads.length));

    // ranking: the 2-source coded lead beats single-source ones
    expect(out.ranked[0]!.entity.name).toContain("VISSER");
  });

  it("SoS backfill joins only locality-compatible rows", async () => {
    stubDns();
    const out = await search("metal fabrication in denver", {
      sources: SOURCES, drivers: stubDrivers([]), region: "US-CO", naics: ["332"],
    });
    const green = out.entities.filter(e => e.name.includes("GREEN METAL WORKS"));
    expect(green).toHaveLength(1);
    expect(green[0]!.source_ids).toEqual(expect.arrayContaining(["co_sos", "epa_echo"]));
    expect(green[0]!.address.city).toBe("Denver");
    // the Pueblo same-name row and the unrelated overmatch never become leads
    expect(out.entities.some(e => e.id === "co_sos:b" || e.name === "GREEN METAL WORKS INC")).toBe(false);
    expect(out.entities.some(e => e.name === "RANDOM OTHER CO")).toBe(false);
    // and the registry-confirmed lead is labelled as such
    expect(out.ranked.find(l => l.entity.name.includes("GREEN"))!.brief).toContain("On the state business registry.");
  });

  it("hiddenOnly keeps only leads with no website on any public record", async () => {
    stubDns();
    const out = await search("metal fabrication in denver", {
      sources: SOURCES, drivers: stubDrivers([]), region: "US-CO", llm: { backend: stubLlm().backend }, hiddenOnly: true,
    });
    expect(out.ranked.length).toBeGreaterThan(0);
    expect(out.ranked.every(l => l.web === "none")).toBe(true);
    expect(out.ranked.some(l => l.entity.name.includes("VISSER"))).toBe(false);
    expect(out.ranked.some(l => l.entity.name === "HEGGEM LUNDQUIST")).toBe(true);
    expect(out.leads.every(l => l.web === "none")).toBe(true);
  });

  it("naics override skips the map call; without an LLM briefs are templates (0 calls)", async () => {
    stubDns();
    const seen: FetchRequest[] = [];
    const out = await search("metal fabrication in denver", {
      sources: SOURCES, drivers: stubDrivers(seen), region: "US-CO", naics: ["332312"],
    });
    expect(out.map.via).toBe("override");
    expect(seen.every(r => r.naics.join() === "332312")).toBe(true);
    expect(out.llmCalls).toBe(0);
    expect(out.leads.length).toBeGreaterThan(0);
    expect(out.leads.every(l => l.brief.length > 0)).toBe(true);
  });
});

describe("engine — inside-word name noise (M3)", () => {
  it("drops existence-only leads with no related code whose only keyword hits are inside a word", async () => {
    const sos = (id: string, name: string, note: string) =>
      ent("co_sos", id, name, { status: "Good Standing", evidence: [{ source: "co_sos", field: "entityname", value: name, note }] });
    const socrata: Driver = {
      kind: "socrata",
      fetch: async () => [
        sos("1", "BAGELS AND MORE LLC", 'matched "bag" inside a word'),
        sos("2", "BAG LADY LLC", 'matched "bag"'),
      ],
    };
    const empty: Driver = { kind: "echo", fetch: async () => [] };
    const out = await search("tote bags", {
      sources: SOURCES, drivers: { socrata, echo: empty, static_shard: { kind: "static_shard", fetch: async () => [] } },
      region: "US-CO", naics: ["314910"], contacts: null,
    });
    const names = out.ranked.map(l => l.entity.name);
    expect(names).toContain("BAG LADY LLC");
    expect(names).not.toContain("BAGELS AND MORE LLC");
  });
});

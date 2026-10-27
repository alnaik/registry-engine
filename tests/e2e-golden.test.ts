import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { search } from "../packages/qualify/src/engine.js";
import { SOURCES } from "../packages/registry-core/src/sources/index.js";
import type { RawLlm } from "../packages/qualify/src/llm/adapter.js";

// E2E acceptance over recorded fixtures: the two golden queries must produce
// ranked leads with evidence and probe results, spending at most 2 LLM calls
// and zero per-candidate calls.

const fixturesDir = join(import.meta.dirname, "fixtures");
const jewelRows = JSON.parse(readFileSync(join(fixturesDir, "co-sos-jewel-denver.json"), "utf-8")) as Record<string, unknown>[];
const potatoRows = JSON.parse(readFileSync(join(fixturesDir, "co-sos-potato.json"), "utf-8")) as Record<string, unknown>[];
const pacaShard = JSON.parse(readFileSync(join(import.meta.dirname, "../shards/paca/US-CO.json"), "utf-8")) as { records: Record<string, unknown>[] };

// ppp reads shards from the repo; keep the e2e hermetic by pointing it at a
// directory with no sector files (every sector is "no records").
const sources = SOURCES.map(s => s.id === "ppp" ? { ...s, endpoint: "repo:tests/fixtures/shards/none" } : s);

// Network stub covering all three planes: Socrata (recorded rows), the paca
// shard (the real recorded shard), and Cloudflare DoH (published domains
// resolve, guesses don't).
function stubNetwork() {
  const fetchMock = vi.fn(async (url: string) => {
    const respond = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
    if (url.startsWith("https://data.colorado.gov/")) {
      const where = decodeURIComponent(url);
      if (!url.includes("4ykn-tg5h")) return respond([]); // trade-name dataset: no recorded rows
      if (where.includes(" IN (")) {
        return respond([...jewelRows, ...potatoRows].filter(r => where.includes(`'${String(r["entityid"])}'`)));
      }
      if (where.includes("%JEWEL%")) return respond(jewelRows);
      if (where.includes("%POTATO%")) return respond(potatoRows);
      return respond([]);
    }
    if (url.startsWith("https://echodata.epa.gov/")) {
      // EPA ECHO: a search that matches nothing.
      return respond(url.includes("get_facilities") ? { Results: { QueryID: "1", QueryRows: "0" } } : { Results: { Facilities: [] } });
    }
    if (url.startsWith("https://cloudflare-dns.com/")) {
      const u = new URL(url);
      const name = u.searchParams.get("name")!;
      // Domains published in the paca shard resolve with A+MX; slug guesses miss.
      const published = pacaShard.records.some(r =>
        String(r["email_address"]).endsWith(`@${name}`) || String(r["website"]).includes(name));
      return respond({ Status: published ? 0 : 3, Answer: published ? [{ data: "x" }] : [] });
    }
    throw new Error(`E2E stub: unexpected URL ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// Stub model: the map call (system prompt names NAICS) gets the test's JSON;
// the brief call gets a valid brief + opener for every #index in the prompt.
function countingBackend(mapJson: string) {
  let calls = 0;
  const backend: RawLlm = {
    complete: async (prompt: string, opts) => {
      calls++;
      if (opts.system?.includes("NAICS 2017")) return mapJson;
      const ids = [...prompt.matchAll(/^#(\d+) /gm)].map(m => Number(m[1]));
      return JSON.stringify(ids.map(i => ({ i, brief: `Lead ${i}: fits the category; flagged caveats apply.`, opener: `Hi, lead ${i}.` })));
    },
  };
  return { backend, calls: () => calls };
}

afterEach(() => vi.unstubAllGlobals());

describe("golden query (a): jewelers that need princess cut diamonds (Denver)", () => {
  it("map (1 call) + brief (1 call): ranked leads with evidence, labels and openers", async () => {
    stubNetwork();
    const { backend, calls } = countingBackend(
      '{"direction":"buy","naics":["339910","423940"],"keywords":["jewel","diamond"],"cities":["Denver"],"caveats":["princess cut is not verifiable from registry data"]}');
    const out = await search("find jewelers that need princess cut diamonds in Denver", { sources, llm: { backend } });

    // map: one cheap call; brief: one batched call. Budget respected.
    expect(out.map.usedLlm).toBe(true);
    expect(out.map.via).toBe("llm");
    expect(out.llmCalls).toBe(2);
    expect(calls()).toBe(2);
    expect(out.map.caveats.some(c => c.includes("princess cut"))).toBe(true);

    // routed to the sources that take any code (no jewelry-specific source exists)
    expect(out.routed.map(s => s.id).sort()).toEqual(["co_sos", "epa_echo", "ppp"]);

    // ranked leads with evidence and probe results
    expect(out.leads.length).toBeGreaterThan(0);
    expect(out.leads.some(l => l.entity.name.toUpperCase().includes("JEWEL"))).toBe(true);
    for (const lead of out.leads) {
      expect(lead.entity.evidence.length).toBeGreaterThan(0);
      expect(lead.brief.length).toBeGreaterThan(0);
      expect(lead.opener.length).toBeGreaterThan(0);
    }
    // Denver is the origin, so leads are grouped by distance band; score
    // descends within each band. Name-only matches trail every coded lead
    // under their own band.
    const firstNameOnly = out.ranked.findIndex(l => l.band === "name matches only — lower confidence");
    if (firstNameOnly >= 0) {
      expect(out.ranked.slice(firstNameOnly).every(l => l.band === "name matches only — lower confidence")).toBe(true);
    }
    for (const band of new Set(out.ranked.map(l => l.band))) {
      const scores = out.ranked.filter(l => l.band === band).map(l => l.score);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    }
    expect(out.leads.some(l => l.probe !== undefined)).toBe(true);
    expect(out.ranked.length).toBeGreaterThanOrEqual(out.leads.length);
  });

  it("with --naics, skips the map call entirely", async () => {
    stubNetwork();
    const { backend, calls } = countingBackend("SHOULD NOT BE CALLED");
    const out = await search("find jewel shops in Denver", { sources, llm: { backend }, naics: ["339910"] });
    expect(out.map.via).toBe("override");
    expect(calls()).toBe(1); // the brief call only
  });
});

describe("golden query (b): yukon gold potato supplier near me (Colorado)", () => {
  it("routes by NAICS to paca ∩ CO, joins co_sos existence", async () => {
    stubNetwork();
    const { backend, calls } = countingBackend(
      '{"direction":"buy","naics":["111211","424480"],"keywords":["potato"],"cities":[],"caveats":["yukon gold is a variety no registry records"]}');
    const out = await search("yukon gold potato supplier near me", { sources, llm: { backend } });

    expect(out.llmCalls).toBe(2);
    expect(calls()).toBe(2);
    expect(out.routed.map(s => s.id).sort()).toEqual(["co_farm_products", "co_sos", "epa_echo", "paca", "ppp"]);
    expect(out.map.intent.direction).toBe("buy");
    expect(out.map.caveats.some(c => c.includes("yukon gold"))).toBe(true);

    // multi-plane join: at least one lead exists in BOTH registries
    const joined = out.entities.filter(e => e.source_ids.includes("co_sos") && e.source_ids.includes("paca"));
    expect(joined.length).toBeGreaterThan(0);
    expect(joined.some(e => e.name.toUpperCase().includes("POTATO") || e.names.some(n => n.toUpperCase().includes("POTATO")))).toBe(true);

    // paca detail contacts survive the merge into the lead
    const withContacts = out.leads.filter(l => l.entity.contacts.length > 0);
    expect(withContacts.length).toBeGreaterThan(0);

    // multi-plane joins outrank single-source matches
    expect(out.leads[0]!.entity.source_ids.length).toBeGreaterThanOrEqual(2);

    // probe verified a published domain for at least one lead, and it is labelled
    expect(out.leads.some(l => l.probe?.published === true && l.probe.domain !== null && l.web === "verified")).toBe(true);

    // paca-only entities are flagged against the existence plane
    const pacaOnly = out.entities.find(e => e.source_ids.length === 1 && e.source_ids[0] === "paca");
    if (pacaOnly !== undefined && out.leads.some(l => l.entity.id === pacaOnly.id)) {
      expect(pacaOnly.evidence.some(ev => ev.field === "existence")).toBe(true);
    }
  });

  it("still works with zero LLM (static table, template briefs and openers, 0 calls)", async () => {
    stubNetwork();
    const out = await search("potato supplier in colorado springs", { sources });
    expect(out.llmCalls).toBe(0);
    expect(out.map.via).toBe("table");
    expect(out.leads.every(l => l.brief.length > 0 && l.opener.length > 0)).toBe(true);
  });
});

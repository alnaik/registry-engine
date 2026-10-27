import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, request } from "node:http";
import type { Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createApp } from "../../apps/web/src/server.js";
import type { AppDeps } from "../../apps/web/src/server.js";
import type { SearchConfig, SearchOutcome, Lead } from "../../packages/qualify/src/index.js";

const LEAD_VIEW_KEYS = [
  "id", "key", "rank", "score", "name", "aka", "address", "distanceMi", "band", "naics", "what", "coded", "individual", "employees", "lastSeen", "formedDate",
  "sources", "codeSources", "registryCheck", "registeredElsewhere", "status", "contacts", "web", "found", "officers", "searchUrl", "mapsUrl", "brief", "opener",
];

function makeLead(i: number): Lead {
  return {
    entity: {
      id: `ppp:${i}`, name: `ACME ${i} FABRICATION`, names: ["ACME"], status: "Good Standing",
      address: { street: `${i} Main St`, city: "Denver", state: "CO", zip: "80202" },
      officers: ["JANE DOE"], naics: ["332312"], contacts: ["(303) 555-0100"],
      source_ids: ["co_sos", "ppp"], evidence: [
        { source: "ppp", field: "naics", value: "332312", note: "matched" },
        { source: "ppp", field: "registry", value: "PPP loans", note: "NAICS 332312" },
      ],
      employees: 10, lastSeen: "2024-05-01",
    },
    score: 90 - i, probe: undefined, web: "none", brief: "Brief", opener: "Hello", searchUrl: "https://duckduckgo.com/?q=x",
    distanceMi: 3.2, band: "within 10 mi", registryCheck: "matched",
  };
}

function makeOutcome(n = 3): SearchOutcome {
  const ranked = Array.from({ length: n }, (_, i) => makeLead(i));
  return {
    map: { intent: { naics: ["332312"], geo: { region: "US-CO", cities: [] }, direction: "buy" }, keywords: ["metal"], caveats: ["c1"], usedLlm: false, via: "table", directionFixed: false },
    routed: [
      { id: "co_sos", name: "Colorado SoS", plane: "existence", driver: "socrata", coverage: { geo: ["US-CO"], naics: ["*"] }, endpoint: "https://x", fields: {} },
      { id: "ppp", name: "PPP loans", plane: "category", driver: "static_shard", coverage: { geo: ["US"], naics: ["*"] }, endpoint: "", fields: {} },
    ],
    entities: ranked.map(l => l.entity),
    leads: ranked.slice(0, 2),
    ranked,
    llmCalls: 0,
    llmUsage: null,
    origin: { label: "Denver, CO", lat: 39.7, lon: -104.9 },
    contactLookups: null,
    recent: [],
    recentWindow: null,
    registryLookup: { status: "ran", namesChecked: 0, nameCap: 80, candidates: 0 },
  };
}

interface Reply { status: number; headers: Record<string, string | string[] | undefined>; text: string }

describe("web app server", () => {
  let server: Server;
  let port = 0;
  let publicDir = "";
  let calls: { query: string; cfg: SearchConfig }[] = [];
  let behavior: (query: string, cfg: SearchConfig) => Promise<SearchOutcome> = async () => makeOutcome();

  function send(opts: { method?: string; path: string; headers?: Record<string, string>; body?: string }): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const req = request({
        host: "127.0.0.1", port, method: opts.method ?? "GET", path: opts.path,
        headers: { Host: `localhost:${port}`, ...(opts.headers ?? {}) },
      }, res => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
      });
      req.on("error", reject);
      req.end(opts.body);
    });
  }

  const post = (body: unknown, headers: Record<string, string> = { "Content-Type": "application/json" }): Promise<Reply> =>
    send({ method: "POST", path: "/api/search", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

  const lines = (reply: Reply): Record<string, unknown>[] =>
    reply.text.split("\n").filter(l => l !== "").map(l => JSON.parse(l) as Record<string, unknown>);

  beforeAll(async () => {
    publicDir = mkdtempSync(join(tmpdir(), "re-web-"));
    writeFileSync(join(publicDir, "index.html"), "<!doctype html><title>t</title>");
    writeFileSync(join(publicDir, "app.js"), "console.log(1);");
    writeFileSync(join(publicDir, "app.css"), "body{}");
    writeFileSync(join(publicDir, "design.html"), "<!doctype html><title>d</title>");
    writeFileSync(join(publicDir, "design.js"), "console.log(2);");
    writeFileSync(join(publicDir, "labels.js"), "export {};");
    server = createServer();
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  // A fresh app (fresh busy flag and "last outcome") per test.
  beforeEach(() => {
    calls = [];
    behavior = async () => makeOutcome();
    const deps: AppDeps = {
      search: (async (query: string, cfg: SearchConfig = {}) => {
        calls.push({ query, cfg });
        cfg.onEvent?.({ type: "map", map: makeOutcome().map });
        cfg.onEvent?.({ type: "fetched", sourceId: "ppp", count: 7, capped: false });
        cfg.onEvent?.({ type: "fetched", sourceId: "co_sos", count: 500, capped: true });
        return behavior(query, cfg);
      }) as unknown as AppDeps["search"],
      llmAvailable: async () => true,
      contactsProvider: () => null,
      port,
      publicDir,
    };
    server.removeAllListeners("request");
    server.on("request", createApp(deps));
  });

  afterAll(() => new Promise<void>(resolve => { server.close(() => resolve()); }));

  describe("static files and guards", () => {
    it("rejects a foreign Host header", async () => {
      const r = await send({ path: "/", headers: { Host: "evil.example.com" } });
      expect(r.status).toBe(403);
    });

    it("serves / with a CSP and the hardening headers", async () => {
      const r = await send({ path: "/" });
      expect(r.status).toBe(200);
      expect(String(r.headers["content-security-policy"])).toContain("default-src 'self'");
      expect(String(r.headers["content-security-policy"])).toContain("script-src 'self'");
      expect(r.headers["x-content-type-options"]).toBe("nosniff");
      expect(r.headers["referrer-policy"]).toBe("no-referrer");
      expect(r.headers["x-frame-options"]).toBe("DENY");
      const alt = await send({ path: "/", headers: { Host: `127.0.0.1:${port}` } });
      expect(alt.status).toBe(200);
    });

    it("serves the /design component sheet with the same CSP and Host check", async () => {
      const r = await send({ path: "/design" });
      expect(r.status).toBe(200);
      expect(String(r.headers["content-type"])).toContain("text/html");
      expect(String(r.headers["content-security-policy"])).toContain("default-src 'self'");
      expect(String(r.headers["content-security-policy"])).toContain("script-src 'self'");
      expect((await send({ path: "/design.js" })).status).toBe(200);
      expect((await send({ path: "/design", headers: { Host: "evil.example.com" } })).status).toBe(403);
      expect((await send({ path: "/design/../app.js" })).status).not.toBe(500);
    });

    it("serves the whitelisted assets, 404s the rest, and ignores traversal", async () => {
      expect((await send({ path: "/app.js" })).status).toBe(200);
      expect((await send({ path: "/app.css" })).status).toBe(200);
      expect((await send({ path: "/labels.js" })).status).toBe(200);
      expect((await send({ path: "/nope" })).status).toBe(404);
      expect((await send({ path: "/../package.json" })).status).toBe(404);
      expect((await send({ path: "/%2e%2e/package.json" })).status).toBe(404);
    });
  });

  describe("POST /api/search validation", () => {
    it("requires a JSON content type", async () => {
      expect((await post(JSON.stringify({ query: "metal fabrication" }), { "Content-Type": "text/plain" })).status).toBe(415);
    });

    it("rejects bodies over 10 KB", async () => {
      expect((await post({ query: "x".repeat(11_000) })).status).toBe(413);
    });

    it("400s bad input", async () => {
      expect((await post("not json")).status).toBe(400);
      expect((await post({ query: "ab" })).status).toBe(400);
      expect((await post({ query: "metal fabrication", region: "US-ZZ" })).status).toBe(400);
      expect((await post({ query: "metal fabrication", radiusMi: 0 })).status).toBe(400);
      expect((await post({ query: "metal fabrication", leads: 99 })).status).toBe(400);
      expect((await post({ query: "metal fabrication", naics: "33; DROP" })).status).toBe(400);
      expect(calls).toHaveLength(0);
    });
  });

  describe("POST /api/search streaming", () => {
    it("forwards llmError on the map event", async () => {
      const deps: AppDeps = {
        search: (async (_q: string, cfg: SearchConfig = {}) => {
          const o = makeOutcome();
          cfg.onEvent?.({ type: "map", map: { ...o.map, llmError: "not logged in" } });
          return o;
        }) as unknown as AppDeps["search"],
        llmAvailable: async () => true,
        contactsProvider: () => null,
        port,
        publicDir,
      };
      server.removeAllListeners("request");
      server.on("request", createApp(deps));
      const r = await post({ query: "metal fabrication" });
      expect(lines(r)[0]).toMatchObject({ type: "map", llmError: "not logged in" });
    });

    it("passes llmUsage through to the result line", async () => {
      const usage = {
        inputTokens: 900, outputTokens: 100, costUsd: 0.002,
        calls: [
          { label: "map", model: "m1", inputTokens: 400, outputTokens: 40, costUsd: 0.001 },
          { label: "brief", model: "m2", inputTokens: 500, outputTokens: 60, costUsd: 0.001 },
        ],
      };
      behavior = async () => ({ ...makeOutcome(), llmCalls: 2, llmUsage: usage });
      const r = await post({ query: "metal fabrication", near: "Denver", leads: 2 });
      const result = lines(r).pop() as Record<string, unknown>;
      expect(result["type"]).toBe("result");
      expect(result["llmUsage"]).toEqual(usage);
    });

    it("streams translated events and ends with a result line of LeadViews", async () => {
      const r = await post({ query: "metal fabrication", near: "Denver", leads: 2 });
      expect(r.status).toBe(200);
      expect(String(r.headers["content-type"])).toContain("application/x-ndjson");
      const out = lines(r);
      expect(out[0]).toMatchObject({ type: "map", direction: "buy", via: "table", directionFixed: false, caveats: ["c1"] });
      expect(out[0]?.["naics"]).toEqual([{ code: "332312", title: "Fabricated Structural Metal Manufacturing" }]);
      expect(out[1]).toEqual({ type: "fetched", sourceId: "ppp", count: 7, capped: false });
      expect(out[2]).toEqual({ type: "fetched", sourceId: "co_sos", count: 500, capped: true });

      const result = out[out.length - 1] as Record<string, unknown>;
      expect(result["type"]).toBe("result");
      expect(result["summary"]).toEqual({ total: 3, coded: 3, nameOnly: 0, noWebsite: 3 });
      expect(result["llmCalls"]).toBe(0);
      expect(result["llmUsage"]).toBeNull();
      const top = result["leads"] as Record<string, unknown>[];
      const more = result["more"] as Record<string, unknown>[];
      expect(top).toHaveLength(2);
      expect(more).toHaveLength(1);
      for (const lead of top) {
        expect(Object.keys(lead).filter(k => k !== "evidence").sort()).toEqual([...LEAD_VIEW_KEYS].sort());
        expect(lead["evidence"]).toBeDefined();
      }
      expect(more[0]?.["evidence"]).toBeDefined();
      expect(result["sources"]).toEqual([
        { id: "co_sos", name: "Colorado SoS", plane: "existence", count: 500, capped: true, error: false },
        { id: "ppp", name: "PPP loans", plane: "category", count: 7, capped: false, error: false },
      ]);
      expect(result["registryLookup"]).toEqual({ status: "ran", namesChecked: 0, nameCap: 80, candidates: 0 });
      expect(result["sheet"]).toEqual({ total: 3, coded: 3, businesses: 3, listed: 3, nameOnly: 0, individuals: 0, withinRadius: 3, radiusMi: 25, confirmed: 3, withPhone: 3 });
      expect(result["regionName"]).toBe("Colorado");
      expect(top[0]).toMatchObject({
        rank: 1, registryCheck: "matched", registeredElsewhere: false, found: null, employees: 10,
        what: "Makes fabricated structural metal", coded: true, individual: false,
        sources: [{ id: "co_sos", name: "Colorado SoS" }, { id: "ppp", name: "PPP loans" }],
        codeSources: [{ id: "ppp", name: "PPP loans" }],
      });
      expect(String(top[0]?.["mapsUrl"])).toBe(
        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("ACME 0 FABRICATION 0 Main St Denver CO 80202")}`);
    });

    it("sends recently registered leads and the window in the result line", async () => {
      const outcome = makeOutcome(1);
      const r1 = makeLead(5);
      r1.entity = { ...r1.entity, id: "co_sos:9", naics: [], formedDate: "2026-09-01" };
      outcome.recent = [r1];
      outcome.recentWindow = { days: 90, radiusMi: 25 };
      behavior = async () => outcome;
      const r = await post({ query: "tents" });
      const all = lines(r);
      const result = all.pop() as Record<string, unknown>;
      expect(result["recentWindow"]).toEqual({ days: 90, radiusMi: 25 });
      const recent = result["recent"] as Record<string, unknown>[];
      expect(recent).toHaveLength(1);
      expect(recent[0]).toMatchObject({ id: "co_sos:9", formedDate: "2026-09-01", rank: 1 });
      expect(recent[0]?.["evidence"]).toBeUndefined();
    });

    it("gives the same stable key to the same business under different ids", async () => {
      const a = makeLead(0);
      const b = makeLead(1);
      a.entity = { ...a.entity, id: "co_sos:1", name: "Acme Tent & Canvas, Inc.", address: { ...a.entity.address, zip: "80203-1234" } };
      b.entity = { ...b.entity, id: "ppp:2", name: "ACME TENT AND CANVAS", address: { ...b.entity.address, zip: "80203" } };
      const outcome = makeOutcome(2);
      outcome.ranked = [a, b];
      outcome.entities = [a.entity, b.entity];
      outcome.leads = [a, b];
      behavior = async () => outcome;
      const r = await post({ query: "tents", leads: 2 });
      const result = lines(r).pop() as Record<string, unknown>;
      const top = result["leads"] as Record<string, unknown>[];
      expect(top.map(l => l["id"])).toEqual(["co_sos:1", "ppp:2"]);
      expect(top.map(l => l["key"])).toEqual(["ACME TENT AND CANVAS|80203", "ACME TENT AND CANVAS|80203"]);
    });

    it("splits coded businesses, individuals' records and name-only matches; individuals get no map or search link", async () => {
      const a = makeLead(0);
      const person = makeLead(1);
      person.entity = { ...person.entity, id: "ppp:p", name: "DOE, JANE", evidence: [...person.entity.evidence, { source: "ppp", field: "business_type", value: "Sole Proprietorship" }] };
      const loose = makeLead(2);
      loose.entity = { ...loose.entity, id: "co_sos:n", name: "METAL MOOSE LLC", naics: [] };
      loose.registryCheck = "not_checked";
      const outcome = makeOutcome(3);
      outcome.ranked = [a, person, loose];
      outcome.entities = outcome.ranked.map(l => l.entity);
      behavior = async () => outcome;
      const result = lines(await post({ query: "metal", leads: 5 })).pop() as Record<string, unknown>;
      const ids = (k: string) => (result[k] as { id: string }[]).map(l => l.id);
      expect(ids("leads")).toEqual(["ppp:0"]);
      expect(ids("more")).toEqual([]);
      expect(ids("individuals")).toEqual(["ppp:p"]);
      expect(ids("nameOnly")).toEqual(["co_sos:n"]);
      const p = (result["individuals"] as Record<string, unknown>[])[0]!;
      expect(p).toMatchObject({ name: "DOE, JANE", individual: true, mapsUrl: null, searchUrl: null });
      const n = (result["nameOnly"] as Record<string, unknown>[])[0]!;
      expect(n).toMatchObject({ coded: false, what: "", registryCheck: "not_checked" });
      expect(result["sheet"]).toMatchObject({ coded: 2, nameOnly: 1, individuals: 1 });
    });

    it("passes options through: noLlm drops the backend, findContacts:false turns contacts off", async () => {
      await post({ query: "metal fabrication", noLlm: true, findContacts: false, hiddenOnly: true, radiusMi: 25, naics: "332, 3323", leads: 5, region: "US-CO", near: "80202" });
      const cfg = calls[0]!.cfg;
      expect(cfg.llm).toBeUndefined();
      expect(cfg.contacts).toBeNull();
      expect(cfg).toMatchObject({ hiddenOnly: true, radiusMi: 25, naics: ["332", "3323"], maxLeads: 5, region: "US-CO", near: "80202" });

      await post({ query: "metal fabrication" });
      const dflt = calls[1]!.cfg;
      expect(dflt.llm).toBeDefined();
      expect(dflt.contacts).toBeUndefined();
      expect(dflt.maxLeads).toBe(12);
    });

    it("passes a fixed direction through; auto and absent mean undefined; anything else is a 400", async () => {
      await post({ query: "metal fabrication", direction: "sell" });
      expect(calls[0]!.cfg.direction).toBe("sell");
      await post({ query: "metal fabrication", direction: "auto" });
      expect(calls[1]!.cfg.direction).toBeUndefined();
      await post({ query: "metal fabrication" });
      expect(calls[2]!.cfg.direction).toBeUndefined();
      expect((await post({ query: "metal fabrication", direction: "sideways" })).status).toBe(400);
      expect(calls).toHaveLength(3);
    });

    it("allows one search at a time", async () => {
      let release: (o: SearchOutcome) => void = () => {};
      behavior = () => new Promise<SearchOutcome>(resolve => { release = resolve; });
      const first = post({ query: "metal fabrication" });
      while (calls.length === 0) await new Promise(r => setTimeout(r, 5));

      const second = await post({ query: "another search" });
      expect(second.status).toBe(429);
      expect(JSON.parse(second.text)).toEqual({ error: "a search is already running" });

      release(makeOutcome());
      expect((await first).status).toBe(200);
      behavior = async () => makeOutcome();
      expect((await post({ query: "third search" })).status).toBe(200);
    });

    it("reports a search failure as a final error line and frees the slot", async () => {
      behavior = async () => { throw new Error("registry exploded"); };
      const failed = lines(await post({ query: "metal fabrication" }));
      expect(failed[failed.length - 1]).toEqual({ type: "error", message: "registry exploded" });

      behavior = async () => makeOutcome();
      const ok = await post({ query: "metal fabrication" });
      expect(ok.status).toBe(200);
      expect(lines(ok).pop()?.["type"]).toBe("result");
    });
  });

  describe("GET /api/csv, /api/codes, /api/status", () => {
    it("404s before any search, then serves the last full ranked list", async () => {
      expect((await send({ path: "/api/csv" })).status).toBe(404);
      await post({ query: "metal fabrication", leads: 1 });
      const r = await send({ path: "/api/csv" });
      expect(r.status).toBe(200);
      expect(String(r.headers["content-type"])).toContain("text/csv");
      expect(String(r.headers["content-disposition"])).toContain('filename="leads.csv"');
      const rows = r.text.trimEnd().split("\n");
      expect(rows[0]).toMatch(/^"rank","score","name"/);
      expect(rows).toHaveLength(4);   // header + all 3 ranked leads, not just the top 1
    });

    it("looks up NAICS codes", async () => {
      const r = await send({ path: "/api/codes?q=canvas%20bag" });
      expect(r.status).toBe(200);
      const hits = JSON.parse(r.text) as { code: string; title: string; description: string }[];
      expect(hits.map(h => h.code)).toContain("314910");
      expect(JSON.parse((await send({ path: "/api/codes?q=" })).text)).toEqual([]);
    });

    it("answers HEAD for static routes and /api/status with headers and no body", async () => {
      const page = await send({ method: "HEAD", path: "/" });
      expect(page.status).toBe(200);
      expect(String(page.headers["content-type"])).toContain("text/html");
      expect(page.text).toBe("");
      const status = await send({ method: "HEAD", path: "/api/status" });
      expect(status.status).toBe(200);
      expect(String(status.headers["content-type"])).toContain("application/json");
      expect(status.text).toBe("");
    });

    it("reports status", async () => {
      const r = await send({ path: "/api/status" });
      const body = JSON.parse(r.text) as { llm: boolean; contactsProvider: string | null; regions: string[]; defaultRegion: string };
      expect(body.llm).toBe(true);
      expect(body.contactsProvider).toBeNull();
      expect(body.regions).toContain(body.defaultRegion);
    });
  });
});

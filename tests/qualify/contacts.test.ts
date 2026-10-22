import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Entity } from "../../packages/registry-core/src/entity.js";
import type { Lead } from "../../packages/qualify/src/verbs/brief.js";
import {
  extractContact, isLikelyIndividual, findContacts, exaProvider, parallelProvider, providerFromEnv,
  memoryContactCache, fileContactCache,
  type WebResult, type WebSearchProvider, type FoundContact,
} from "../../packages/qualify/src/verbs/contacts.js";

function ent(over: Partial<Entity> = {}): Entity {
  return {
    id: "ppp:1", name: "ZIMMERMAN METALS LLC", names: [], status: "",
    address: { city: "Denver", state: "CO", zip: "80207" }, officers: [], naics: ["332312"],
    contacts: [], source_ids: ["ppp"], evidence: [], ...over,
  };
}

function lead(e: Entity): Lead {
  return { entity: e, score: 0, probe: undefined, web: "none", brief: "", opener: "", searchUrl: null, distanceMi: null, band: "" };
}

const OWN: WebResult = {
  url: "https://www.zimmermanmetals.com/contact",
  title: "Contact Us",
  text: "Call us at (303) 555-0142 or write sales@zimmermanmetals.com. Located in Denver, CO 80207.",
};
const YELP: WebResult = {
  url: "https://www.yelp.com/biz/zimmerman-metals-denver",
  title: "Zimmerman Metals - Denver, CO",
  text: "Zimmerman Metals, Denver CO. Phone: 720-555-0199",
};

describe("extractContact", () => {
  it("finds the business's own website, phone and email with provenance", () => {
    const f = extractContact(ent(), [YELP, OWN], "exa");
    expect(f.status).toBe("found");
    expect(f.website).toBe("https://zimmermanmetals.com");
    expect(f.phone).toBe("(303) 555-0142");           // the website's number beats the directory's
    expect(f.email).toBe("sales@zimmermanmetals.com");
    expect(f.listings).toEqual(["yelp.com"]);
    expect(f.sourceUrls).toEqual([OWN.url, YELP.url]);
    expect(f.provider).toBe("exa");
  });

  it("a directory-only match is a listing, never the website", () => {
    const f = extractContact(ent(), [YELP], "exa");
    expect(f.status).toBe("directory");
    expect(f.website).toBeUndefined();
    expect(f.phone).toBe("(720) 555-0199");
    expect(f.listings).toEqual(["yelp.com"]);
    expect(f.sourceUrls).toEqual([YELP.url]);
  });

  it("unrelated results find nothing", () => {
    const f = extractContact(ent(), [
      { url: "https://example.org/", title: "Fish", text: "fish tanks in Denver, CO 80207 (303) 555-0100" },
      { url: "https://acme.com/", title: "Acme", text: "Acme Corp in Denver" },
    ], "exa");
    expect(f).toMatchObject({ status: "not-found", listings: [], sourceUrls: [] });
    expect(f.phone).toBeUndefined();
    expect(f.website).toBeUndefined();
  });

  it("a name match without a place match yields no contact", () => {
    const f = extractContact(ent(), [{
      url: "https://zimmermanmetals.ca/", title: "Zimmerman Metals",
      text: "Zimmerman Metals of Toronto. (416) 555-0100 info@zimmermanmetals.ca",
    }], "exa");
    expect(f.status).toBe("not-found");
    expect(f.phone).toBeUndefined();
    expect(f.email).toBeUndefined();
  });

  it("matches the place by zip as well as city", () => {
    const f = extractContact(ent({ address: { city: "Aurora", zip: "80207" } }), [OWN], "exa");
    expect(f.website).toBe("https://zimmermanmetals.com");
  });

  it("requires enough distinctive name tokens", () => {
    const e = ent({ name: "BLUE RIDGE PRECISION MACHINING INC" });   // BLUE RIDGE PRECISION MACHINING -> need 3 of 4
    const weak = extractContact(e, [{ url: "https://blueridge.example/", title: "Blue Ridge", text: "Denver CO" }], "exa");
    expect(weak.status).toBe("not-found");
    const strong = extractContact(e, [{ url: "https://brpm.example/", title: "Blue Ridge Precision Machining", text: "Denver CO" }], "exa");
    expect(strong.website).toBe("https://brpm.example");
  });

  it("prefers an email on the website's domain; drops directory, image and placeholder addresses", () => {
    const results: WebResult[] = [
      { url: "https://www.zimmermanmetals.com/", title: "Zimmerman Metals", text: "Denver. noreply@sentry.io logo@2x.png someone@example.com team@yelp.com hello@gmail.com sales@zimmermanmetals.com" },
    ];
    const f = extractContact(ent(), results, "exa");
    expect(f.email).toBe("sales@zimmermanmetals.com");
    const noSite = extractContact(ent(), [{ ...YELP, text: `${YELP.text} biz@yelp.com photo@cdn.example.png zed@acme.org` }], "exa");
    expect(noSite.email).toBe("zed@acme.org");
  });

  it("leaves the website empty when the registry already published a domain", () => {
    const f = extractContact(ent({ contacts: ["https://zimmerman.example"] }), [OWN], "exa");
    expect(f.website).toBeUndefined();
    expect(f.phone).toBe("(303) 555-0142");
    expect(f.status).toBe("directory");
  });
});

describe("isLikelyIndividual", () => {
  it("flags PPP sole proprietors and similar", () => {
    for (const v of ["Sole Proprietorship", "self-employed individuals", "Independent Contractors"]) {
      expect(isLikelyIndividual(ent({ evidence: [{ source: "ppp", field: "business_type", value: v }] }))).toBe(true);
    }
    expect(isLikelyIndividual(ent({ evidence: [{ source: "ppp", field: "business_type", value: "Corporation" }] }))).toBe(false);
  });

  it("flags LAST, FIRST person names", () => {
    expect(isLikelyIndividual(ent({ name: "SMITH, JOHN A" }))).toBe(true);
    expect(isLikelyIndividual(ent({ name: "BLACH, ALICIA" }))).toBe(true);
    for (const n of ["ACME, INC", "ACME, LLC", "ACME, Inc.", "ACME, L.L.C.", "ACME, CORP"]) {
      expect(isLikelyIndividual(ent({ name: n }))).toBe(false);
    }
    expect(isLikelyIndividual(ent({ name: "O'Brien-Lee, Mary" }))).toBe(true);
    expect(isLikelyIndividual(ent())).toBe(false);
    expect(isLikelyIndividual(ent({ name: "Green Valley Farms, LLC" }))).toBe(false);
  });
});

function stubProvider(results: WebResult[] = [OWN], name = "stub") {
  const queries: Array<{ query: string; objective: string }> = [];
  const provider: WebSearchProvider = {
    name,
    search: async (query, objective) => { queries.push({ query, objective }); return { results, costDollars: 0.007 }; },
  };
  return { provider, queries };
}

describe("findContacts", () => {
  it("looks up only the first `limit` leads, builds the query and objective, and sums cost", async () => {
    const { provider, queries } = stubProvider();
    const leads = [lead(ent()), lead(ent({ id: "ppp:2", name: "OTHER METALS" })), lead(ent({ id: "ppp:3", name: "THIRD METALS" }))];
    const stats = await findContacts(leads, provider, { limit: 2, cache: memoryContactCache() });
    expect(queries).toHaveLength(2);
    expect(queries[0]).toEqual({
      query: '"ZIMMERMAN METALS LLC" Denver CO',
      objective: 'Official website, phone number and email of the business "ZIMMERMAN METALS LLC" in Denver, CO.',
    });
    expect(leads[0]!.found?.status).toBe("found");
    expect(leads[1]!.found?.status).toBe("not-found");   // OWN is not about OTHER METALS
    expect(leads[2]!.found).toBeUndefined();
    expect(stats.looked).toBe(2);
    expect(stats.found).toBe(1);
    expect(stats.costDollars).toBeCloseTo(0.014, 6);
  });

  it("skips individuals without a request", async () => {
    const { provider, queries } = stubProvider();
    const person = lead(ent({ name: "SMITH, JOHN" }));
    const stats = await findContacts([person], provider, { limit: 5, cache: memoryContactCache() });
    expect(queries).toHaveLength(0);
    expect(person.found).toMatchObject({ status: "skipped", reason: "individual's record — not searched", provider: "stub" });
    expect(stats).toEqual({ looked: 0, found: 0, costDollars: 0 });
  });

  it("serves a repeat lookup from the cache", async () => {
    const { provider, queries } = stubProvider();
    const cache = memoryContactCache();
    await findContacts([lead(ent())], provider, { limit: 5, cache });
    const again = lead(ent({ id: "other:9", name: "Zimmerman Metals, Inc." }));   // same normalized name + zip
    const stats = await findContacts([again], provider, { limit: 5, cache });
    expect(queries).toHaveLength(1);
    expect(again.found?.status).toBe("found");
    expect(stats).toMatchObject({ looked: 1, found: 1, costDollars: 0 });
  });

  it("a throwing provider yields not-found with a reason and is not cached", async () => {
    const cache = memoryContactCache();
    const failing: WebSearchProvider = { name: "bad", search: async () => { throw new Error("boom"); } };
    const l = lead(ent());
    const stats = await findContacts([l], failing, { limit: 5, cache });
    expect(l.found).toMatchObject({ status: "not-found", reason: "lookup failed: boom", provider: "bad" });
    expect(stats.found).toBe(0);
    expect(cache.get("bad|ZIMMERMAN METALS|80207")).toBeUndefined();
  });

  it("runs at most `concurrency` lookups at once", async () => {
    let running = 0;
    let peak = 0;
    const provider: WebSearchProvider = {
      name: "slow",
      search: async () => {
        running++; peak = Math.max(peak, running);
        await new Promise(r => setTimeout(r, 5));
        running--;
        return { results: [] };
      },
    };
    const leads = Array.from({ length: 8 }, (_, i) => lead(ent({ id: `x:${i}`, name: `BUSINESS NUMBER ${i}` })));
    await findContacts(leads, provider, { limit: 8, concurrency: 2, cache: memoryContactCache() });
    expect(peak).toBe(2);
  });
});

describe("fileContactCache", () => {
  const found: FoundContact = { listings: [], sourceUrls: [], status: "found", provider: "exa", website: "https://a.example" };

  it("writes through and reads back across instances", () => {
    const path = join(mkdtempSync(join(tmpdir(), "contacts-")), "nested", "contacts.json");
    fileContactCache(path).set("k", found);
    expect(fileContactCache(path).get("k")).toEqual(found);
    expect(JSON.parse(readFileSync(path, "utf8"))["k"].v).toEqual(found);
  });

  it("expires entries after 30 days", () => {
    const path = join(mkdtempSync(join(tmpdir(), "contacts-")), "contacts.json");
    writeFileSync(path, JSON.stringify({
      old: { at: Date.now() - 31 * 86_400_000, v: found },
      fresh: { at: Date.now() - 29 * 86_400_000, v: found },
    }));
    const cache = fileContactCache(path);
    expect(cache.get("old")).toBeUndefined();
    expect(cache.get("fresh")).toEqual(found);
  });

  it("treats a broken file as empty and never throws", () => {
    const dir = mkdtempSync(join(tmpdir(), "contacts-"));
    const path = join(dir, "contacts.json");
    writeFileSync(path, "{ not json");
    const cache = fileContactCache(path);
    expect(cache.get("k")).toBeUndefined();
    expect(() => cache.set("k", found)).not.toThrow();
    expect(cache.get("k")).toEqual(found);
    expect(() => fileContactCache(dir).set("k", found)).not.toThrow();   // a directory is unwritable as a file
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

describe("providers", () => {
  it("exa: request shape and response mapping", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse({
        results: [{ url: "https://a.example", title: "A", text: "hello" }, { url: "https://b.example", title: "B" }, { nope: 1 }],
        costDollars: { total: 0.007 },
      });
    }) as unknown as typeof fetch;
    const out = await exaProvider("KEY", fetchImpl).search("q", "obj");
    expect(calls[0]!.url).toBe("https://api.exa.ai/search");
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.headers).toEqual({ "x-api-key": "KEY", "content-type": "application/json" });
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      query: "q", type: "auto", numResults: 6, userLocation: "US", contents: { text: { maxCharacters: 1500 } },
    });
    expect(out).toEqual({
      results: [{ url: "https://a.example", title: "A", text: "hello" }, { url: "https://b.example", title: "B", text: "" }],
      costDollars: 0.007,
    });
  });

  it("parallel: request shape and excerpts joined into text", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse({ results: [{ url: "https://a.example", title: "A", excerpts: ["one", "two"] }] });
    }) as unknown as typeof fetch;
    const out = await parallelProvider("KEY", fetchImpl).search("q", "obj");
    expect(calls[0]!.url).toBe("https://api.parallel.ai/v1/search");
    expect(calls[0]!.init.headers).toEqual({ "x-api-key": "KEY", "content-type": "application/json" });
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ objective: "obj", search_queries: ["q"], mode: "fast" });
    expect(out.results).toEqual([{ url: "https://a.example", title: "A", text: "one\ntwo" }]);
    expect(out.costDollars).toBeUndefined();
  });

  it("non-2xx throws '<provider> search -> HTTP <status>'", async () => {
    const f = (async () => jsonResponse({}, 429)) as unknown as typeof fetch;
    await expect(exaProvider("K", f).search("q", "o")).rejects.toThrow("exa search -> HTTP 429");
    await expect(parallelProvider("K", f).search("q", "o")).rejects.toThrow("parallel search -> HTTP 429");
  });

  it("providerFromEnv: exa first, then parallel, else null", () => {
    expect(providerFromEnv({ EXA_API_KEY: "a", PARALLEL_API_KEY: "b" })?.name).toBe("exa");
    expect(providerFromEnv({ PARALLEL_API_KEY: "b" })?.name).toBe("parallel");
    expect(providerFromEnv({ EXA_API_KEY: "", PARALLEL_API_KEY: "b" })?.name).toBe("parallel");
    expect(providerFromEnv({})).toBeNull();
  });
});

import { describe, it, expect, vi } from "vitest";
import { probeEntities, publishedDomain } from "../../packages/qualify/src/verbs/probe.js";
import { webPresence } from "../../packages/qualify/src/verbs/brief.js";
import type { Entity } from "../../packages/registry-core/src/entity.js";

function entity(overrides: Partial<Entity>): Entity {
  return {
    id: "co_sos:1", name: "Acme Jewelers LLC", names: [], status: "Good Standing",
    address: { city: "Denver" }, officers: [], naics: [], contacts: [],
    source_ids: ["co_sos"], evidence: [], ...overrides,
  };
}

// DoH stub: `live` maps domain -> which record types exist.
function dohFetch(live: Record<string, string[]>) {
  return vi.fn(async (url: string) => {
    const u = new URL(url);
    const name = u.searchParams.get("name")!;
    const type = u.searchParams.get("type")!;
    const answers = (live[name] ?? []).includes(type) ? [{ data: "x" }] : [];
    return {
      ok: true,
      json: async () => ({ Status: answers.length > 0 ? 0 : 3, Answer: answers }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("publishedDomain", () => {
  it("never takes a domain from an email address", () => {
    expect(publishedDomain(entity({ contacts: ["bob@gmail.com", "sales@acmegems.com"] }))).toBeNull();
  });

  it("extracts website hosts", () => {
    expect(publishedDomain(entity({ contacts: ["https://www.acmegems.com/about"] }))).toBe("acmegems.com");
  });

  it("returns null with no usable contact", () => {
    expect(publishedDomain(entity({ contacts: ["(303) 555-0100"] }))).toBeNull();
  });

  it("does not take a dotted phone number as a host", () => {
    expect(publishedDomain(entity({ contacts: ["303.555.0100"] }))).toBeNull();
  });

  it("an email-only entity has no published domain and no web presence", () => {
    const e = entity({ contacts: ["ldiess@mccarronlaw.com"] });
    expect(publishedDomain(e)).toBeNull();
    expect(webPresence(e, undefined)).toBe("none");
  });
});

describe("probeEntities", () => {
  it("makes zero DNS requests for an entity with no published contact and records the no-published-domain evidence", async () => {
    const e = entity({ name: "Acme Jewelers LLC", contacts: [] });
    const fetchImpl = vi.fn(async () => {
      throw new Error("should not be called — no published domain to verify");
    }) as unknown as typeof fetch;
    const results = await probeEntities([e], { fetchImpl });
    const r = results.get(e.id)!;
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.domain).toBeNull();
    expect(r.tried).toEqual([]);
    expect(e.evidence.some(ev => ev.note === "no published domain to verify — use the web-search link")).toBe(true);
  });

  it("records a non-resolving published domain", async () => {
    const e = entity({ name: "Acme Jewelers LLC", contacts: ["https://acmejewelers.com"] });
    const results = await probeEntities([e], { fetchImpl: dohFetch({}) });
    const r = results.get(e.id)!;
    expect(r.domain).toBeNull();
    expect(r.tried).toEqual(["acmejewelers.com"]);
    expect(e.evidence.some(ev => ev.note === "published domain did not resolve (A/MX both empty)")).toBe(true);
  });

  it("verifies the published domain instead of guessing and adds no email guess when one is published", async () => {
    const e = entity({ contacts: ["debbiel@leevers.com", "https://leevers.com"], name: "Leevers Supermarkets Inc" });
    const results = await probeEntities([e], {
      fetchImpl: dohFetch({ "leevers.com": ["A", "MX"] }),
    });
    const r = results.get(e.id)!;
    expect(r.domain).toBe("leevers.com");
    expect(r.published).toBe(true);
    expect(r.emailGuess).toBeNull();
    expect(r.tried).toEqual(["leevers.com"]);
  });

  it("flags entities missing the existence source", async () => {
    const e = entity({ id: "paca:1", source_ids: ["paca"] });
    await probeEntities([e], { fetchImpl: dohFetch({}), existenceSourceId: "co_sos" });
    expect(e.evidence.some(ev => ev.field === "existence" && ev.note?.includes("not found in co_sos"))).toBe(true);
  });

  it("respects the probe limit", async () => {
    const list = [entity({ id: "a" }), entity({ id: "b" }), entity({ id: "c" })];
    const results = await probeEntities(list, { fetchImpl: dohFetch({}), limit: 2 });
    expect(results.size).toBe(2);
  });
});

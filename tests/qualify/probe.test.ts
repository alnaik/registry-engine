import { describe, it, expect, vi } from "vitest";
import { probeEntities, publishedDomain, slugCandidates } from "../../packages/qualify/src/verbs/probe.js";
import type { Entity } from "../../packages/registry-core/src/entity.js";

function entity(overrides: Partial<Entity>): Entity {
  return {
    id: "co_sos:1", name: "Acme Jewelers LLC", names: [], status: "Good Standing",
    address: { city: "Denver" }, officers: [], categories: [], contacts: [],
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

describe("slugCandidates", () => {
  it("derives slugs from the normalized name, dropping org suffixes and noise words", () => {
    const e = entity({ name: "The Hi Land Potato Co Inc" });
    expect(slugCandidates(e)).toEqual(["hilandpotato.com", "hiland.com"]);
  });

  it("skips too-short slugs", () => {
    expect(slugCandidates(entity({ name: "AB Co" }))).toEqual([]);
  });
});

describe("publishedDomain", () => {
  it("prefers a published email domain and ignores freemail", () => {
    expect(publishedDomain(entity({ contacts: ["bob@gmail.com", "sales@acmegems.com"] }))).toBe("acmegems.com");
  });

  it("extracts website hosts", () => {
    expect(publishedDomain(entity({ contacts: ["https://www.acmegems.com/about"] }))).toBe("acmegems.com");
  });

  it("returns null with no usable contact", () => {
    expect(publishedDomain(entity({ contacts: ["(303) 555-0100"] }))).toBeNull();
  });
});

describe("probeEntities", () => {
  it("finds a live guessed domain, records A/MX, and pattern-guesses an email marked UNVERIFIED", async () => {
    const e = entity({ name: "Acme Jewelers LLC" });
    const results = await probeEntities([e], {
      fetchImpl: dohFetch({ "acmejewelers.com": ["A", "MX"] }),
    });
    const r = results.get(e.id)!;
    expect(r.domain).toBe("acmejewelers.com");
    expect(r.a).toBe(true);
    expect(r.mx).toBe(true);
    expect(r.emailGuess).toBe("info@acmejewelers.com");
    expect(e.contacts).toContain("https://acmejewelers.com");
    expect(e.contacts).toContain("info@acmejewelers.com");
    expect(e.evidence.some(ev => ev.field === "email" && ev.note?.includes("UNVERIFIED"))).toBe(true);
  });

  it("falls through candidates and records a miss when nothing is live", async () => {
    const e = entity({ name: "Acme Jewelers LLC" });
    const results = await probeEntities([e], { fetchImpl: dohFetch({}) });
    const r = results.get(e.id)!;
    expect(r.domain).toBeNull();
    expect(r.tried).toEqual(["acmejewelers.com", "acmejewel.com"].slice(0, r.tried.length));
    expect(e.evidence.some(ev => ev.note?.includes("no live domain"))).toBe(true);
  });

  it("verifies the published domain instead of guessing and adds no email guess when one is published", async () => {
    const e = entity({ contacts: ["debbiel@leevers.com"], name: "Leevers Supermarkets Inc" });
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
    expect(e.evidence.some(ev => ev.field === "existence" && ev.note?.includes("no co_sos match"))).toBe(true);
  });

  it("respects the probe limit", async () => {
    const list = [entity({ id: "a" }), entity({ id: "b" }), entity({ id: "c" })];
    const results = await probeEntities(list, { fetchImpl: dohFetch({}), limit: 2 });
    expect(results.size).toBe(2);
  });
});

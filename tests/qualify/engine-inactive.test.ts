import { describe, it, expect, vi, afterEach } from "vitest";
import { loadManifest } from "../../packages/registry-core/src/manifest.js";
import { splitStatusSuffix } from "../../packages/registry-core/src/entity.js";
import { search } from "../../packages/qualify/src/engine.js";

// Audit finding 2: a dissolved business read as "Not on state registry".
// Colorado's SoS appends ", Dissolved <date>" to the name of a dissolved
// entity, and the backfill only asked for Good Standing rows. With
// quirks.backfillInactive the driver also asks for inactive rows; the engine
// matches them on the bare name (locality guard kept) and the lead says the
// registry's own status.

const MANIFEST = {
  sources: [
    {
      id: "xx_sos", name: "Mockland Secretary of State", plane: "existence", driver: "socrata",
      coverage: { geo: ["US-XX"], naics: ["*"] },
      endpoint: "https://data.example.gov/resource",
      fields: { id: "biz_number", name: "biz_legal_name", status: "standing", city: "office_city" },
      quirks: { datasetId: "zzzz-9999", statusValue: "Good Standing", backfillInactive: true },
    },
    {
      id: "xx_cat", name: "Mockland Produce Category Shard", plane: "category", driver: "static_shard",
      coverage: { geo: ["US-XX"], naics: ["4244"] },
      endpoint: "https://shards.example/xx_cat",
      fields: { id: "biz_id", name: "biz_name", status: "biz_status", city: "biz_city" },
      quirks: { shardRegions: ["US-XX"] },
    },
  ],
};

const SHARD = [
  { biz_id: "1", biz_name: "MOCK TRADING LLC", biz_status: "ACTIVE", biz_city: "MOCKTOWN" },
  { biz_id: "2", biz_name: "GHOST VENTURES LLC", biz_status: "ACTIVE", biz_city: "MOCKTOWN" },
  { biz_id: "3", biz_name: "FAR AWAY PRODUCE", biz_status: "ACTIVE", biz_city: "MOCKTOWN" },
];
const ACTIVE = [{ biz_number: "77", biz_legal_name: "MOCK TRADING, LLC", standing: "Good Standing", office_city: "MOCKTOWN" }];
const INACTIVE = [
  { biz_number: "78", biz_legal_name: "GHOST VENTURES LLC, Dissolved October 23, 2026", standing: "Voluntarily Dissolved", office_city: "MOCKTOWN" },
  { biz_number: "79", biz_legal_name: "FAR AWAY PRODUCE, Delinquent January 1, 2025", standing: "Delinquent", office_city: "OTHERTOWN" },
];

afterEach(() => vi.unstubAllGlobals());

describe("engine — inactive registry rows", () => {
  it("parses the CO SoS status suffixes", () => {
    expect(splitStatusSuffix("ACME TENT & CANVAS CO., Dissolved October 23, 2026")).toEqual({ name: "ACME TENT & CANVAS CO.", status: "Dissolved", date: "2026-10-23" });
    expect(splitStatusSuffix("MERIT LAND AND CATTLE COMPANY, INC., Delinquent September 1, 2013")).toEqual({ name: "MERIT LAND AND CATTLE COMPANY, INC.", status: "Delinquent", date: "2013-09-01" });
    expect(splitStatusSuffix("Wild Blue Company, Inc., Colorado Authority Terminated September 1, 2005")?.status).toBe("Colorado Authority Terminated");
    expect(splitStatusSuffix("MOUNT AUBURN HOSPITAL, Colorado Authority Relinquished October 23, 2026")?.name).toBe("MOUNT AUBURN HOSPITAL");
    expect(splitStatusSuffix("SPRING LIGHT CO., LIMITED")).toBeNull();
    expect(splitStatusSuffix("SMITH, JOHN A")).toBeNull();
  });

  it("asks for inactive rows separately and labels a dissolved lead by its status, not 'not found'", async () => {
    const wheres: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("shards.example/xx_cat/US-XX.json")) {
        return { ok: true, status: 200, json: async () => ({ records: SHARD }) } as unknown as Response;
      }
      if (url.includes("data.example.gov/resource")) {
        const where = decodeURIComponent(url.split("$where=")[1]!.split("&")[0]!);
        wheres.push(where);
        const rows = where.includes("standing<>'Good Standing'") ? INACTIVE : where.includes("standing='Good Standing'") ? ACTIVE : [];
        return { ok: true, status: 200, json: async () => rows } as unknown as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch);

    const out = await search("produce suppliers in mocktown", { sources: loadManifest(MANIFEST), region: "US-XX", probeLimit: 25, contacts: null });
    expect(wheres.some(w => w.startsWith("standing='Good Standing'"))).toBe(true);
    expect(wheres.some(w => w.startsWith("standing<>'Good Standing'"))).toBe(true);

    const by = (name: string) => out.ranked.find(l => l.entity.name === name)!;
    expect(by("MOCK TRADING, LLC").registryCheck).toBe("matched");

    const ghost = by("GHOST VENTURES LLC");
    expect(ghost.registryCheck).toBe("inactive");
    expect(ghost.registryStanding).toEqual({ status: "Voluntarily Dissolved", since: "2026-10-23", filedName: "GHOST VENTURES LLC, Dissolved October 23, 2026" });
    // not merged: the lead keeps its own name and isn't counted as confirmed
    expect(ghost.entity.source_ids).toEqual(["xx_cat"]);
    expect(ghost.entity.evidence.some(ev => ev.note?.startsWith("not found in"))).toBe(false);
    expect(ghost.entity.evidence.some(ev => ev.note === 'on xx_sos as "Voluntarily Dissolved" — not in good standing; confirm it still operates')).toBe(true);

    // locality guard: a delinquent namesake in another town is not this lead
    const far = by("FAR AWAY PRODUCE");
    expect(far.registryCheck).toBe("checked_not_found");
    expect(far.registeredElsewhere).toBe(true);
    expect(far.registryStanding).toBeUndefined();
  });
});

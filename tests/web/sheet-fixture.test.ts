import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { createServer, request } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { createApp } from "../../apps/web/src/server.js";
import { sheetSearch } from "./fixtures/sheet-outcome.js";
import { FILTERS, summaryParts } from "../../apps/web/public/labels.js";

// The fixture behind the hermetic accessibility check (scripts/a11y/axe.ts)
// must keep producing every part of the field sheet through the real server.
describe("field sheet fixture", () => {
  let server: Server;
  let port = 0;

  beforeAll(async () => {
    server = createServer();
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
    server.on("request", createApp({
      search: sheetSearch,
      llmAvailable: async () => false,
      contactsProvider: () => null,
      port,
      publicDir: fileURLToPath(new URL("../../apps/web/public", import.meta.url)),
    }));
  });
  afterAll(() => new Promise<void>(resolve => { server.close(() => resolve()); }));

  const runSearch = (): Promise<string> => new Promise<string>((resolve, reject) => {
      const req = request({
        host: "127.0.0.1", port, method: "POST", path: "/api/search",
        headers: { Host: `localhost:${port}`, "Content-Type": "application/json" },
      }, res => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      });
      req.on("error", reject);
      req.end(JSON.stringify({ query: "Someone to sew 500 custom tote bags", near: "Denver", noLlm: true, naics: "314910, 315210" }));
  });

  it("streams a result with bands, every trust state, and the three groups", async () => {
    const text = await runSearch();
    const events = text.split("\n").filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>);
    const result = events.find(e => e["type"] === "result") as Record<string, unknown> & {
      leads: { registryCheck: string; registeredElsewhere: boolean; band: string }[];
      more: unknown[]; individuals: { mapsUrl: unknown; searchUrl: unknown }[]; nameOnly: unknown[]; recent: unknown[];
    };
    expect(result).toBeDefined();
    const main = [...result.leads, ...(result.more as typeof result.leads)];
    expect(main).toHaveLength(8);
    expect(new Set(main.map(l => l.band)).size).toBe(2);
    expect(new Set(main.map(l => l.registryCheck))).toEqual(new Set(["matched", "checked_not_found", "not_checked"]));
    expect(main.some(l => l.registeredElsewhere)).toBe(true);
    expect(result.individuals).toHaveLength(1);
    expect(result.individuals[0]!.mapsUrl).toBeNull();
    expect(result.individuals[0]!.searchUrl).toBeNull();
    expect(result.nameOnly).toHaveLength(1);
    expect(result.recent).toHaveLength(1);
  });

  // Audit finding 1: the summary sentence and the filter chips count the same
  // rows. The fixture's individual's record is matched on the registry, so a
  // count over all coded records would say one more confirmed than the chip.
  it("the summary sentence and the filter chips agree on businesses and confirmed", async () => {
    const result = (await runSearch()).split("\n").filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>)
      .find(e => e["type"] === "result") as Record<string, unknown> & {
        leads: Record<string, unknown>[]; more: Record<string, unknown>[]; individuals: unknown[];
        sheet: { businesses: number; listed: number; confirmed: number; individuals: number };
      };
    const rows = [...result.leads, ...result.more];
    const chip = (id: string) => rows.filter(l => FILTERS.find(f => f[0] === id)![2](l, undefined)).length;
    expect(result.sheet.businesses).toBe(rows.length);
    expect(result.sheet.listed).toBe(rows.length);
    expect(chip("all")).toBe(result.sheet.businesses);
    expect(chip("confirmed")).toBe(result.sheet.confirmed);
    expect(result.sheet.individuals).toBe(result.individuals.length);
    const sentence = summaryParts(result).map(p => p[0]).join("");
    expect(sentence).toMatch(new RegExp(`^${chip("all")} businesses are coded`));
    expect(sentence).toContain(` ${chip("confirmed")} are confirmed on the state registry.`);
    expect(sentence).toContain("1 individual's record is listed separately.");
  });
});

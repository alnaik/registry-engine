import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { createServer, request } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { createApp } from "../../apps/web/src/server.js";
import { sheetSearch } from "./fixtures/sheet-outcome.js";

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

  it("streams a result with bands, every trust state, and the three groups", async () => {
    const text = await new Promise<string>((resolve, reject) => {
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
});

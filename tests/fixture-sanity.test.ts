import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";

const fixturesDir = join(import.meta.dirname, "fixtures");

function loadFixture(name: string) {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf-8")) as unknown[];
}

describe("Colorado dataset fixtures", () => {
  it("entities fixture has records with expected fields", () => {
    const rows = loadFixture("entities-good-standing.json");
    expect(rows.length).toBeGreaterThan(0);
    const first = rows[0] as Record<string, unknown>;
    expect(first).toHaveProperty("entityid");
    expect(first).toHaveProperty("entityname");
    expect(first).toHaveProperty("entitystatus");
    expect(first["entitystatus"]).toBe("Good Standing");
    expect(first).toHaveProperty("principalzipcode");
    expect(first).toHaveProperty("entityformdate");
  });

  it("trade names fixture has records with expected fields", () => {
    const rows = loadFixture("trade-names.json");
    expect(rows.length).toBeGreaterThan(0);
    const first = rows[0] as Record<string, unknown>;
    expect(first).toHaveProperty("mastertradenameid");
    expect(first).toHaveProperty("tradenamedescription");
    expect(first).toHaveProperty("entityid");
    // NOTE: trade names use "GOOD" not "Good Standing" — see docs/data/colorado-trade-names.md
    expect(first["entitystatus"]).toBe("GOOD");
  });

  it("transactions fixture has records with expected fields", () => {
    const rows = loadFixture("transactions.json");
    expect(rows.length).toBeGreaterThan(0);
    const first = rows[0] as Record<string, unknown>;
    expect(first).toHaveProperty("entityid");
    expect(first).toHaveProperty("transactionid");
    expect(first).toHaveProperty("historydes");
    expect(first).toHaveProperty("receiveddate");
  });

  it("ucc debtors fixture has records with expected fields", () => {
    const rows = loadFixture("ucc-debtors.json");
    expect(rows.length).toBeGreaterThan(0);
    const first = rows[0] as Record<string, unknown>;
    expect(first).toHaveProperty("fileid");
    expect(first).toHaveProperty("organizationname");
    expect(first).toHaveProperty("recordstatus");
  });
});

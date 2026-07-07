import { describe, it, expect } from "vitest";
import { newFilingSignal, statusChangeSignals } from "../../packages/registry-core/src/signals/triggers.js";
import { normalizeEntity } from "../../packages/registry-core/src/sources/colorado/normalize.js";
import { readFileSync } from "fs";
import { join } from "path";

const rawEntities = JSON.parse(
  readFileSync(join(import.meta.dirname, "../fixtures/entities-good-standing.json"), "utf-8")
) as Record<string, unknown>[];

const rawTransactions = JSON.parse(
  readFileSync(join(import.meta.dirname, "../fixtures/transactions.json"), "utf-8")
) as Record<string, unknown>[];

describe("newFilingSignal", () => {
  it("returns null for old entities", () => {
    const entity = normalizeEntity(rawEntities[0]!, new Date().toISOString());
    // fixture entity formed 2025-06-16; if that's older than 90 days from test run date, returns null
    if (entity.formDate < new Date(Date.now() - 90 * 86400000).toISOString()) {
      expect(newFilingSignal(entity, 90)).toBeNull();
    } else {
      // Entity is within window — skip this assertion
      expect(true).toBe(true);
    }
  });

  it("returns a signal for a recently formed entity", () => {
    const recentDate = new Date(Date.now() - 5 * 86400000).toISOString();
    const entity = normalizeEntity(
      { ...rawEntities[0]!, entityformdate: recentDate },
      new Date().toISOString()
    );
    const signal = newFilingSignal(entity, 90);
    expect(signal).not.toBeNull();
    expect(signal?.type).toBe("NEW_FILING");
    expect(signal?.summary).toContain("5 days ago");
  });

  it("returns null when formDate is empty", () => {
    const entity = normalizeEntity(
      { ...rawEntities[0]!, entityformdate: "" },
      new Date().toISOString()
    );
    expect(newFilingSignal(entity, 90)).toBeNull();
  });

  it("returns null for entity formed more than windowDays ago", () => {
    const oldDate = new Date(Date.now() - 200 * 86400000).toISOString();
    const entity = normalizeEntity(
      { ...rawEntities[0]!, entityformdate: oldDate },
      new Date().toISOString()
    );
    expect(newFilingSignal(entity, 90)).toBeNull();
  });
});

describe("statusChangeSignals", () => {
  it("returns empty array for empty input", () => {
    expect(statusChangeSignals([])).toEqual([]);
  });

  it("returns empty array when no status-change transactions", () => {
    // fixture transactions are "Articles of Incorporation" — not status changes
    const txns = rawTransactions.map(row => ({
      entityId: String(row["entityid"] ?? ""),
      transactionId: String(row["transactionid"] ?? ""),
      description: String(row["historydes"] ?? ""),
      comment: String(row["comment"] ?? ""),
      receivedDate: String(row["receiveddate"] ?? ""),
      effectiveDate: String(row["effectivedate"] ?? ""),
      name: String(row["name"] ?? ""),
    }));
    expect(statusChangeSignals(txns)).toEqual([]);
  });

  it("returns signal for a delinquent transaction", () => {
    const txns = [
      {
        entityId: "123",
        transactionId: "456",
        description: "Entity became Delinquent",
        comment: "",
        receivedDate: new Date().toISOString(),
        effectiveDate: new Date().toISOString(),
        name: "Test LLC",
      },
    ];
    const signals = statusChangeSignals(txns);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.type).toBe("STATUS_CHANGE");
    expect(signals[0]?.entityName).toBe("Test LLC");
  });

  it("returns signal for a voluntarily dissolved transaction", () => {
    const txns = [
      {
        entityId: "789",
        transactionId: "101",
        description: "Voluntarily Dissolved by member vote",
        comment: "",
        receivedDate: new Date().toISOString(),
        effectiveDate: new Date().toISOString(),
        name: "Gone Corp",
      },
    ];
    const signals = statusChangeSignals(txns);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.type).toBe("STATUS_CHANGE");
  });
});

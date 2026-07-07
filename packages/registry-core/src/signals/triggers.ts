import type { Signal, NormalizedEntity } from "../types.js";
import { isStatusChange } from "../sources/colorado/transactions.js";
import type { RawTransaction } from "../sources/colorado/transactions.js";

export function newFilingSignal(entity: NormalizedEntity, windowDays: number): Signal | null {
  if (!entity.formDate) return null;
  const formed = new Date(entity.formDate);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  if (formed < cutoff) return null;
  const daysAgo = Math.round((Date.now() - formed.getTime()) / 86400000);
  return {
    type: "NEW_FILING",
    entityId: entity.id,
    entityName: entity.name,
    date: entity.formDate,
    summary: `Registered ${daysAgo} day${daysAgo === 1 ? "" : "s"} ago — likely has no established vendor relationships yet`,
  };
}

export function statusChangeSignals(transactions: RawTransaction[]): Signal[] {
  return transactions
    .filter(t => isStatusChange(t.description))
    .map(t => ({
      type: "STATUS_CHANGE" as const,
      entityId: t.entityId,
      entityName: t.name || t.comment || t.entityId,
      date: t.receivedDate,
      summary: `Status change: ${t.description}`,
    }));
}

export function newTradeNameSignal(
  entityId: string,
  entityName: string,
  tradeName: string,
  dateAdded: string,
  windowDays: number
): Signal | null {
  const added = new Date(dateAdded);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  if (added < cutoff) return null;
  return {
    type: "NEW_TRADE_NAME",
    entityId,
    entityName,
    date: dateAdded,
    summary: `New trade name "${tradeName}" registered recently`,
  };
}

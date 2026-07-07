import type { RegistrySource } from "../RegistrySource.js";
import type { NormalizedEntity, Signal, LocationQuery, EntityFilters } from "../../types.js";
import { fetchEntities } from "./entities.js";
import { fetchTradeNamesForEntities } from "./tradeNames.js";
import { fetchTransactionsForEntities } from "./transactions.js";
import { statusChangeSignals } from "../../signals/triggers.js";
import { zipsWithinRadius } from "../../location/geometry.js";
import type { FetchRetryOptions } from "../../util/http.js";

export class ColoradoRegistrySource implements RegistrySource {
  readonly id = "colorado-sos";
  readonly state = "CO";
  readonly capabilities = {
    tradeNames: true,
    transactions: true,
    ucc: true,
    geoQuery: true,  // via zip-centroid fallback
  } as const;

  constructor(private readonly httpOpts: FetchRetryOptions = {}) {}

  async *fetchEntities(query: LocationQuery, filters: EntityFilters = {}): AsyncIterable<NormalizedEntity> {
    // Resolve radius to zip list
    let resolvedQuery = query;
    if (
      query.mode === "radius" &&
      query.lat !== undefined &&
      query.lng !== undefined &&
      query.radiusMeters !== undefined
    ) {
      const zips = zipsWithinRadius(query.lat, query.lng, query.radiusMeters);
      resolvedQuery = { ...query, zips };
    }

    const buffer: NormalizedEntity[] = [];
    for await (const entity of fetchEntities(resolvedQuery, filters, this.httpOpts)) {
      buffer.push(entity);
      // Hydrate trade names in batches of 100
      if (buffer.length >= 100) {
        yield* await this.hydrateTradeNames(buffer);
        buffer.length = 0;
      }
    }
    if (buffer.length > 0) {
      yield* await this.hydrateTradeNames(buffer);
    }
  }

  private async hydrateTradeNames(entities: NormalizedEntity[]): Promise<NormalizedEntity[]> {
    const ids = entities.map(e => e.id);
    const tradeNameMap = await fetchTradeNamesForEntities(ids, this.httpOpts);
    return entities.map(e => ({
      ...e,
      tradeNames: tradeNameMap.get(e.id) ?? [],
    }));
  }

  async fetchSignals(entityIds: string[], windowDays: number): Promise<Signal[]> {
    const signals: Signal[] = [];
    const since = new Date();
    since.setDate(since.getDate() - windowDays);
    const sinceStr = since.toISOString();

    const transactions = await fetchTransactionsForEntities(entityIds, sinceStr, this.httpOpts);
    signals.push(...statusChangeSignals(transactions));

    return signals;
  }
}

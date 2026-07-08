import type { RegistrySource } from "../RegistrySource.js";
import type { NormalizedEntity, LocationQuery, EntityFilters } from "../../types.js";
import { fetchEntities } from "./entities.js";
import { searchEntities } from "./search.js";
import { fetchTradeNamesForEntities } from "./tradeNames.js";
import { zipsWithinRadius } from "../../location/geometry.js";
import type { FetchRetryOptions } from "../../util/http.js";

export class ColoradoRegistrySource implements RegistrySource {
  readonly id = "colorado-sos";
  readonly state = "CO";

  constructor(private readonly httpOpts: FetchRetryOptions = {}) {}

  async *fetchEntities(query: LocationQuery, filters: EntityFilters = {}): AsyncIterable<NormalizedEntity> {
    const resolved = this.resolveRadius(query);
    const buffer: NormalizedEntity[] = [];
    for await (const entity of fetchEntities(resolved, filters, this.httpOpts)) {
      buffer.push(entity);
      if (buffer.length >= 100) {
        yield* await this.hydrateTradeNames(buffer);
        buffer.length = 0;
      }
    }
    if (buffer.length > 0) {
      yield* await this.hydrateTradeNames(buffer);
    }
  }

  async *searchEntities(
    query: LocationQuery,
    keywords: string[],
    filters: EntityFilters = {}
  ): AsyncIterable<NormalizedEntity> {
    const resolved = this.resolveRadius(query);
    const buffer: NormalizedEntity[] = [];
    for await (const entity of searchEntities(resolved, keywords, filters, this.httpOpts)) {
      buffer.push(entity);
      if (buffer.length >= 50) {
        yield* await this.hydrateTradeNames(buffer);
        buffer.length = 0;
      }
    }
    if (buffer.length > 0) {
      yield* await this.hydrateTradeNames(buffer);
    }
  }

  private resolveRadius(query: LocationQuery): LocationQuery {
    if (
      query.mode === "radius" &&
      query.lat !== undefined &&
      query.lng !== undefined &&
      query.radiusMeters !== undefined
    ) {
      return { ...query, zips: zipsWithinRadius(query.lat, query.lng, query.radiusMeters) };
    }
    return query;
  }

  private async hydrateTradeNames(entities: NormalizedEntity[]): Promise<NormalizedEntity[]> {
    const ids = entities.map(e => e.id);
    const tradeNameMap = await fetchTradeNamesForEntities(ids, this.httpOpts);
    return entities.map(e => ({
      ...e,
      tradeNames: tradeNameMap.get(e.id) ?? [],
    }));
  }
}

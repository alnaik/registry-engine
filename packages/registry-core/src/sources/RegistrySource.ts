import type { NormalizedEntity, Signal, LocationQuery, EntityFilters } from "../types.js";

export interface RegistrySource {
  readonly id: string;
  readonly state: string;
  readonly capabilities: {
    readonly tradeNames: boolean;
    readonly transactions: boolean;
    readonly ucc: boolean;
    readonly geoQuery: boolean;
  };
  fetchEntities(query: LocationQuery, filters?: EntityFilters): AsyncIterable<NormalizedEntity>;
  fetchSignals(entityIds: string[], windowDays: number): Promise<Signal[]>;
}

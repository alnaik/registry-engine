export interface NormalizedEntity {
  id: string;
  name: string;
  status: string;
  type: string;
  formDate: string;        // ISO date string
  zipCode: string;
  city: string;
  state: string;
  address: string;
  jurisdiction: string;
  agent: {
    firstName?: string | undefined;
    lastName?: string | undefined;
    orgName?: string | undefined;
    address?: string | undefined;
    city?: string | undefined;
    state?: string | undefined;
    zip?: string | undefined;
  };
  tradeNames: TradeName[];
  source: SourceMeta;
}

export interface TradeName {
  id: string;
  description: string;
  dateAdded: string;
  effectiveDate: string;
}

export interface Signal {
  type: "NEW_FILING" | "STATUS_CHANGE" | "NEW_TRADE_NAME";
  entityId: string;
  entityName: string;
  date: string;
  summary: string;   // plain-English one-liner
}

export interface SourceMeta {
  provider: string;
  datasetId: string;
  fetchedAt: string;
}

export interface LocationQuery {
  mode: "zip" | "radius";
  zips?: string[] | undefined;
  lat?: number | undefined;
  lng?: number | undefined;
  radiusMeters?: number | undefined;
}

export interface EntityFilters {
  status?: string | undefined;    // default: "Good Standing"
  formDateAfter?: string | undefined;  // ISO date
  formDateBefore?: string | undefined;
}

export interface VitalityRow {
  zipCode: string;
  keyword: string;
  formations90d: number;
  dissolutions90d: number;
  formations365d: number;
  dissolutions365d: number;
}

export interface GapRow {
  zipCode: string;
  keyword: string;
  entityCount: number;
  population: number;
  density: number;  // entities per 1000 residents
}

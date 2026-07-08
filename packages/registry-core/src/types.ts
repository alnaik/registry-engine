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

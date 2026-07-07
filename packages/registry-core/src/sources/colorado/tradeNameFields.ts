export const TRADE_NAME_FIELDS = {
  id: "mastertradenameid",
  description: "tradenamedescription",
  effectiveDate: "effectivedate",
  dateAdded: "dateadded",
  entityId: "entityid",
  entityStatus: "entitystatus",
  registrantOrg: "registrantorganization",
} as const;

// NOTE: "GOOD" not "Good Standing" — different from ENTITY_STATUS
export const TRADE_NAME_STATUS = {
  good: "GOOD",
} as const;

export const TRADE_NAME_DATASET_ID = "u7sb-g482";

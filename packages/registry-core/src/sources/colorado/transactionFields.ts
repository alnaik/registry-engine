export const TRANSACTION_FIELDS = {
  entityId: "entityid",
  transactionId: "transactionid",
  description: "historydes",
  comment: "comment",
  receivedDate: "receiveddate",
  effectiveDate: "effectivedate",
  name: "name",
} as const;

export const STATUS_CHANGE_KEYWORDS = [
  "delinquent",
  "voluntarily dissolved",
  "administratively dissolved",
  "reinstated",
  "good standing",
  "withdrawn",
  "revoked",
] as const;

export const TRANSACTION_DATASET_ID = "casm-dbbj";

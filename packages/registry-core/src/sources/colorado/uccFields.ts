export const UCC_FILING_FIELDS = {
  transactionId: "transactionid",
  masterId: "masterdocumentid",
  transactionType: "transactiontype",
  filingDate: "filingdate",
  lapseDate: "lapsedate",
  filingType: "filingtype",
  documentType: "documenttype",
  termination: "terminationflag",
  fileId: "fileid",
} as const;

export const UCC_DEBTOR_FIELDS = {
  debtorId: "debtorid",
  fileId: "fileid",
  recordStatus: "recordstatus",
  recordStatusCode: "recordstatuscode",
  orgName: "organizationname",
  lastName: "lastname",
  firstName: "firstname",
  city: "city",
  state: "state",
  zipCode: "zipcode",
} as const;

export const UCC_SECURED_PARTY_FIELDS = {
  spId: "spid",
  fileId: "fileid",
  // NOTE: "recordstatuscd" (truncated) not "recordstatuscode" — source quirk
  recordStatusCode: "recordstatuscd",
  recordStatus: "recordstatus",
  orgName: "organizationname",
  lastName: "lastname",
  firstName: "firstname",
} as const;

export const UCC_FILING_DATASET_ID = "wffy-3uut";
export const UCC_DEBTOR_DATASET_ID = "8upq-58vz";
export const UCC_SECURED_PARTY_DATASET_ID = "ap62-sav4";

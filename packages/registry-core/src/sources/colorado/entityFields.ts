export const ENTITY_FIELDS = {
  id: "entityid",
  name: "entityname",
  status: "entitystatus",
  type: "entitytype",
  formDate: "entityformdate",
  zipCode: "principalzipcode",
  city: "principalcity",
  state: "principalstate",
  address1: "principaladdress1",
  jurisdiction: "jurisdictonofformation",  // typo in source — intentional
  agentFirstName: "agentfirstname",
  agentLastName: "agentlastname",
  agentOrgName: "agentorganizationname",
  agentAddress1: "agentprincipaladdress1",
  agentCity: "agentprincipalcity",
  agentState: "agentprincipalstate",
  agentZip: "agentprincipalzipcode",
} as const;

export const ENTITY_STATUS = {
  goodStanding: "Good Standing",
  delinquent: "Delinquent",
} as const;

export const ENTITY_DATASET_ID = "4ykn-tg5h";
export const SOCRATA_BASE = "https://data.colorado.gov/resource";

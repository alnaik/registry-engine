# Colorado Business Entities

**Dataset:** Business Entities in Colorado
**Socrata ID:** `4ykn-tg5h`
**Endpoint:** `https://data.colorado.gov/resource/4ykn-tg5h.json`
**Source:** Colorado Secretary of State
**Last verified:** 2026-07-07

## Schema (observed from live data)

All field names are lowercase. Observed 2026-07-07.

| Field                   | Type           | Notes                                                   |
|-------------------------|----------------|---------------------------------------------------------|
| `entityid`              | text           | Primary key. Format: `YYYYNNNNNNNNN`                    |
| `entityname`            | text           | Legal entity name                                       |
| `entitystatus`          | text           | `"Good Standing"`, `"Delinquent"`, `"Voluntarily Dissolved"`, etc. |
| `entitytype`            | text           | `"DLLC"` (domestic LLC), `"DNC"` (domestic nonprofit corp), etc. |
| `entityformdate`        | calendar_date  | ISO 8601 string: `"2025-06-16T00:00:00.000"`           |
| `jurisdictonofformation`| text           | Typo in source (`jurisdicton`, not `jurisdiction`) — **do not fix** |
| `principaladdress1`     | text           | Street address — often a registered agent address       |
| `principaladdress2`     | text           | Apt/suite                                               |
| `principalcity`         | text           |                                                         |
| `principalstate`        | text           |                                                         |
| `principalzipcode`      | text           | String, not int; use for zip-list SoQL filter           |
| `principalcountry`      | text           | Usually `"US"`                                          |
| `mailingaddress1`       | text           | May differ from principal; often absent                 |
| `mailingaddress2`       | text           |                                                         |
| `mailingcity`           | text           |                                                         |
| `mailingstate`          | text           |                                                         |
| `mailingzipcode`        | text           |                                                         |
| `mailingcountry`        | text           |                                                         |
| `agentfirstname`        | text           | Registered agent — may be a person or org               |
| `agentmiddlename`       | text           |                                                         |
| `agentlastname`         | text           |                                                         |
| `agentsuffix`           | text           |                                                         |
| `agentorganizationname` | text           | Set when agent is an org (CT Corp, LegalZoom, etc.)     |
| `agentprincipaladdress1`| text           |                                                         |
| `agentprincipaladdress2`| text           |                                                         |
| `agentprincipalcity`    | text           |                                                         |
| `agentprincipalstate`   | text           |                                                         |
| `agentprincipalzipcode` | text           |                                                         |
| `agentprincipalcountry` | text           |                                                         |
| `agentmailingaddress1`  | text           |                                                         |
| `agentmailingaddress2`  | text           |                                                         |
| `agentmailingcity`      | text           |                                                         |
| `agentmailingstate`     | text           |                                                         |
| `agentmailingzipcode`   | text           |                                                         |
| `agentmailingcountry`   | text           |                                                         |

## Quirks

1. **`entitystatus` value is `"Good Standing"` (mixed case, two words)** — different from Trade Names which uses `"GOOD"`. Filter with exact string match.
2. **`jurisdictonofformation` is a typo** in the source schema — it has been this way since at least 2020. Do not attempt to rename in code; read it as-is.
3. **Principal address is often the registered agent address**, not the operating location. Do not assume it is the business's storefront or office.
4. **`entityformdate` is included** but officer names are not — Colorado's SSOS open data does not expose officer/director information.
5. **No `tradedescription` field** — business purpose is NOT in this dataset. Trade names descriptions (`tradenamedescription`) must be joined from `u7sb-g482`.

## SoQL Query Patterns

```
# Good Standing entities in zip 80203:
$where=entitystatus='Good Standing' AND principalzipcode='80203'

# Formed in last 90 days (approximate — use actual date):
$where=entitystatus='Good Standing' AND entityformdate >= '2026-04-08T00:00:00.000'

# Radius query (requires location field — verify this field exists):
$where=within_circle(location, 39.7392, -104.9903, 8047)
```

**Note:** Verify that the `location` point field is present in the API response before using `within_circle`. It did not appear in the metadata column list; it may be a computed field only available as a filter target.

## Update Cadence

Electronic filings only — updates within hours of filing. Dataset freshness verified 2026-07-07.

# Colorado Trade Names

**Dataset:** Trade Names for Businesses in Colorado
**Socrata ID:** `u7sb-g482`
**Endpoint:** `https://data.colorado.gov/resource/u7sb-g482.json`
**Source:** Colorado Secretary of State
**Last verified:** 2026-07-07

## Schema (observed from live data)

| Field                   | Type           | Notes                                                           |
|-------------------------|----------------|-----------------------------------------------------------------|
| `mastertradenameid`     | text           | Primary key for this trade name record                          |
| `tradenamedescription`  | text           | The trade name itself (e.g., "Rise Aesthetic Institute")        |
| `tradenameform`         | text           | Observed value: `"Entity Type"`                                 |
| `effectivedate`         | calendar_date  |                                                                 |
| `dateadded`             | calendar_date  | When the trade name was registered — use for NEW_TRADE_NAME signal |
| `entitystatus`          | text           | **`"GOOD"` (uppercase, one word)** — NOT `"Good Standing"`     |
| `entityformdate`        | calendar_date  | Entity formation date (denormalized from entities dataset)      |
| `entityid`              | text           | Foreign key -> `4ykn-tg5h.entityid`                            |
| `registrantorganization`| text           | Organization registering the trade name                         |
| `firstname`             | text           | Set when registrant is an individual                            |
| `middlename`            | text           |                                                                 |
| `lastname`              | text           |                                                                 |
| `suffix`                | text           |                                                                 |
| `address1`              | text           |                                                                 |
| `address2`              | text           |                                                                 |
| `city`                  | text           |                                                                 |
| `state`                 | text           |                                                                 |
| `zipcode`               | text           |                                                                 |
| `country`               | text           |                                                                 |
| `mailingaddress1`       | text           |                                                                 |
| `mailingaddress2`       | text           |                                                                 |
| `mailingcity`           | text           |                                                                 |
| `mailingstate`          | text           |                                                                 |
| `mailingzipcode`        | text           |                                                                 |
| `mailingcountry`        | text           |                                                                 |

## Critical Quirk: entitystatus Value Mismatch

Trade names use `entitystatus = "GOOD"`, not `"Good Standing"` like the Business Entities dataset.

**Code implication:** The `COLORADO_FIELDS` constants file must map status values differently per dataset. Do NOT use a single `ENTITY_STATUS_GOOD` constant that assumes the same string across datasets. See `src/sources/colorado/` for the per-dataset constants files.

## Key Use

`tradenamedescription` is the primary text source for the prefilter and classify stages — it describes what the business actually does, which `entityname` (the legal name) often does not. Example: legal name `"Norweden LLC"`, trade name `"Rosie and Cozy"` — only the trade name hints at the business type.

## SoQL Query Patterns

```
# Trade names for a specific entity:
$where=entityid='20221471093'

# New trade names since a date (NEW_TRADE_NAME signal):
$where=entitystatus='GOOD' AND dateadded >= '2026-04-08T00:00:00.000'

# Filter active trade names by zip (uses entity's address):
$where=entitystatus='GOOD' AND zipcode='80203'
```

# Colorado Business Entity Transaction History

**Dataset:** Business Entity Transaction History
**Socrata ID:** `casm-dbbj`
**Endpoint:** `https://data.colorado.gov/resource/casm-dbbj.json`
**Source:** Colorado Secretary of State
**Last verified:** 2026-07-07

## Schema (observed from live data)

| Field           | Type          | Notes                                                              |
|-----------------|---------------|--------------------------------------------------------------------|
| `entityid`      | text          | Foreign key -> `4ykn-tg5h.entityid`                               |
| `transactionid` | text          | Primary key for this transaction                                   |
| `historydes`    | text          | Transaction description (e.g., "Articles of Incorporation", "Statement of Change Changing the Registered Agent Information") |
| `comment`       | text          | Additional detail; sometimes contains the entity name              |
| `receiveddate`  | calendar_date | When the filing was received                                       |
| `effectivedate` | calendar_date | When the filing takes effect (often same as receiveddate)          |
| `name`          | text          | Entity name at time of transaction (only present on some rows)     |

## Use for Signals

- **STATUS_CHANGE signal:** Filter `historydes` for keywords like `"Delinquent"`, `"Voluntarily Dissolved"`, `"Reinstated"`, `"Good Standing"`. There is no dedicated `newstatus` field — parse `historydes`.
- **NEW_FILING signal:** The initial filing row has `historydes` values like `"Articles of Incorporation"`, `"Articles of Organization"`. These rows' `receiveddate` should match `entityformdate` in the entities dataset.

## Quirk: No Dedicated Status Field

There is no `oldstatus`/`newstatus` column. Status transitions must be inferred from `historydes` text matching. Recommended approach: maintain a keyword list in a constants file (`STATUS_CHANGE_KEYWORDS`) and match case-insensitively.

## SoQL Query Patterns

```
# All transactions for an entity:
$where=entityid='20171040568'
$order=receiveddate DESC

# Recent transactions (for bulk signal scanning):
$where=receiveddate >= '2026-04-08T00:00:00.000'
$order=receiveddate DESC
```

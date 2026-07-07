# Colorado UCC Datasets

**Source:** Colorado Secretary of State
**Last verified:** 2026-07-07

Three related datasets make up the UCC data. They are joined via `fileid`.

---

## UCC Filing Information

**Dataset:** Uniform Commercial Code (UCC) Filing Information in Colorado
**Socrata ID:** `wffy-3uut`
**Endpoint:** `https://data.colorado.gov/resource/wffy-3uut.json`

| Field                        | Type          | Notes                                                   |
|------------------------------|---------------|---------------------------------------------------------|
| `transactionid`              | text          | Primary key for this transaction                        |
| `masterdocumentid`           | text          | Links amendments/continuations to original filing       |
| `transactiontype`            | text          | `"Initial Filing"`, `"Amendment"`, `"Continuation"`, etc. |
| `filingdate`                 | calendar_date |                                                         |
| `lapsedate`                  | calendar_date | When the financing statement expires (5 years for standard UCC) |
| `filingtype`                 | text          | `"ucc"`, `"lien_hosp"`, etc.                            |
| `documenttype`               | text          | Human-readable description                              |
| `continuation`               | boolean       |                                                         |
| `terminationflag`            | boolean       | True if terminated                                      |
| `financialstatementtype`     | text          |                                                         |
| `manufacturedhometransactions`| text         |                                                         |
| `fileid`                     | text          | Join key -> debtors and secured parties datasets        |

---

## UCC Debtor Information

**Dataset:** Uniform Commercial Code (UCC) Debtor Information in Colorado
**Socrata ID:** `8upq-58vz`
**Endpoint:** `https://data.colorado.gov/resource/8upq-58vz.json`

| Field                  | Type | Notes                                                              |
|------------------------|------|--------------------------------------------------------------------|
| `debtorid`             | text | Primary key                                                        |
| `fileid`               | text | Join key -> `wffy-3uut.fileid` and `ap62-sav4.fileid`             |
| `actiontypecode`       | text | `"A"` = add, `"D"` = delete                                        |
| `actiontype`           | text | `"add"` / `"delete"`                                               |
| `recordstatuscode`     | text | `"A"` = active, `"I"` = inactive                                  |
| `recordstatus`         | text | `"active"` / `"inactive"`                                          |
| `organizationname`     | text | Business name — use for fuzzy match against `entityname`           |
| `lastname`             | text | Set when debtor is an individual                                   |
| `firstname`            | text |                                                                    |
| `address1`             | text |                                                                    |
| `city`                 | text |                                                                    |
| `state`                | text |                                                                    |
| `zipcode`              | text |                                                                    |
| `efsuniqueid`          | text | EFS (Electronic Filing System) unique ID                           |

---

## UCC Secured Party Information

**Dataset:** Secured Party Information in Colorado
**Socrata ID:** `ap62-sav4`
**Endpoint:** `https://data.colorado.gov/resource/ap62-sav4.json`

| Field            | Type | Notes                                                    |
|------------------|------|----------------------------------------------------------|
| `spid`           | text | Primary key                                              |
| `fileid`         | text | Join key -> filings and debtors                          |
| `actiontypecode` | text | `"A"` = add                                              |
| `actiontype`     | text | `"add"`                                                  |
| `recordstatuscd` | text | `"A"` = active (note: differs from debtor field name `recordstatuscode`) |
| `recordstatus`   | text | `"active"`                                               |
| `organizationname`| text | The lender / secured party name (e.g., "GENERAL MOTORS ACCEPTANCE CORP") |
| `lastname`       | text | Set when secured party is an individual                  |
| `firstname`      | text |                                                          |
| `address1`       | text |                                                          |
| `city`           | text |                                                          |
| `state`          | text |                                                          |
| `zipcode`        | text |                                                          |
| `assignor`       | text | `"0"` / `"1"` flag                                       |

---

## UCC Join Strategy

The UCC join for the dossier feature works as follows:

1. Given a `NormalizedEntity.name`, query `8upq-58vz` (debtors) with a name filter.
2. Collect all `fileid` values from matching debtor records.
3. For each `fileid`, query `ap62-sav4` (secured parties) to get the lender names.
4. Filter to active filings (`recordstatus = "active"`) that have not lapsed (`lapsedate` in the future, or absent).

**Fuzziness warning:** Name matching between `organizationname` and `entityname` is inexact. Businesses often abbreviate or vary their legal name in UCC filings (e.g., `"BURT CHEVROLET INC"` vs `"BURT CHEVROLET, INC."` or `"Burt Chevrolet, Inc."`). Normalize to uppercase, strip punctuation for matching. Surface the match confidence in the UI — do not present fuzzy matches as definitive.

## Quirk: `recordstatuscd` vs `recordstatuscode`

The debtor dataset uses `recordstatuscode` but the secured party dataset uses `recordstatuscd` (truncated). These map to the same concept. The code in `src/sources/colorado/` uses per-dataset constants files to isolate these differences.

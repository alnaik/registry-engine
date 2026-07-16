# USDA PACA license registry — probe findings (2026-07-15)

National registry of businesses licensed to buy/sell/broker fresh & frozen
produce in interstate commerce. Category signal: being licensed IS the
"produce" category. Detail records carry principals, trade names, branches,
**telephone, email, website** — usable for both the category and contact
planes.

## Live endpoint (probed, working)

The old `apps.ams.usda.gov/pacasearch` is dead (302 → AMS homepage). The
current tool is a ServiceNow Service Portal (instance `usdaams`):

- Shell: `GET https://apps.mrp.usda.gov/public_search`
  - sets guest session cookies
  - embeds a CSRF token in the HTML: `window.g_ck = '<token>'`
- Data: `POST https://apps.mrp.usda.gov/api/now/sp/widget/public-search?portal_id=8ba176a2db46130012ebfd0e0f9619a9`
  - headers: `Content-Type: application/json`, `X-UserToken: <g_ck>`, session cookies
  - returns HTTP 201, JSON under `result.data`

### Actions

`{"action":"queryDatabase","searchTerm":"","searchMin":"","searchMax":"",
  "searchState":"CO","searchMethod":"contains","searchCategory":"state"}`

- `searchCategory`: `business` | `license` | `city` | `state` | `zip`
- `searchMethod`: `begins` | `contains`
- zip search uses `searchMin`/`searchMax` as a range
- response lists: `records` (licensee matches), `recordsTrade` (trade-name
  matches; `name` = licensee, `name_of_business` = the trade name),
  `recordsBranch` (branch matches), `statesList`

`{"action":"getDetail","entity":"<name>","sys_id":"<sys_id>"}`

- response lists: `records` (full licensee: address, phone, fax, email,
  website, issuance/anniversary dates, claim counts), `principal`,
  `trade`, `branch`, `claim`

### Row shape (queryDatabase records)

```json
{"sys_id":"…","name_of_business":"MCCORMICK & MILNE LLC","physical_city":"MONTE VISTA",
 "physical_state":"CO","physical_zip_code":"81144","license_number":"20051216",
 "license_status":"Terminated - No Longer Subject","total_claim_amount":"$0.00","rowCount":614}
```

`license_status` values seen: `Active`, `Terminated - OOB`,
`Terminated - No Longer Subject`, `Bankrupt`, `Revoked`, … (CO 2026-07:
614 total, 132 Active).

## Why it ships as a static shard in v3.0

The API sends **no CORS headers** and needs the cookie+token bootstrap, so a
claude.ai artifact cannot call it. The `static_shard` driver serves recorded
shards instead: `shards/paca/US-CO.json` (all Active CO licensees incl.
detail contacts, recorded via the protocol above). The future pipeline should
automate shard refresh with this same protocol (Node-side); the scratchpad
recorder that produced the v3.0 shard is ~60 lines against the two actions
above.

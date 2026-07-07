# Colorado Registry Data

**State:** Colorado
**Source agency:** Colorado Secretary of State (SSOS)
**Open data platform:** Socrata — `data.colorado.gov`
**Freshness tier:** Electronic filing — updates within hours of filing
**Last verified:** 2026-07-07

## Dataset Map

| Purpose               | Dataset name                                    | Socrata ID   | Doc                                    |
|-----------------------|-------------------------------------------------|--------------|----------------------------------------|
| Business entities     | Business Entities in Colorado                   | `4ykn-tg5h`  | [details](../data/colorado-business-entities.md) |
| Trade names           | Trade Names for Businesses in Colorado          | `u7sb-g482`  | [details](../data/colorado-trade-names.md) |
| Transaction history   | Business Entity Transaction History             | `casm-dbbj`  | [details](../data/colorado-transactions.md) |
| UCC filings           | UCC Filing Information in Colorado              | `wffy-3uut`  | [details](../data/colorado-ucc.md) |
| UCC debtors           | UCC Debtor Information in Colorado              | `8upq-58vz`  | [details](../data/colorado-ucc.md) |
| UCC secured parties   | Secured Party Information in Colorado           | `ap62-sav4`  | [details](../data/colorado-ucc.md) |

## Query Endpoint Pattern

```
https://data.colorado.gov/resource/<DATASET_ID>.json?$where=...&$select=...&$limit=...&$offset=...
```

Authentication: none required for read access. Optional free Socrata App Token raises rate limit from ~1 req/s to ~4 req/s. Register at `data.colorado.gov/login`.

## Verified Geo Query Support

The `within_circle(location, lat, lng, meters)` SoQL function requires a point column named `location`. **This field did NOT appear in the metadata column list for `4ykn-tg5h` as of 2026-07-07.** Verify its availability before implementing radius queries — it may be a filterable computed column. Fallback: zip-centroid lookup from a bundled Colorado zip table (see `packages/registry-core/src/location/`).

## Census Geocoder CORS Status

The US Census geocoder (`geocoding.geo.census.gov`) is **reachable from server contexts** (verified 2026-07-07). CORS behavior from within a Claude Artifact (`claude.ai` origin) has NOT been verified — requires a manual test by pasting a test artifact. If CORS is blocked, the fallback is a bundled Colorado zip-centroid table derived from the Census Gazetteer (public domain).

## Known Data Limitations

1. **Principal address ≠ operating location.** Many entities list their registered agent (a law firm, LegalZoom, CT Corp, etc.) as their principal address. Do not use this as the physical business location.
2. **No officer/director data.** Colorado SSOS open data does not include officer names. The dossier cannot include officer names from registry data alone.
3. **Trade name coverage is not 100%.** Not all businesses register a trade name. An entity without a trade name may still have a clear business purpose from its legal name.
4. **UCC name matching is fuzzy.** See `docs/data/colorado-ucc.md` for details.
5. **`entityformdate` may predate open records.** Very old entities have formation dates in the 1970s–1990s; their open-data records may be incomplete.

## Recommended Next States

For geographic expansion, these states have same-day or near-real-time open SOS data and active Socrata portals:

| State    | Note                                       |
|----------|--------------------------------------------|
| Delaware | High LLC formation volume; DE entity data  |
| Florida  | `myfloridalicense.com` + Socrata portal    |
| Nevada   | Large registered-agent market              |
| Wyoming  | Fast LLC formation; small business focus   |

To add a state: implement `RegistrySource`, add a `docs/states/<state>.md` file, add a row to `docs/states/README.md`.

# State Registry Freshness Table

Registry Engine is designed so that adding a new state means: implement the `RegistrySource` interface, add a `docs/states/<state>.md` file, add a row here, done.

| State    | Socrata ID (entities) | Freshness          | Status       | Details                        |
|----------|----------------------|--------------------|--------------|-------------------------------|
| Colorado | `4ykn-tg5h`          | Hours (electronic) | Implemented  | [colorado.md](colorado.md)    |

## Adding a State

1. Find the state's SOS open data portal (most use Socrata or OpenGov).
2. Discover dataset IDs by querying the catalog endpoint: `https://<domain>/api/catalog/v1?q=business+entities+secretary+state`.
3. Verify each dataset: fetch metadata (`.json` endpoint on the view) and 5 sample rows.
4. Record observed schema, quirks, and update cadence in `docs/states/<state>.md` and `docs/data/<state>-*.md`.
5. Implement `RegistrySource` in `packages/registry-core/src/sources/<state>/`.
6. Add a row to this table.

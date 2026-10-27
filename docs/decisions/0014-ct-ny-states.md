# 0014 — add US-CT and US-NY existence sources

Status: accepted
Date: 2026-07-18

## Context

Phase 4 surveyed states where both the existence plane and PACA (category
plane) already have data, to grow the socket without touching code. The
2026-07-18 survey covered CT, NY, and WA.

- CT: data.ct.gov `n7gp-d28j` ("Business Registry - Business Master"),
  daily refresh, 452,284 `status='Active'` rows. Driver-shape query
  verified. No officer columns in this dataset.
- NY: data.ny.gov `n9v6-gdp6` ("Active Corporations: Beginning 1800"),
  daily refresh, 4,248,668 rows. No status column — the dataset is
  all-active by construction.
- WA: not available via Socrata. The SoS Data Extract product was
  discontinued and the CCFS portal is interactive/bot-guarded CSV export
  only; the sole Socrata dataset (L&I contractor licenses `m8qx-ubtq`)
  can't join a produce category plane. Deferred.
- PACA active licensees recorded via the `docs/data/paca.md` protocol:
  CT 115, NY 1,324 (CO 132 for reference).

## Decision

Add two existence-plane manifest entries: `ct_sos` (US-CT, data.ct.gov
`n7gp-d28j`) and `ny_dos` (US-NY, data.ny.gov `n9v6-gdp6`), inserted
between `co_sos` and `paca` so `co_sos` stays first and US-CO stays the
default region. Extend `paca`'s `quirks.shardRegions` to
`["US-CO", "US-CT", "US-NY"]` and record the CT and NY shards on the same
gist as US-CO, via the existing `docs/data/paca.md` protocol.

Manifest and shard files only — no change under `packages/*/src` or
`apps/`. The zero-code-state promise (`tests/registry-core/zero-code-state.test.ts`)
held in practice, not just in principle.

NY quirk (documented explicitly): the NY dataset has no status column, so
the canonical `status` field is mapped to `jurisdiction` with
`statusValue: "New York"`. Consequences: (a) foreign (out-of-state
jurisdiction) corporations registered in NY — about 8% of rows — are
excluded; (b) merged NY entities carry the literal string "New York" as
their status rather than a standing value like "Good Standing". Revisit if
NY DOS ever publishes a status-bearing dataset.

CT note: the master dataset carries no officer/agent columns; those live
in sibling datasets (`qh2m-n44y`, `ka36-64k6`) that would require a join.
Deferred — `ct_sos` ships with no `officer_*` fields.

WA rejection (recorded so the survey isn't redone): WA SoS is not
reachable via Socrata by any means found — no Data Extract, no scriptable
CCFS export — and its only Socrata-hosted dataset can't carry a category
plane. WA needs a bespoke driver or a public-records request; deferred.

## Consequences

`knownRegions` grows to `["US-CO", "US-CT", "US-NY"]`; `defaultRegion`
stays `US-CO` because `co_sos` remains first in manifest order. Produce
queries in CT or NY now route to both the new existence source and
`paca`. No driver or engine code changed.

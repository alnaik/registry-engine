# 0009 — Distill to a Query-Driven Pipeline (v2)

## Context

Phases 0–4 built the product as specced: qualification profiles with feedback loops, a four-stage funnel, vitality/gap analytics, UCC joins, and digests. Working backwards from the actual customer flow — type what you want, pick an area on a map, get a verified list — most of that machinery was ceremony around a simple core. Worse, the discover stage fetched *every* Good Standing entity in the area client-side before filtering: a 20km Denver radius means ~300k rows, which is why radius searches failed in the browser.

## Options considered

1. Keep the architecture, fix the radius bug with pagination limits.
2. Rebuild around the user's raw query, pushing filtering into the registry API.

## Decision

Option 2. The pipeline is now four verbs: **fetch → triage → verify → brief.**

- The user's query string *is* the profile. One LLM call derives an ephemeral `SearchIntent` (keywords, exclusions, requirement). Nothing is stored or hardcoded.
- Intent keywords go **into the SoQL query** (`upper(entityname) LIKE '%KW%'`, same for trade-name descriptions), so only candidate rows ever leave the API — hundreds, not hundreds of thousands.
- Stages stream: classify batches run while registry pages are still landing; verification upgrades rows live.
- Deleted from the product surface: profiles, feedback loop, vitality, gaps, UCC, digest. Git history keeps them.

## Consequences

Radius searches work at metro scale. A search costs a handful of LLM calls. Adding a state remains: one adapter + one field-constants file + one script-generated centroid table (`scripts/gen-centroids.mjs`). The trade-off: businesses whose names *and* trade names contain no intent keyword are invisible — accepted, because name text is the only semantic signal a registry has.

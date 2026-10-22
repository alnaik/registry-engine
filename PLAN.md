# v5 Plan — activity-coded discovery

Working branch: `v5-activity-coded`. Rationale: ADR 0015. v4 phases (artifact
removal, `--region`, existence backfill, CT/NY) are done and in git history.

## Goal

A small business owner types what they need ("someone to sew 500 tote bags
near Denver") or what they sell ("who would buy my hot sauce in Boulder") and
gets real local businesses that search engines under-show, as a call sheet
they can act on today.

## Orchestration protocol

- The orchestrator plans, specs, reviews, and owns git. Code changes go to
  the `coder` subagent (`.claude/agents/coder.md`), one written spec per
  phase. The coder implements exactly the spec or returns a DEVIATION
  REQUEST.
- The orchestrator re-runs `npm test` + `npm run typecheck` itself before
  each commit.
- Progress lives in this file. On resume, read it before acting.

## Phases

### Phase 1 — registry-core: NAICS routing + new sources ✅
- NAICS 2017 lookup module (`naics2017.json` built from the Census code
  list + index file by `scripts/data/build_naics.py`).
- `Intent.naics`, `SourceSpec.coverage.naics`, `Entity.naics/employees/lastSeen`
  replace category slugs; `route()` matches by code prefix.
- Field-map additions: `naics`, `employees`, `date`, `address_line`;
  `quirks.defaultNaics`, `quirks.evidenceFields`.
- socrata: optional status filter, `quirks.keywordFields`.
- static_shard: `repo:` endpoints, `quirks.shardBy: "naics2"`, code filter.
- New `echo` driver (EPA ECHO REST).
- Merge: same normalized name only joins when locality is compatible.
- Manifest: `ppp`, `epa_echo`, `co_farm_products`; PACA served from the repo.
- `scripts/data/build_ppp_shards.py` + Colorado shards.

### Phase 2 — qualify + CLI: map, rank, call sheet ✅
- `map`: LLM → validated NAICS codes for the *leads* (direction-aware);
  no-LLM path = small static table (supplier direction) or `--naics`, with
  `codes <words>` to look codes up (an automatic index matcher was tried and
  dropped: too noisy); region words never become keywords.
- Ranking: fit + operating evidence; web presence is a label, not points.
- Brief: actionable (why, what's verified vs. not, how to reach, opener).
- CLI: compact lead cards, `--hidden`, `--csv=<path>`, `--verbose`, summary line.

### Phase 3 — docs + measured validation ✅
- README, CLAUDE.md, SECURITY.md (new URL/SoQL surfaces, individuals' data).
- One recall check vs Census County Business Patterns (bulk file) for a
  manufacturing query, recorded in ADR 0015's follow-up section.

Phase 3 also fixed what the live runs exposed: briefs now see the request and
plain facts (no raw evidence notes), fit follows the map's best-first code
order, generic words never become keywords, NAICS 2022 codes get a parent
title, the summary separates coded matches from name-only ones, and shard
paths reject malformed regions. Validation numbers are in ADR 0015.

### Phase 4 — distance from the user + web contact lookup
- Census Gazetteer ZIP/place centroids (`scripts/data/build_geo.py`).
- A city in the request (or `--near`) becomes the *center*: search the whole
  state, group leads into distance bands, optional `--radius`.
- Contact lookup for the top N leads through Exa or Parallel (env key),
  extracted deterministically (name + place match, directory vs own site),
  with source URLs, cached 30 days, and never run for an individual's record.
  Web text never reaches the LLM. Ranking still ignores contacts.

### Phase 5 — local web app
- `npm start` → http://localhost:4317: search, live progress, results
  grouped by distance, contact/opener/brief cards, outreach tracker
  (localStorage), CSV export, print-friendly call sheet. Vanilla HTML/JS, no
  build, localhost-only with Host check and CSP.

### Phase 6 — independent audit
- A Fable 5.1 (medium effort) audit of the product for correctness, honesty,
  UX and security issues. Fix confirmed high-severity findings and record the
  rest here.

## Known gaps (from live runs, 2026-10-22)
- Most coded leads have no phone/email: PPP, ECHO and SoS publish none. The
  call sheet gives the address, agent/principals and a search link.
- City filters are exact: "near Denver" excludes Aurora/Englewood. Omit the
  city for statewide results.
- PPP codes are self-reported: brands can appear under store codes. The
  brief prompt discloses this.
- Sister LLCs at one address (same agent) show as separate leads.

## Later (only if these gaps hurt real use)
- Metro-area expansion for "near <city>" (zip/county lists in manifest quirks).
- Phones: FMCSA (trucking) and SAM.gov entity POCs as contact-plane sources.
- Liveness for PPP-only leads in Denver: city business licenses (`s9wt-dsfz`).
- Relationship edges: UCC secured parties, PACA claims, federal subawards.

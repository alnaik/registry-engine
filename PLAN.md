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
- Findings (2026-10-22). Fixed in this phase:
  - **H1:** state-registry backfill missed names with `&` or `'` (~7% of PPP
    records). Patterns are now built from raw-name tokens.
  - **H2:** category fit was outranked by distance band and evidence
    ("potato farm" listed hay farms first). Fit now sorts first inside each
    band, and the generic `farm`→`111` table entry is gone.
  - **M1:** briefs credited the SoS with NAICS codes it doesn't carry.
  - **M2:** the `codes` helper missed "metal fabrication". It now stems words
    and matches titles.
  - **M3:** name-only noise was counted as "businesses found". The headline
    is now the coded count, and PACA no longer routes on `311`.
  - **M4:** backfill was slow. Chunks are larger, and the name cap is lower.
  - **M5:** curated cities matched mid-phrase ("golden retriever").
  - **M6:** "sells" in a request flipped the search to finding buyers.
  - **M7:** individuals' records offered a search link on the person's name.
  - **L1–L5:** a SECURITY.md pointer, CLI flag validation, "1 jobs", NY
    status text, PPP being routed outside its shard states, and `HEAD /`.
- Not fixed: none of the confirmed findings was deferred. The security review
  found no gaps beyond L1.

### Phase 7 — small features (user-approved 2026-10-26)
Build in this order, one spec each. Keep each one small, and drop it if
it turns into infrastructure.
- **7a Supplier/buyer switch.** A two-way toggle in the web app ("Find
  suppliers" / "Find buyers") and `--direction=buy|sell` in the CLI.
  `SearchConfig.direction` overrides the map's guess; the map LLM prompt
  receives it as fixed, and the static path uses it in place of
  `SELL_PATTERN`. Default: auto (today's behavior), showing what was guessed.
- **7b Saved searches.** Save query + near + codes + direction in the
  browser (localStorage, next to the tracker). Re-running marks leads not
  seen last time as "New since <date>". Key "seen" on a stable lead key
  (normalized name + ZIP5), **not** `Entity.id`, which depends on which
  source merged first. PPP is a fixed snapshot, so new matches come only
  from live sources (SoS, ECHO, farm products); the UI must say so.
- **7c New-business watch.** A "Recently registered near you" section:
  state-registry entities formed in the last 90 days (CO `entityformdate`,
  CT `date_registration`, NY `initial_dos_filing_date`), within the radius,
  whose name matches the map's keywords. CO and NY filings carry no industry
  code, so these are name matches and must be labeled that way. CT's
  registry has a `naics_code` field holding a title as text, which may allow
  coded matching there. Most useful for buyer searches (a new restaurant
  needs suppliers). Manifest-driven: a `formedDate` field-map key.
- **7d Distance view.** An SVG plot (no map tiles, no new CSP origins, no
  library) with rings at 10/25/50/100 mi around the center and one dot per
  lead at its ZIP centroid; clicking a dot scrolls to its card. Hidden when
  there's no center.

### Phase 8 — web app test pass
Exercise the real web app in a browser at 1280 px and 390 px after Phase 7,
following the checklist in `docs/handoffs/v5-handoff.md`. Fix what's
confirmed, and record the rest here.

## Known gaps (from live runs, 2026-10-22)
- Most coded leads have no phone/email: PPP, ECHO and SoS publish none. The
  call sheet gives the address, agent/principals and a search link. With
  `EXA_API_KEY`/`PARALLEL_API_KEY` the top leads get a web lookup, which has
  not yet been exercised against the live APIs.
- Distance is from ZIP or place centroids, so it's approximate to a mile or
  two. Leads with no usable ZIP fall into "distance unknown".
- Without the AI step, buyer searches need explicit `--naics` codes.
- A business whose state-registry address differs from its PPP address
  (e.g. ACME TENT & CANVAS: PPP Denver 80203, SoS Englewood 80110) isn't
  joined, so it shows "not matched on state registry". The locality guard is
  deliberate: it keeps same-named businesses in different towns apart.
- PPP codes are self-reported: brands can appear under store codes. The
  brief prompt discloses this.
- Sister LLCs at one address (same agent) show as separate leads.

## Later (only if these gaps hurt real use)
- Metro-area expansion for "near <city>" (zip/county lists in manifest quirks).
- Phones: FMCSA (trucking) and SAM.gov entity POCs as contact-plane sources.
- Liveness for PPP-only leads in Denver: city business licenses (`s9wt-dsfz`).
- Relationship edges: UCC secured parties, PACA claims, federal subawards.

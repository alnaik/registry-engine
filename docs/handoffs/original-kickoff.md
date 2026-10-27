# KICKOFF PROMPT — paste everything below this line into Claude Code (Sonnet 4.6)

You are building **Registry Engine** (working name — human may rename), a registry-grounded
local-business discovery and qualification tool. You will implement it exactly per this
document. Do not write code before completing Phase 0. Ask the human only when this document
is genuinely ambiguous; otherwise decide, and record the decision as an ADR.

---

## 1. MISSION & PRODUCT THESIS

Web search and Google Maps show businesses that market themselves. Government registries
enumerate businesses that legally exist. This product queries official state business
registries (starting with Colorado's Secretary of State open data), lets a non-technical
user describe what they're looking for in plain English ("independent jewelers likely to
buy loose diamond cuts", "farms or produce wholesalers that could supply Kennebec potatoes
to a food truck"), and returns qualified, actionable results.

It is direction-agnostic: it finds **customers** (seller mode) and **suppliers** (buyer mode)
with the same engine.

Differentiators (all must survive into the shipped product):
1. **Registry-grounded completeness** — coverage by law, not by web presence.
2. **Natural-language qualification profiles** — arbitrary fit criteria, not fixed categories.
3. **Timing signals ("why now")** — new filings, status transitions, new trade names.
4. **Dossiers, not CSV rows** — a one-page actionable brief per lead.
5. **Registry-exclusive analytics** — UCC supplier intelligence, market vitality, gap density,
   and the negative-space filter (registered but invisible on the web).
6. **Zero cost to operator** — distributed as a Claude Artifact; LLM usage bills each user's
   own Claude subscription. All data sources are free.

Two product concepts adopted from competitor analysis (implement both):
- **Learning loop**: thumbs up/down on qualified leads appends structured feedback to the
  active profile ("user rejected pawn shops", "user approved estate jewelers"), which is
  injected into future classify/qualify calls for that profile.
- **Negative-space filter**: a first-class filter/view for entities that exist in the
  registry but have no discoverable web presence (qualify step found no website). This list
  cannot be produced by Maps-based tools.

## 2. NON-NEGOTIABLE CONSTRAINTS

- **Budget: $0.** No paid APIs, no paid hosting, no services requiring a credit card.
- **Runtime target #1 is a Claude Artifact**: a SINGLE self-contained .jsx file. Constraints:
  React with default export and no required props; Tailwind CORE utility classes only (no
  custom config); NO localStorage/sessionStorage (use in-memory state + the artifact
  `window.storage` key-value API for persistence); LLM calls via
  `fetch("https://api.anthropic.com/v1/messages")` with NO api key (handled by platform),
  `model: "claude-sonnet-4-6"`, and web search enabled via
  `tools: [{"type":"web_search_20250305","name":"web_search"}]` when qualifying.
- **The core engine must not import React or assume a browser.** It must run in Node
  (for the CLI/tests) and in the browser (bundled into the artifact).
- **LLM access is an interface, not a call site.** Implement `LlmBackend` with three
  implementations: `artifactBackend` (the fetch above), `openaiCompatibleBackend`
  (any base URL + key, enables future hosted/local use), `ollamaBackend` (localhost).
  The artifact ships with artifactBackend only; the others live in the engine for the CLI
  and future products.
- **Token frugality is a product requirement, not an optimization.** See §6. Every LLM
  call must pass through the TokenBudgeter. No exceptions.
- **Licensing seam**: `packages/registry-core` is MIT and written as if strangers will read
  it tomorrow (they will — it gets open-sourced first). `packages/qualify` and
  `apps/artifact` are proprietary-for-now but must contain no entanglement that would
  prevent a later license flip.

## 3. REPO STRUCTURE (create exactly this in Phase 0)

```
registry-engine/
├── package.json                  # npm workspaces monorepo, TypeScript everywhere
├── tsconfig.base.json
├── README.md                     # thesis, quickstart, screenshots later
├── LICENSE-MIT                   # applies to packages/registry-core
├── SECURITY.md                   # threat model — see §8, kept current every phase
├── LEARNING.md                   # plain-English education log — see §9
├── docs/
│   ├── decisions/                # ADRs: NNNN-title.md — see §9
│   ├── data/                     # discovered dataset schemas, field notes, quirks
│   └── states/
│       ├── README.md             # the public "state registry freshness table"
│       └── colorado.md           # dataset IDs, recipes, gotchas, update cadence
├── packages/
│   ├── registry-core/            # MIT. The open library. Zero LLM code in here.
│   │   └── src/
│   │       ├── types.ts          # NormalizedEntity, Signal, SourceMeta, LocationQuery
│   │       ├── sources/
│   │       │   ├── RegistrySource.ts     # the adapter interface (see §4)
│   │       │   └── colorado/
│   │       │       ├── entities.ts       # SoQL builder + fetcher, paginated, parallel
│   │       │       ├── tradeNames.ts
│   │       │       ├── transactions.ts   # entity transaction history (status changes)
│   │       │       ├── ucc.ts            # UCC financing statements
│   │       │       └── normalize.ts      # raw rows -> NormalizedEntity
│   │       ├── location/
│   │       │   ├── resolve.ts    # address/city -> lat/lng (Census geocoder, Nominatim fallback)
│   │       │   └── geometry.ts   # radius->within_circle args, zip-list handling
│   │       ├── signals/
│   │       │   ├── triggers.ts   # new-filing, status-transition, new-trade-name
│   │       │   ├── vitality.ts   # formations/dissolutions per zip+category window
│   │       │   ├── gaps.ts       # category density per zip (uses free Census pop data)
│   │       │   └── ucc.ts        # entity<->UCC join, secured-party extraction
│   │       └── util/
│   │           ├── http.ts       # fetch wrapper: retry w/ jittered backoff, 429 handling,
│   │           │                 #   concurrency limiter, optional Socrata app token
│   │           └── cache.ts      # pluggable KV cache interface (memory / window.storage)
│   ├── qualify/                  # proprietary-for-now. All LLM logic lives here.
│   │   └── src/
│   │       ├── llm/
│   │       │   ├── LlmBackend.ts          # interface
│   │       │   ├── artifactBackend.ts
│   │       │   ├── openaiCompatibleBackend.ts
│   │       │   ├── ollamaBackend.ts
│   │       │   └── budgeter.ts            # TokenBudgeter — see §6
│   │       ├── profiles/
│   │       │   ├── schema.ts     # QualificationProfile type (see §5) + validation
│   │       │   ├── feedback.ts   # learning loop: verdict history -> criteria deltas
│   │       │   └── starters/     # diamond-prospect.json, supplier-search.json,
│   │       │                     #   event-vendor.json (drama-teacher use case)
│   │       ├── pipeline/
│   │       │   ├── prefilter.ts  # ONE llm call: profile -> keyword/exclusion sets;
│   │       │   │                 #   then pure-JS filtering of names+trade descriptions
│   │       │   ├── classify.ts   # batched triage, compact TSV in / coded verdicts out
│   │       │   ├── qualifyLead.ts# per-lead: web_search-enabled call -> QualifiedLead
│   │       │   ├── dossier.ts    # assemble brief: registry facts + signals + web verdict
│   │       │   │                 #   + outreach draft; mostly TEMPLATE, minimal LLM
│   │       │   └── run.ts        # orchestrator: funnel stages, progress events, caching
│   │       └── prompts/          # every prompt is a named, versioned exported constant
│   │           └── README.md     # token accounting per prompt (measured, not guessed)
│   └── shared/                   # tiny: csv export (injection-safe), formatting, ids
├── apps/
│   ├── artifact/
│   │   ├── src/App.jsx           # thin shell over the packages; all UI here
│   │   └── src/components/       # SearchSetup, FunnelProgress, ResultsTable,
│   │                             #   DossierDrawer, ProfileEditor, VitalityView,
│   │                             #   GapView, DigestModal, TokenMeter
│   └── cli/
│       └── src/index.ts          # dev harness: run any pipeline stage from terminal
│                                 #   against fixtures or live; used for testing + future
│                                 #   digest generation on a real backend
├── scripts/
│   └── bundle-artifact.mjs       # esbuild: tree-shake packages+app into ONE .jsx,
│                                 #   fail the build if output imports anything banned
│                                 #   (localStorage, process.env, node builtins)
└── tests/
    ├── fixtures/                 # recorded Socrata responses (see Phase 0)
    └── *.test.ts                 # vitest; pipeline tests run against fixtures, never live
```

## 4. DATA LAYER SPEC (packages/registry-core)

**Adapter interface** (`RegistrySource`): `id`, `state`, `capabilities` (flags: tradeNames,
transactions, ucc, geoQuery), `fetchEntities(LocationQuery, filters) -> AsyncIterable<NormalizedEntity>`,
`fetchSignals(entityIds | LocationQuery) -> Signal[]`. Design it so adding a second state
is: implement the interface, add a doc page, done. `docs/states/README.md` explains the
pattern and hosts the freshness table (Colorado: electronic filing, updates within hours;
note other same-day states — DE, FL, NV, WY — as best next targets).

**Colorado datasets** (Socrata SODA API, `https://data.colorado.gov/resource/<id>.json`):
- Business Entities: dataset id `4ykn-tg5h` (VERIFY in Phase 0 — see below).
- Trade Names, Business Entity Transaction History, and UCC filings: dataset IDs must be
  DISCOVERED in Phase 0 via the Socrata catalog (`https://data.colorado.gov/api/catalog/v1?q=...`
  and the SOS "sos-bus" keyword) and recorded in `docs/data/`. **Do not hardcode IDs from
  memory; verify every dataset by fetching its metadata and 5 sample rows first, and commit
  the observed schema to docs/data/.** Government schemas drift; the code must read field
  names from one constants file per dataset so a schema change is a one-line fix.

**Query rules (these are the free 90% of the funnel — get them right):**
- Always filter server-side with SoQL `$where`: entity status (default Good Standing,
  user-toggleable), `principalzipcode IN (...)` for zip mode, `within_circle(location,lat,lng,meters)`
  for radius mode, `entityformdate` ranges for new-filing queries.
- `$select` only needed columns. Paginate with `$limit`/`$offset`; fetch pages CONCURRENTLY
  (limiter: 4 in flight) and stream entities to the pipeline as pages land — do not block
  on the full set. Support an optional free Socrata app token (raises rate limits) via a
  settings field; work without it.
- Aggregations for vitality/gap views use SoQL `$group`/`count(*)` server-side — never pull
  raw rows to count in JS.
- Location resolution: US Census geocoder (free, keyless) first
  (`geocoding.geo.census.gov/geocoder/locations/onelineaddress`), Nominatim fallback
  (respect 1 req/s + attribution). Verify CORS behavior from an artifact context in Phase 0;
  if blocked, document and fall back to zip-centroid lookup from a small bundled table of
  Colorado zip centroids (public domain Census gazetteer data).

**Signals:**
- Triggers per entity: `NEW_FILING` (formdate within N days), `STATUS_CHANGE`
  (from transaction history — e.g., -> Delinquent), `NEW_TRADE_NAME`. Each trigger carries
  a plain-English one-liner ("Registered 12 days ago — likely has no vendor relationships yet").
- UCC join: for qualified leads, look up UCC filings by debtor name match (document the
  fuzziness honestly); extract secured-party names -> "existing financing/supplier
  relationships" section of the dossier.
- Vitality: formations minus dissolutions per category-keyword per zip, trailing 90/365 days.
- Gaps: entity-count per category per zip ÷ population (bundle a small CO zip->population
  table from Census; document vintage).

## 5. QUALIFICATION PIPELINE SPEC (packages/qualify)

**QualificationProfile** (JSON, user-editable, storable, sellable as packs):
`{ id, name, direction: "find_customers"|"find_suppliers", description (the plain-English
criteria), mustHave[], niceToHave[], exclude[], feedback: {approvedTraits[], rejectedTraits[]},
version }`.

**Funnel (strict order — each stage exists to starve the next of tokens):**
1. **Discover** (0 tokens): registry-core streams NormalizedEntity[].
2. **Prefilter** (1 small call per run): profile -> `{includePatterns[], excludePatterns[],
   ambiguousOk: bool}`; then pure-JS matching over entity name + trade-name description.
   Entities matching exclude are dropped; matching include are fast-tracked; the remainder
   is kept only if the run is small. Show counts per stage in the UI (FunnelProgress).
3. **Classify** (batched): batches of ~30. Input format: TSV lines `id<TAB>name<TAB>tradeDesc`
   (truncate tradeDesc to 120 chars). Output format REQUIRED: `id:V` lines where V ∈
   {Y,N,U}. No JSON envelope, no prose. Parse defensively; unparseable line = U.
4. **Qualify** (per-lead, USER-TRIGGERED on selected leads only, concurrency 3):
   one call with web_search enabled, `max_uses: 2` on the tool if supported, low max_tokens.
   Task: find the business's web presence; verify operating status; extract what they
   sell/buy; score fit 0–100 against the profile; produce a ≤40-word rationale; capture
   contact info ONLY if published by the business itself. Output: strict compact JSON
   (single object, short keys). If nothing found on the web -> mark `webPresence: "none"`
   (this feeds the negative-space filter) and score from registry data alone, flagged
   low-confidence.
5. **Dossier** (≈0 tokens): assembled by TEMPLATE from already-computed parts: registry
   facts (age, status, agent, address), triggers, UCC section, web verdict + rationale,
   fit score, and a suggested outreach angle. The outreach draft itself is ONE optional
   per-lead call the user clicks ("Draft opener"), never automatic, and it references the
   trigger ("Congrats on registering Vivid Gems this month…").

**Learning loop:** thumbs on any qualified lead -> `feedback.ts` distills (small batched
call, or pure heuristic when possible) approved/rejected traits into the profile's feedback
arrays; classify/qualify prompts include a compact "user has approved/rejected:" line.
Cap feedback arrays at ~10 items each (rolling).

**Caching:** every classify batch and qualify result is cached (cache key: sha of
entityId + profileId + profileVersion + stage). Cache lives in memory during a session and
persists via window.storage (respect its 5MB/key limit — shard by search id). Re-running a
search re-uses everything unchanged. This is the single biggest real-world token saver.

## 6. TOKEN & LATENCY DISCIPLINE (applies to every prompt you write)

TokenBudgeter wraps the LlmBackend: estimates input tokens (chars/4 heuristic), enforces a
per-run budget (default configurable, e.g. classify ≤ 15k in / qualify ≤ 8k in per lead),
records ACTUAL usage from API responses, and surfaces running totals to the TokenMeter UI.
Hard-stop with a friendly "budget reached — raise it or narrow the search" state.

Prompt rules (enforce on yourself; document measured sizes in packages/qualify/src/prompts/README.md):
- System prompts ≤ 120 words, shared verbatim across calls of the same stage (identical
  prefixes are cache- and consistency-friendly).
- Data goes in as TSV/pipe-delimited lines, never pretty JSON. IDs are short ints local to
  the batch, mapped back in code.
- Outputs are coded (Y/N/U, short keys) with "no explanation" instructions; rationales are
  requested ONLY where a human reads them (qualify), with word caps.
- Web content: prefer the web_search tool's snippets over fetching pages. If a page must be
  fetched (backend contexts only), strip tags -> text, keep first 3,000 chars prioritizing
  about/products/wholesale pages, drop nav/footer boilerplate.
- Never request or rely on chain-of-thought in outputs.
- Latency: all independent calls run concurrently under a limiter (classify batches: 2–3
  in flight; qualify: 3). UI renders progressively — results appear as they resolve, sorted
  live. No stage blocks the UI thread; long loops yield.

## 7. ARTIFACT APP SPEC (apps/artifact)

Screens/flow (function over beauty for now — a design pass comes later, so keep components
cleanly separated and styling centralized in a tiny theme module):
1. **Setup**: pick profile (or create/edit in plain English), pick location (zip list |
   city/county | address+radius slider), date filters (e.g., "formed in last 90 days"
  toggle), run button with estimated scale warning if the area is huge.
2. **Funnel progress**: live counts per stage + TokenMeter.
3. **Results**: streaming table (score, name, city, triggers as chips, web-presence badge);
   filters incl. NEGATIVE-SPACE toggle ("no web presence only") and trigger filters;
   select-for-qualify; thumbs feedback; CSV export.
4. **Dossier drawer**: the one-page brief + "Draft opener" button.
5. **Insights tabs**: Vitality (births/deaths chart per category/zip) and Gaps (density
   table); both computed from free aggregates, no LLM.
6. **Digest**: "Generate digest" button -> markdown summary of new-since-last-run matches
   for saved searches (persisted watermark in storage). NOTE in UI copy + LEARNING.md:
   true scheduled email digests require a hosted backend — that is the Phase-2 product;
   the CLI must already be able to produce the same digest so the future backend is trivial.
7. **Storage**: profiles, saved searches, caches, feedback — personal storage (shared:false)
   only. Wrap all storage ops in try/catch; storage fails silently to in-memory.

## 8. SECURITY.md — REQUIRED THREAT MODEL (write in Phase 0, update every phase)

Cover at minimum, in plain English with mitigations mapped to code locations:
1. **Prompt injection via retrieved web content** (primary threat): a business's website
   can contain adversarial instructions. Mitigations: web content/snippets are wrapped in
   explicit data delimiters with a standing instruction that content is untrusted data;
   qualify outputs are parsed against a strict schema (unknown keys dropped, score clamped
   0–100); model outputs can NEVER trigger tool calls, storage writes beyond their own
   result slot, or fetches; contact info is rendered as text, never as executed links
   without user click; rationale strings are length-capped.
2. **XSS**: all registry/web-derived strings rendered via React text nodes only —
   never dangerouslySetInnerHTML.
3. **CSV injection**: exported cells starting with = + - @ are prefixed with '.
4. **Rate-limit abuse / IP bans**: backoff + limiter in http.ts; document Socrata and
   Nominatim etiquette; app token optional.
5. **Privacy posture**: all data is public record; the tool must not attempt to discover
   non-published personal contact info; state this in README too.
6. **Data integrity honesty**: registry addresses may be agents/home addresses; officer
   data staleness; UCC name-matching is fuzzy. Surface confidence in the UI, don't hide it.

## 9. TEACHING REQUIREMENTS (the human is learning system design from this build)

- **ADRs**: for every non-obvious choice (monorepo layout, streaming vs batch, cache
  design, TSV formats, concurrency limits, esbuild bundling, schema-constants pattern…)
  write `docs/decisions/NNNN-title.md`: Context / Options considered / Decision /
  Consequences — ≤ 300 words each, plain English, no jargon without a one-line definition.
- **LEARNING.md**: at the end of EVERY phase append a "What got built and why" section:
  the latency techniques used and what each saves, the token techniques and measured
  numbers, the security decisions and the attack each prevents. Write it for a smart
  non-engineer. This file is the human's takeaway for future projects — treat it as a
  first-class deliverable, not a chore.
- When the human asks "why" about anything, answer from the ADRs and extend them if the
  answer wasn't recorded.

## 10. PHASE PLAN (do them in order; each ends with tests green, docs updated, and a
LEARNING.md entry; commit per phase)

**Phase 0 — Verify & scaffold (no product code).** Create the repo structure; live-verify
every Colorado dataset (metadata + 5 rows each), record real IDs/schemas/quirks in
docs/data/ and docs/states/colorado.md; verify Census geocoder CORS from browser context;
record 3–4 Socrata response fixtures for tests; write SECURITY.md v1 and ADRs 0001–000N
for the foundational choices. Acceptance: `npm test` runs a trivial fixture test; docs exist.

**Phase 1 — registry-core.** Colorado adapter (entities, trade names, transactions, UCC),
location resolution, signals (triggers, vitality, gaps), http/cache utils. Acceptance:
CLI can stream normalized entities for a zip list AND a radius, print triggers for a
90-day window, and print a vitality table — against fixtures in tests and live by hand.

**Phase 2 — qualify.** LlmBackend x3, TokenBudgeter, profiles + starters + feedback,
full funnel with caching and progress events. Acceptance: CLI runs the whole funnel with
ollama or an openai-compatible backend against fixtures (mock LLM in tests asserting
prompt sizes stay under documented budgets — yes, test the budgets); prompts README has
measured token counts.

**Phase 3 — artifact.** App.jsx + components, storage, streaming results, dossiers,
feedback, CSV, negative-space filter, bundling script with banned-import checks.
Acceptance: `scripts/bundle-artifact.mjs` emits one .jsx that the human can paste into
claude.ai and run a real Colorado search end-to-end.

**Phase 4 — registry-exclusive analytics + digest + hardening.** UCC dossier section,
Vitality and Gap tabs, digest generation (artifact button + CLI parity), a full
SECURITY.md review pass with an adversarial-content test (a fixture "website" containing
injection attempts must not alter scores/outputs structure), final LEARNING.md recap.
Acceptance: injection fixture test green; all features from §1 demonstrably present.

## 11. WORKING STYLE

TypeScript strict; vitest; no heavyweight deps (no axios/lodash — fetch and hand-rolled
utils); every external fetch behind http.ts; small files over clever files; errors surface
to the UI as friendly states, never silent catch-and-continue except storage. If a live
government endpoint contradicts this spec, trust the endpoint, update docs/data/, and note
it in an ADR. Begin with Phase 0 now, and open with a one-paragraph restatement of the
mission in your own words so the human can confirm alignment.

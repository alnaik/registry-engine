# v6 — field sheet

Working branch: `v6-field-sheet` (off `main`, not pushed). Rationale and
design decisions: ADR 0017. Visual reference: the approved field-sheet
mockup (one column of ruled rows on paper; the only card is an expanded
lead). Implemented directly by the orchestrator (no coder hand-offs this
round), one commit per phase, each after `npm test` + `npm run typecheck`.

## Phases

### Phase 0 — tokens and component sheet ✅
- `app.css` `:root` rewritten: paper/ink, teal for actions and links only,
  three trust tokens (ok / unk / no), type scale 13/15/17/22/30 at 450/650,
  4px spacing scale, dark mode via `prefers-color-scheme`, plus
  `[data-theme]` re-scoping so one page can show both themes. Legacy token
  names were aliased so the old search page kept working until Phase B.
- `GET /design` (`design.html` + `design.js`): every component with
  fictional data; `design.js` clones the light column into a dark one
  (DOM cloning, no HTML strings). Same Host check and CSP as `/` (the CSP
  now goes on every HTML entry of the whitelist).
- New `tests/web/public-assets.test.ts`: no `innerHTML`-style sinks in any
  shipped script; HTML pages load same-origin scripts only, with no inline
  script or style.

### Phase A — honest labels ✅
- **Tri-state standing.** `Lead.registryCheck` = `matched` |
  `checked_not_found` | `not_checked`, set by the engine.
  `planBackfill` replicates the driver's dedupe key (`backfillKey`) and cap
  (`maxBackfillNames`, now on the `Driver` interface) over the top
  `BACKFILL_ENTITIES` candidates, so the engine knows exactly which names
  were sent. `SearchOutcome.registryLookup` = `{ status: ran|failed|none,
  namesChecked, nameCap, candidates }`. A failed lookup makes every
  unmatched lead `not_checked`. The probe's evidence note now says "not
  checked against …" for those instead of "not found in …". Brief packing
  and the template brief use the same tri-state. CLI `alive` line uses the
  web wording.
- **Capped fetches.** `Driver.defaultLimit` (socrata 500, echo 500, shard
  ∞); the `fetched` event carries `capped`; UI and CLI show "500+ (capped)".
- **Name-only matches and individuals' records** leave the main list: the
  result line now has `leads`/`more` (coded businesses), `individuals`
  (coded individuals' records, `mapsUrl` and `searchUrl` null from the
  server) and `nameOnly`. `sheet` counts (`sheetCounts`) only count coded
  leads.
- **Openers** rewritten (template + LLM prompt): the user's own words,
  never a NAICS title or a person's name (`requestPhrase`).
- **Plain "what"**: `naicsPhrase` turns a title into a sentence fragment;
  `LeadView.what`.
- **Labels** live in `apps/web/public/labels.js` (pure, no DOM);
  `tests/web/labels.test.ts` pins every pill/tag string to its LeadView
  predicate and fails on an unpinned label or a label hard-coded in app.js.
- Deviations from the brief:
  - A fourth case inside "checked, not found": when the registry has a
    same-named record at an incompatible locality (the ACME TENT & CANVAS
    gap), the pill reads "Not on state registry at this address" with the
    tag "A business with this name is registered elsewhere. Confirm it's the
    same one." Saying "Not on state registry" there would be false.
  - The grey tag has two more variants for when the lookup failed or didn't
    run, so "Beyond the N names" is only shown when N names really were
    checked. A top-150 candidate whose name is too short to look up (<4
    letters) also lands under "Beyond the N names"; recorded in ADR 0017.
  - `LeadView.onStateRegistry` and `LeadView.point` were removed (replaced
    by `registryCheck`; the distance map goes in Phase B). The server test
    for map points was replaced by one for the three-way split.

### Phase B — three surfaces on one page ✅
- `index.html`, `app.js` and `app.css` rewritten to the field sheet: masthead
  with Find / My calls tabs (ARIA tabs, arrow keys), ask bar (request +
  Near + primary button + "More options"), reading line with "(guessed) ·
  find buyers instead", ruled bands with eyebrow headings and "N more in
  this band · Show them", dense rows that expand inline (one open at a
  time, Escape closes), segmented filters All / Confirmed / Not yet called /
  No web presence with counts.
- Direction: auto is implicit; the explicit override lives in More options.
  The code finder shows itself inline when Skip AI + Buyers, or when the
  map found no codes (`updateCodeBox`).
- My calls: a table over every tracker entry (business, from search,
  outcome, note, updated), CSV export kept. Outcomes are Not called /
  Reached / No answer / Not a fit; old entries migrate on read
  (`migrateTracker`: called→Reached, interested→Reached + "Interested. ",
  notfit→Not a fit, new→Not called). New entries store `search: {query,
  near}`; migrated ones show "an earlier search".
- Distance map removed: code, CSS, `docs/media/distance-map.svg`, the README
  reference.
- Legacy token aliases and the old card CSS are gone.
- Deviations:
  - Call outcomes in My calls are plain bold text, not trust-colored pills
    as in the mockup: the design rule reserves color for trust state, and an
    outcome is not a trust state.
  - The row's call status ("Reached 10/24") is ink, not teal: teal is for
    actions and links only.
  - Rows render all coded leads (top N + up to 300 more) and collapse the
    rest of each band; a band with none of the top N previews its first 5.

### Phase C — summary, About this search, print, captures ✅
- **Summary sentence** (`summaryParts` in `labels.js`, pinned in
  `tests/web/labels.test.ts`): "<coded> businesses are coded for this work
  in <state>, <n> within <radius, or 25> miles of <origin>. <k> of them are
  individuals' records, listed at the end. <confirmed> are confirmed on the
  state registry. <phones> publish a phone number." Each clause drops out
  when it has nothing to say (no origin, no individuals); "None publish a
  phone number in these records, so the sheet gives addresses and named
  agents" when phones = 0.
- **About this search** (`aboutRows`): a collapsed table at the bottom, one
  row per source (count, "500+ (capped)", error), names checked against the
  registry ("46 of the top 46 … at most 80 per search", or why not),
  name-only matches, recent filings, web contact lookup status, AI calls /
  tokens / API-price cost, elapsed time.
- **Print**: ruled rows with a dotted blank "Notes" line per lead; tabs, ask
  bar, steps, tools, groups, About and the footer are hidden; band headings
  stay with their first row (`break-after: avoid`); a print head carries the
  query and summary. Type scales to 8–14 pt. Measured: 30 rows print on 4
  pages (about 8 per page), so 12 leads fit on two. The Phase 8 "gap on
  page 1" is gone in practice: a row is now about an inch tall, so
  `break-inside: avoid` can leave at most one row of white space.
- **Captures** regenerated with `scripts/docs/capture.mjs` (selectors for
  the new DOM; `SKIP_AI=1` dry run): `docs/media/search.png` (APNG, 33
  frames), `search-form.png`, `progress.png`, `summary.png`,
  `lead-card.png`, `recently-registered.png`. The individuals' group is
  removed and agent/principal names are replaced with "(name withheld in
  this screenshot)" before any capture. README "How a search works"
  rewritten around them.
- `/design` synced with the app DOM (`step-detail`, `h2.band-head` with
  `aria-labelledby`); `design.js` suffixes ARIA id references in the dark
  clone.
- Live AI runs: 1 (the README capture: 2 calls, 12.9k tokens, about $0.05).
- Observed, not changed: some sole proprietors filed under a plain personal
  name with a business entity type (e.g. "FIRST LAST") aren't caught by
  `isLikelyIndividual`, so they stay in the main list. Detection is out of
  scope for a UI phase.

### Phase D — accessibility, Phase 8 rerun, validation scaffold ✅
- **axe-core** (devDependency) via `npm run a11y` (`scripts/a11y/axe.ts`):
  the real server and pages with a fictional fixture search
  (`tests/web/fixtures/sheet-outcome.ts`, kept honest by
  `tests/web/sheet-fixture.test.ts`), so no network and no AI. It checks
  `/design`, `/` after a Skip AI search (row open, groups and About open)
  and My calls with one logged call, at 390 and 1280 px, light and dark.
  First run: 4 serious (`scrollable-region-focusable` on the calls table)
  plus 12 moderate. Fixed: the calls table wrapper is a focusable, labelled
  region. On `/design`: `h4` to `h3` in the expanded row, one `main`, and
  `aria-label`/ARIA id references suffixed in the dark clone. Final: **0
  serious/critical**, 4 moderate (`landmark-unique` on `/design` only: the
  dark column repeats the light column's band heading by design).
- **Keyboard pass** (scripted over CDP against the fixture app, 1280 px):
  - Tab order from load: Find tab, request, Near, Find businesses, More
    options, the three examples. Every stop shows the teal focus ring.
  - Tabs: Left/Right switch Find and My calls, moving focus and selection.
  - More options: Enter toggles (`aria-expanded`), then direction segments,
    radius, call-notes count and state are reachable.
  - Enter in the request submits. Focus stays in the request; a new
    polite status region announces "Search done. <summary>" (added in this
    phase; before, nothing announced the results).
  - After results: filters, Print sheet, CSV, Save search, then row heads.
    Enter or Space toggles a row (`aria-expanded`). Inside it: Copy, phone,
    Map, Search the web, the four outcome buttons, the note, Where this
    comes from.
  - Escape from the note or an outcome button closes the row and returns
    focus to its head.
  - Group and About summaries open with Enter or Space. In My calls:
    Download CSV, then the table region.
- **Call-outcome validation scaffold**: tracker entries store `trust:
  {pill, tone}` as shown when the outcome was set (`trustAtCall`, pinned in
  `tests/web/labels.test.ts`). The My calls CSV adds `trust_at_call` and
  `trust_tone_at_call`. ADR 0017 "Validation (pending)" describes the
  20-lead reached-rate-by-label log. No outcomes recorded.
- **Phase 8 checklist rerun** (2026-10-27, live app on :4318, headless
  Chromium):
  - PASS empty state at 1280 and 390, light and dark: scrollWidth equals
    the viewport.
  - PASS supplier search with AI (tote bags, Denver), from the README
    capture run: codes 314910 and 315210; canvas shops top the "within 10
    miles" band.
  - FAIL (recorded) buyer search with AI (hot sauce, 80302): the map call
    returned an answer the parser rejected ("the AI answer couldn't be
    used"). The UI handled it honestly: a notes line, the buyer caveat, the
    "finding buyers needs the AI step" empty state, and the code finder
    opened. A single diagnostic map call with the same prompt then parsed
    fine (445299, 722511, 445110, 424490, 722410; 722512 was dropped as not
    a 2017 code). So this looks transient (the bad output wasn't captured).
    The Phase 8 run of the same search passed. Not changed.
  - PASS Skip AI supplier ("produce supplier", Denver): static-table codes
    (fruit/vegetable wholesalers, farms, markets).
  - PASS Skip AI buyer: empty state plus the code finder with "Finding
    buyers without the AI step needs industry codes." With 311421 and
    445110 entered, 462 coded businesses came back.
  - PASS codes helper: "metal fabrication" returns 332312; "canvas bag"
    returns 314910.
  - PASS location three ways: ZIP 80302 and Boulder give distance bands;
    no location gives one "Coded for this work" band and the reading line
    says "whole state, no distance". "Atlantis" gives "couldn't find
    "Atlantis" in CO, so results aren't sorted by distance".
  - PASS bands in order (10 / 25 / 50 / 100 / 100+). Individuals' records,
    name matches and recent filings are separate groups after the bands.
    An individual's row has no map or search link.
  - PASS tracker: No answer plus a note survives a reload and a re-run; My
    calls lists it; the trust label at call is stored.
  - PASS CSV: all-results has `registry_check`; My calls exports
    `'=SUM(1)…` escaped, with the trust columns.
  - PASS print: 30 rows on 4 letter pages, so 12 leads fit on two; band
    headings kept; the Phase 8 page-1 gap no longer shows.
  - PASS errors: concurrent search gives 200 / 429 "a search is already
    running".
  - PASS guards (curl): foreign Host 403, POST without JSON 415, HEAD /
    200.
  - NOT RUN: contacts (no Exa or Parallel key, as before); network off
    during ECHO (covered by the fixture's `source_error` and the existing
    engine test); `claude` logged out (unchanged since Phase 8 F7).
  - PASS 390 dark results: no horizontal scroll; the expanded row stacks
    into one column.
- Live AI runs for all of v6: 3 of 3. (1) README capture, tote bags near
  Denver: 2 calls, 12.9k tokens. (2) The Phase 8 buyer search: the map
  call was unusable, so the brief was skipped. (3) One diagnostic map call
  for (2): 5.2k tokens.

### Left out, and why
- Live web contact lookup (Exa / Parallel): there's still no key; untested
  live, as in v5.
- Better individual detection (personal names filed with a business entity
  type): an engine change, not a UI one; recorded in ADR 0017.
- The transient unusable map answer: it couldn't be reproduced within the
  live-run budget. The fallback UI is honest, and the next step is logging
  the raw map answer when parsing fails (no code yet).
- Saved searches still re-run with the form's current AI and radius
  options (Phase 8 note, unchanged).
- Moderate axe finding on `/design` (`landmark-unique`, a side effect of
  the cloned dark column): design sheet only.

---

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
- ✅ **7a Supplier/buyer switch.** A two-way toggle in the web app ("Find
  suppliers" / "Find buyers") and `--direction=buy|sell` in the CLI.
  `SearchConfig.direction` overrides the map's guess; the map LLM prompt
  receives it as fixed, and the static path uses it in place of
  `SELL_PATTERN`. Default: auto (today's behavior), showing what was guessed.
- ✅ **7b Saved searches.** Save query + near + codes + direction in the
  browser (localStorage, next to the tracker). Re-running marks leads not
  seen last time as "New since <date>". Key "seen" on a stable lead key
  (normalized name + ZIP5), **not** `Entity.id`, which depends on which
  source merged first. PPP is a fixed snapshot, so new matches come only
  from live sources (SoS, ECHO, farm products); the UI must say so.
- ✅ **7c New-business watch.** A "Recently registered near you" section:
  state-registry entities formed in the last 90 days (CO `entityformdate`,
  CT `date_registration`, NY `initial_dos_filing_date`), within the radius,
  whose name matches the map's keywords. CO and NY filings carry no industry
  code, so these are name matches and must be labeled that way. CT's
  registry has a `naics_code` field holding a title as text, which may allow
  coded matching there. Most useful for buyer searches (a new restaurant
  needs suppliers). Manifest-driven: a `formedDate` field-map key.
- ✅ **7d Distance view.** An SVG plot (no map tiles, no new CSP origins, no
  library) with rings at 10/25/50/100 mi around the center and one dot per
  lead at its ZIP centroid; clicking a dot scrolls to its card. Hidden when
  there's no center.

### Phase 8 — web app test pass ✅
Exercise the real web app in a browser at 1280 px and 390 px after Phase 7,
following the checklist in `docs/handoffs/v5-handoff.md`. Fix what's
confirmed, and record the rest here.

Run 2026-10-27 in headless Chromium over CDP, at 1280 and 390 px, light and
dark. Three live AI searches were run.

Passed:
- Empty state with no horizontal scroll.
- AI supplier search (tote bags, Denver): canvas shops on top. The map
  returned only 314910 that run.
- AI buyer search (hot sauce, 80302): specialty food, grocers and
  restaurants, with the buyer caveat.
- Skip AI produce search: static-table codes.
- Skip AI buyer search: the "needs the AI step" empty state; the 7a toggle
  fixes it.
- Codes helper: 332312 and 314910.
- Location as ZIP, as a town, and with none.
- Bands, and the individual's-record note.
- Tracker note survives a reload and a re-run. It is keyed on the stable
  lead key, and old entries migrate.
- CSV exports: my-list escapes a leading `=`.
- Print to PDF.
- 429 on a concurrent search.
- ECHO down: a warning, and results still return.
- curl guards: 403, 415, and `HEAD` 200.
- 7a–7d at both widths and in dark mode.
- Map dots follow the filters, and clicking a dot scrolls to its card.

Fixed:
- **F1:** recent filings matched mid-word ("BagelBytes" for `bag`,
  "Deliveries" for `deli`). They now need a whole word (`nameHasWord`).
- **F2:** map caveats showed CLI syntax in the web app.
- **F3:** an unknown location ("Atlantis") silently searched the whole state.
  The web app and CLI now say so.
- **F4:** Socrata keyword queries returned a different capped subset on each
  run (verified live: 2,191 matches, two different 1,000-row samples). That
  made "New since" flag noise. `$order=:id` makes results reproducible and
  offset paging defined.
- **F6:** the summary's link button printed.
- **F7:** a logged-out `claude` failed silently. A warning now names the
  error, and the brief call is skipped.

Not fixed (recorded):
- Recent filings still list "Sewer & Drain" for `sew`, because the word is
  ambiguous. They are labeled as name matches.
- A saved search re-runs with the form's current options (AI on/off,
  radius); only query, location, codes and direction are saved.
- Contacts (Exa/Parallel) are still untested live: no key was available.
- When the first card doesn't fit, print page 1 leaves a gap
  (`break-inside: avoid` on cards).

### Phase 9 — README rewrite + token usage per search ✅
- README rewritten down to the essentials:
  - run instructions;
  - how a search works, illustrated with captures of the real app (an APNG of
    a live search, stills, and the app's own distance-map SVG);
  - every source, with links;
  - measured token usage.
- Media is regenerated with `scripts/docs/capture.mjs` + `scripts/docs/apng.py`.
  Individuals' records and agent names are kept out of the captures.
- `claude -p` now runs with `--tools ""`, `--strict-mcp-config` and
  `--no-session-persistence`. Measured on a one-word prompt, input dropped
  from about 15.7k tokens to 478, because the CLI no longer sends its tool
  definitions. Real searches now use about 13k tokens, roughly $0.06 at API
  prices.
- Token usage per search is reported: `SearchOutcome.llmUsage`, the web
  summary stat (hover for the per-call split), and a CLI line.

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

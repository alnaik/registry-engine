# v13 — PPP for Connecticut and New York

Working branch: `v13-ppp-ct-ny`. Owner decision 2026-10-30: ship the CT and
NY shards in the repo as-is; size and speed are a later, separate project
(see "Later" below). Done by the orchestrator directly (data job plus two
small fixes found while checking it).

## P1 — CT and NY shards ✅ (2026-10-30)
Built from the same 240930 SBA release as CO: CT 91,355 businesses (25 MB),
NY 552,343 (148 MB, largest sector file 54.json at 21 MB). `ppp`
`quirks.shardRegions` lists all three; route tests cover NY and CT.

## P2 — HTML entities in PPP text ✅ (2026-10-30)
~5,000 records (717 in CO) carried entities from the FOIA text ("D&AMP;R").
`build_ppp_shards.py` decodes them, case-insensitively and repeatedly,
before stripping email tokens. CO rebuilt: 163 records were the same
borrower's second loan under an encoded name and now dedupe (153,082 →
152,919).

## P3 — a bare town picks its state ✅ (2026-10-30)
With no state picked and no state in `near`, a place outside the default
region is searched in the one covered state that has it ("Manhattan" → NY);
in more than one ("Brooklyn": CT and NY) the server asks for the state (400).
A place in the default region is unchanged.

## Checked live
Dentists near Brooklyn, NY; plumbers near Hartford, CT; hot-sauce buyers near
New Haven, CT; auto repair near Buffalo, NY; accountants near Manhattan. One
Buffalo run lost the NY registry check to a data.ny.gov timeout (reported as
such); the retry matched 71. Shard read: 90 ms for NY 54.json, 264 ms for a
four-sector NY search (35k records). CSV of a 9,593-lead sheet: 9.3 MB.

## Later (owner's optimization project)
Repo size (every rebuild adds a full copy to history), shard parse per search
with no cache, splitting large sector files, and "Check all" over a big NY
category (thousands of registry requests).

# v12 — v1-readiness review fixes

Working branch: `v12-v1-review`. Source: the v1 review of `5a13550`
(2026-10-30), cross-checked against `main` @ 040c702. Review items 2 and the
wrong-state half of 4 were fixed by v11; 13 and 16 were wrong (the no-AI hint
exists; `capture.mjs` is tracked). Owner decisions 2026-10-30: phones (5),
CT/NY PPP data (6, with 29) and the PACA history rewrite (9, history part;
23) stay out of v12. Typed contacts (25) deferred: large refactor, the page
already extracts phones. One PR. Three coder batches, run in order (A, B, C);
each must leave `npm test` and `npm run typecheck` green.

## Batch A — ranking, cancel, speed, codes-only search

### A1 — mixed-industry searches interleave codes (review 1) ✅ (2026-10-30)
`rankEntities` in `packages/qualify/src/verbs/brief.ts` sorts tier, band,
then `fit` (code order), then score, so the first code fills each band.
Keep tier then band. Within one (tier, band) group, interleave by fit code:
order each code's leads by the existing tail (score, distance, employees,
name), then take one lead from code 0, one from code 1, … cycling, skipping
codes that have run out. Leads with no fitting code (fit = sentinel) go last
in the group in the existing order. A single-code search orders exactly as
today. Tests: 3 codes × several leads in one band come out round-robin; a
single-code search is unchanged; tier and band still dominate.

### A2 — a closed tab cancels the search (review 10) ✅ (2026-10-30)
- `apps/web/src/server.ts` `handleSearch`: create an `AbortController`;
  abort it when the response closes before the search finished
  (`res.on("close")` with `!res.writableEnded`). Pass `signal` in the search
  config. `busy` is released when the search promise settles (as now), so the
  engine must settle promptly after abort.
- `packages/qualify/src/engine.ts`: accept `signal?: AbortSignal` in the
  config; throw `signal.reason` (or an `AbortError`) at each stage boundary
  (after map, after fetch, after backfill, before contacts, before brief) and
  pass it down to drivers and the LLM call.
- `packages/registry-core/src/util/http.ts` `fetchWithRetry`: accept
  `signal`; combine with the per-attempt timeout (`AbortSignal.any`); an
  abort from the caller is never retried and sleeps between retries end
  early on abort.
- Drivers: thread the signal through their fetch calls (Socrata, ECHO,
  static shard http, DNS probe, contact lookup) via existing options objects.
- LLM: `claudeCodeBackend` kills the child process on abort; the Anthropic
  API backend passes the signal to its fetch. Adapter signature may take an
  optional `signal`.
- Server: an aborted search writes nothing further and does not save
  history.
- Tests (server.test.ts): a search whose stub waits on the signal; the
  client destroys its request; a second search right after gets 200, not 429
  (poll briefly for the slot). http.test.ts: an aborted signal stops retries
  (fetch called once) and rejects.

### A3 — Socrata responses are cached briefly (review 14) ✅ (2026-10-30)
In-memory cache in the Socrata driver (or `fetchWithRetry` behind an opt-in
flag used only by Socrata): key = full URL incl. app token presence, value =
parsed JSON body, TTL 15 minutes, at most 200 entries (drop oldest). Only
200 responses are cached. Test: two identical page requests within TTL make
one fetch; after TTL (fake timers) two.

### A4 — codes-only API search (review 12) ✅ (2026-10-30)
`parseSearchParams`: `query` may be empty or absent when `naics` has at
least one valid code; then the query becomes the code titles joined with
", " (via `naicsLabel`), clipped to 300. Otherwise the 3–300 rule stands.
Test: `{ naics: ["621210"], noLlm: true }` → 200 and the stub sees a query
containing "Dentists".

## Batch B — places, state from location, code finder, emails

### B1 — NYC boroughs and counties are places (review 3) ✅ (2026-10-30)
- `scripts/data/build_geo.py`: also read the Census 2024 Gazetteer counties
  file and add each county in a covered region to that region's
  `places.json` table under its lowercased name (e.g. `denver county`,
  `kings county`; CT's county-equivalents are planning regions, use their
  Gazetteer names). Do not overwrite an existing place key.
- Add hand aliases in the script for US-NY: `brooklyn` (40.6782,-73.9442),
  `queens` (40.7282,-73.7949), `bronx` and `the bronx` (40.8448,-73.8648),
  `manhattan` (40.7831,-73.9712), `staten island` (40.5795,-74.1502), `nyc`
  and `new york city` (same as `new york`). Rebuild `places.json` (download
  the Gazetteer file; keep the rebuild deterministic and document the source
  URL in the script header).
- Tests in geo.test.ts: `Brooklyn`, `Brooklyn, NY`, `Kings County`,
  `Denver County` resolve in their regions.

### B2 — the state comes from the location when the user didn't pick one (review 4) ✅ (2026-10-30)
- UI: the state select gets a first option `From your location` (value
  `""`), selected by default; when it's selected the request sends no
  `region`. A previously stored search's region still restores.
- Server `parseSearchParams`: when `region` is absent and `near` names a
  state (`locationState`) that is a known region (`US-<code>` in
  `knownRegions`), use it. If it names a state we don't cover → 400
  `"<near>" is in <State>, which isn't covered yet. Covered: <names>.`
  If it names no state, `defaultRegion` as now. An explicit `region` keeps
  v11's rule (resolves in region, else the 400).
- Tests: `near: "11201"`, no region → the stub sees region US-NY;
  `near: "Brooklyn, NY"` → US-NY; `near: "Austin, TX"` → 400 naming Texas;
  explicit US-CO + `06103` → 400 as before.

### B3 — code finder synonyms (review 8, 27) ✅ (2026-10-30)
- New `packages/registry-core/src/naics-synonyms.json`: phrase → codes,
  checked against `isNaicsCode` in a test. Entries: co-packer, copacker,
  co-packing → 311999, 311421, 311941, 561910; daycare, day care, childcare,
  child care → 624410; mechanic, auto mechanic, car repair → 811111, 811118;
  dental, dentist, dental office → 621210; property management, property
  manager → 531311, 531312; insurance agent → 524210; vet, veterinarian →
  541940; trucking, trucker → 484110, 484121, 484122; plumber → 238220;
  electrician → 238210; hvac → 238220; accountant, bookkeeper → 541211,
  541219; lawyer, attorney → 541110; landscaper, landscaping → 561730;
  janitorial, cleaning service → 561720; roofer → 238160; caterer → 722320;
  printer, print shop → 323111; bakery → 311811; restaurant → 722511.
- `lookupCodes`: if the joined lowercased words (hyphens and spaces
  normalized) equal or contain a synonym phrase, those codes come first in
  the listed order, then the existing word-match results with duplicates
  removed, within `max`. Wherever the no-AI path matches words to codes, it
  goes through `lookupCodes` or this table (check `map.ts`).
- `/api/codes`: empty or whitespace `q` → 400 `q is required`; `q` over 100
  chars → 400 (instead of silent clip).
- Tests: each review miss (`co-packer`, `daycare`, `mechanic`, `dental`
  → 621210 first, `property management` → 531311 first); 400s.

### B4 — no personal emails in tracked data (review 9, files part) ✅ (2026-10-30)
- `shards/paca/US-NY.json` (and CO/CT): a `website` value containing `@`
  becomes `""`. PPP shards: an `address` value that is an email (matches
  `^\S+@\S+\.\S+$`) becomes `""`; same rule added to
  `scripts/data/build_ppp_shards.py`. Preserve file formatting (PACA: indent
  1, ensure_ascii False, trailing newline; PPP: check the existing
  one-object-per-line format and keep it).
- `tests/fixtures/paca-us-co-shard.json`: drop `email_address` from every
  record; adjust tests that relied on it.
- New `tests/data/no-personal-emails.test.ts`: scans every file under
  `shards/` and `tests/fixtures/` for an address at gmail, yahoo, aol,
  hotmail, outlook, msn, icloud, comcast, verizon, optonline, att, sbcglobal
  and fails listing file:line.

Batch B review notes (2026-10-30): PPP email tokens are stripped from `name`
and `address` (name-only-email records dropped, 11; README count 153,082), also
the spaced form `name@Gmail Com`; the no-AI `STATIC_LEADS` table in map.ts is
unchanged (synonyms feed the Find codes box); a bare place in a covered region
wins over an uncovered-state suffix ("Port Washington"); the origin event and
result carry the region actually searched.

## Batch C — sheet honesty, docs and tooling

### C1 — capped sources in the summary (review 7) ✅ (2026-10-30)
When any source's fetch was capped, the summary block (where the headline
counts render in `apps/web/public/app.js`) adds one plain sentence: `<names>
stopped at <n> records, so this isn't every business. Narrow the area or the
codes for a fuller list.` Pin the wording in labels.js with a test, like the
other labels.

### C2 — nothing within radius says so (review 11) ✅ (2026-10-30)
When a location resolved and `withinRadius` is 0 but businesses were listed,
the summary says `None within <r> mi; the nearest is <d> mi away.` instead
of a bare 0. Label in labels.js, tested.

### C3 — listed vs total (review 24) ✅ (2026-10-30)
When `listed` < `businesses`, the list footer says `Showing <listed> of
<businesses>. The CSV has all of them.` (verify the CSV export really
contains every ranked lead; if not, raise a DEVIATION REQUEST).

### C4 — data date per source (review 20) ✅ (2026-10-30)
"About this search" sources list: each source shows how current it is —
static shards: `recorded <Month YYYY>` from the shard's `generated`
(PPP: `2020–21 loans`); live sources: `live`. Server adds the field to the
result's `sources`; UI renders it; test the server field.

### C5 — `displayName` in the API (review 26) ✅ (2026-10-30)
LeadView gains `displayName` (display case for business names, the filed
name for individuals: the same rule app.js uses); app.js uses it. README API
section lists it.

### C6 — history: docs and a clear button (review 18) ✅ (2026-10-30)
- README line ~97: saved searches are kept by the local server under
  `~/.cache/registry-engine/searches` (newest 20); My calls lives in the
  browser.
- `DELETE /api/history` (requires `Content-Type: application/json`, like
  search, so cross-site pages can't trigger it) removes the stored searches;
  204. UI: a "Clear history" button in the history panel with a confirm.
  SECURITY.md Threat 8 item 6 updated ("there is no delete endpoint" →
  the clear endpoint and its guard); changelog.
- Tests: DELETE without JSON content type → 415; with → 204 and the list is
  empty.

### C7 — Node version pinned (review 15) ✅ (2026-10-30)
`package.json` `"engines": { "node": ">=20.19" }`; `.nvmrc` with `24`.
README: "Tested on Node 24; runs on 20.19+. The proxy note needs 24."

### C8 — a11y script finds Chromium (review 17) ✅ (2026-10-30)
`scripts/a11y/axe.ts`: when `CHROME` is unset, look under the Playwright
cache (`~/Library/Caches/ms-playwright` on macOS, `~/.cache/ms-playwright`
on Linux, `%LOCALAPPDATA%\ms-playwright` on Windows) for the newest
`chromium_headless_shell-*` executable; if none, exit 1 with
`Set CHROME to a Chromium or Chrome executable, or run npx playwright install chromium-headless-shell.`

### C9 — UI smoke run (review 19) ✅ (2026-10-30)
`scripts/smoke/ui.ts` + `npm run smoke`: same harness as the a11y script
(real server on the fixture search, no network, no AI). Drives: empty page
renders; a search streams and shows result rows; the CSV link returns
`text/csv`; a forced server error shows the error box; the history list
shows the search. Exit non-zero with the failing step. Document in README
Development and CLAUDE.md Commands.

### C10 — CONTRIBUTING.md (review 21) ✅ (2026-10-30)
Short: setup, the commands from CLAUDE.md, how to add a state (manifest
entry, zero-code test), data rebuild scripts, the PLAN.md/spec workflow,
SECURITY.md for anything building queries/paths, and no personal data in
shards or fixtures (the B4 test).

Batch C review notes (2026-10-30): the summary's "The sheet lists the top N;
the CSV has all of them." was removed (C3's list footer says it); `nearestMi`
added to SheetCounts for C2. Review 28: a live search at 390px ("dentists and
veterinarians" near "Brooklyn, NY") rendered with no horizontal scroll and
resolved to New York from the location.

## Done when
All three batches merged into the branch, `npm test`, `npm run typecheck`,
`npm run a11y` and `npm run smoke` pass.

---

# v11 — tester follow-ups: location input, out-of-state ZIP, retries, proxy note

Working branch: `v11-location-retry`. Owner decisions 2026-10-29: from an
outside tester's run. Fix location parsing, reject an out-of-state ZIP or
town before the search runs, stop retrying unreachable sources four times,
and document the proxy setting (no proxy code). One PR.

## N1 — ZIP-to-state table (data, national) ✅ (2026-10-29; 413 tests green)

- New `packages/registry-core/src/geo/zip-states.json`: every state keyed by
  postal code → `{ "name": "<full name>", "zip3": [[lo, hi], ...] }` (3-digit
  ZIP prefixes, inclusive). Use exactly these ranges:
  AL Alabama 350-369 · AK Alaska 995-999 · AZ Arizona 850-865 · AR Arkansas 716-729 ·
  CA California 900-961 · CO Colorado 800-816 · CT Connecticut 060-069 ·
  DE Delaware 197-199 · DC District of Columbia 200-205, 569 · FL Florida 320-349 ·
  GA Georgia 300-319, 398-399 · HI Hawaii 967-968 · ID Idaho 832-838 ·
  IL Illinois 600-629 · IN Indiana 460-479 · IA Iowa 500-528 · KS Kansas 660-679 ·
  KY Kentucky 400-427 · LA Louisiana 700-714 · ME Maine 039-049 ·
  MD Maryland 206-219 · MA Massachusetts 010-027, 055 · MI Michigan 480-499 ·
  MN Minnesota 550-567 · MS Mississippi 386-397 · MO Missouri 630-658 ·
  MT Montana 590-599 · NE Nebraska 680-693 · NV Nevada 889-898 ·
  NH New Hampshire 030-038 · NJ New Jersey 070-089 · NM New Mexico 870-884 ·
  NY New York 005, 100-149 · NC North Carolina 270-289 · ND North Dakota 580-588 ·
  OH Ohio 430-459 · OK Oklahoma 730-749 · OR Oregon 970-979 ·
  PA Pennsylvania 150-196 · RI Rhode Island 028-029 · SC South Carolina 290-299 ·
  SD South Dakota 570-577 · TN Tennessee 370-385 · TX Texas 750-799, 885 ·
  UT Utah 840-847 · VT Vermont 050-059 · VA Virginia 201, 220-246 ·
  WA Washington 980-994 · WV West Virginia 247-268 · WI Wisconsin 530-549 ·
  WY Wyoming 820-831 · PR Puerto Rico 006-009.
  (Known edge: 06390 Fishers Island NY reads as CT. Accepted.)
- In `geo.ts`: `export function zipState(zip: string): string | undefined`
  (postal code from the first 3 digits; undefined if not 5 digits or no
  range) and `export function stateName(code: string): string | undefined`.
  Export both from `packages/registry-core/src/index.ts`.
- National on purpose: adding a state needs no change here.

## N2 — `resolveLocation` accepts common forms and refuses other states ✅ (2026-10-29; 413 tests green)

In `packages/registry-core/src/geo.ts`, `resolveLocation(region, input)`:
- ZIP+4: `^\d{5}-\d{4}$` resolves as its first 5 digits; label `ZIP <5 digits>`.
- A ZIP whose `zipState` is known and isn't the region's state → `undefined`.
- Trailing state on a town: strip `,? <code>` or `,? <full name>` at the end
  (case-insensitive, whitespace-tolerant) when it names the region's state,
  then resolve the rest as a place. `Denver, CO`, `denver co`,
  `Denver, Colorado`, `Castle Rock CO` all resolve in US-CO. A trailing
  *other* state (`Hartford, CT` in US-CO) → `undefined`. A place whose own
  name ends in a word that happens to be a state code must still resolve when
  typed bare (try the whole text as a place first; strip only if that misses).
- Also export `function locationState(input: string): string | undefined`:
  the state the input names explicitly (a ZIP's `zipState`, or a trailing
  state code/name), else undefined. Used by N3.
- Tests in `tests/registry-core/geo.test.ts`: each form above; `80202-1234`;
  `06103` and `Hartford, CT` in US-CO → undefined; `06103` in US-CT resolves;
  existing cases unchanged.

## N3 — the server rejects a `near` in another state before searching ✅ (2026-10-29; 413 tests green)

Amended in review: the 400 fires only when `near` also fails to resolve in the region, so a real town ending in a state word (`North Washington`, CO) passes.

In `apps/web/src/server.ts` `parseSearchParams`, after `region` is known: if
`near` is set and `locationState(near)` is a state other than the region's,
throw `BadRequest` (400) with
`"<near>" is in <State name>, and this search covers <region name>. Pick <State name> as the state if it's covered, or use a <region name> ZIP or town.`
(Names from `stateName` / the existing `REGION_NAMES`.) The page already
shows a 400's `error` text, so no app.js change. Test in
`tests/web/server.test.ts`: `near: "06103"` with region US-CO → 400 with
"Connecticut" in the message; `near: "80202-1234"` → 200.

## N4 — unreachable sources are retried once, not four times ✅ (2026-10-29; 413 tests green)

In `packages/registry-core/src/util/http.ts` `fetchWithRetry`: when `fetch`
throws (connection refused, DNS failure, per-attempt timeout), retry at most
once in total for the call, then throw. 429/5xx keep the current
`maxRetries` and backoff. Tests in `tests/registry-core/http.test.ts`
(fake timers, as the file already does): a fetch that always throws is called
exactly 2 times; a fetch that throws once then succeeds returns the response;
always-503 behavior unchanged.

## N5 — docs ✅ (2026-10-29; 413 tests green)

- `README.md`, right after "Tested on Node 24.": one sentence — behind a
  proxy, set `HTTPS_PROXY` and `NODE_USE_ENV_PROXY=1` before `npm start`
  (Node 24 reads them; there is no proxy setting in the app).
- `README.md`: wherever it describes what `near` accepts, say ZIP, ZIP+4 or
  a town (optionally with the state), in the chosen state.
- `SECURITY.md` Threat 4 item 2: network failures (no response) are retried
  once; 429/5xx keep the backoff. Changelog v3.13 (2026-10-29, v11). Bump
  header version/date.

## Done when

`npm test` and `npm run typecheck` pass; no other files change.

---

# v10 — security audit follow-ups: PACA emails, error text, oversized bodies, raw AI log, reporting

Working branch: `paca-drop-emails`. Owner decisions 2026-10-29: git history
was rewritten after all (email → GitHub noreply, `docs/handoffs/` and
`server.log` dropped, other branches deleted; supersedes v9's "no history
rewrite"). PACA shards keep phone and website and drop `email_address`.
No API token on the local server (accepted risk, M4). Everything ships in
one PR.

## M0 — PACA shards drop `email_address` ✅ (2026-10-29, commit 3cc909b; shards, manifest `contact_fields`, static-shard + e2e tests, docs/data/paca.md, README)

## M1 — error text that reaches the page or history has local paths removed ✅ (2026-10-29; 402 tests green)

The page and the stored history get error text from three places in
`apps/web/src/server.ts`: the final `{ type: "error", message }` line in
`handleSearch`'s catch, `translateEvent`'s `source_error` message, and
`translateEvent`'s map `llmError`. Driver/Node errors can carry absolute
paths (`ENOENT: open '/Users/<name>/…'`).

- Add `function forPage(text: string): string` in `server.ts` (module
  level, near `sendJson`): replace every occurrence of `os.homedir()` with
  `~` (skip if homedir is empty or `/`), then replace
  `/\/(?:Users|home)\/[^/\s'"]+/g` with `~` and
  `/[A-Za-z]:\\Users\\[^\\\s'"]+/g` with `~`, then clip to 300 chars.
- Apply it at the three sinks above and nowhere else.
- In `handleSearch`'s catch, also `console.error(err)` (full error, server
  side only) before writing the line.
- Tests in `tests/web/server.test.ts`:
  - search throws `new Error("ENOENT: open '/Users/someone/proj/shards/x.json'")`
    → final line message contains `~/proj/shards/x.json` and not `/Users/someone`.
  - a `source_error` event and a map event with `llmError` carrying
    `/home/someone/x` both stream with `~/x`.
  - existing "registry exploded" test still passes unchanged.

## M2 — oversized request bodies cut the connection ✅ (2026-10-29; 402 tests green)

`readJson` reads and discards the whole body past 10 KB before answering
413, and the connection stays open.

- If the declared `Content-Length` exceeds `MAX_BODY_BYTES`, reject at once
  without reading. If streamed bytes exceed it, stop collecting and reject
  at once (don't wait for `end`).
- The 413 response carries `Connection: close`, and after it finishes the
  request socket is destroyed (`res.on("finish", () => req.destroy())` or
  equivalent). Other 4xx responses are unchanged.
- Tests: the existing 413 test still passes and also asserts
  `headers.connection === "close"`; a new test sends
  `Content-Length: 1000000` with a tiny body written but the request left
  open (don't call `end`) and gets 413 back.

## M3 — the rejected raw AI answer is logged only on request ✅ (2026-10-29; 402 tests green)

`handleSearch` writes `outcome.mapRawAnswer` to stderr on every rejected
map answer.

- Default: one line, `[map] the AI answer couldn't be used (<n> chars). Set REGISTRY_ENGINE_DEBUG=1 to log it.`
- When `process.env.REGISTRY_ENGINE_DEBUG === "1"`: the existing raw-answer
  log, unchanged.
- `.env.example`: add a commented block, `# Log the AI's raw answer when it
  can't be used (for diagnosis; it may echo your request).` and
  `export REGISTRY_ENGINE_DEBUG=`.
- Tests: update "logs a rejected map answer to stderr only…" to set the env
  var with `vi.stubEnv("REGISTRY_ENGINE_DEBUG", "1")` (restore after); add
  one without it asserting stderr does NOT contain the raw marker and does
  contain `couldn't be used`. Stream assertions unchanged.

## M4 — SECURITY.md ✅ (2026-10-29; 402 tests green)

- New section right after the intro paragraph, before Threat 1:
  `## Reporting a vulnerability` — report privately through GitHub's
  private vulnerability reporting (the repo's Security tab → "Report a
  vulnerability"); please don't open a public issue. No email address.
- Threat 1 item 6: say the raw answer is written to stderr only when
  `REGISTRY_ENGINE_DEBUG=1`; otherwise only its length.
- Threat 5: add a bullet — the committed PACA shards keep the filed phone
  and website and drop the filed email (about 665 were personal mailboxes;
  a bulk file in a public repo is a harvest target).
- Threat 8 item 3: oversized bodies get 413 with `Connection: close` and
  the socket is closed. Item 7: error text sent to the page or history has
  home-directory paths replaced with `~` (`forPage`).
- Threat 8 new item 8, **No API token (accepted risk).** The server takes
  no token, so any local process can start searches that spend the user's
  AI and web-search credits. Not mitigated: such a process can already
  read the user's environment/.env keys or run `claude` as the user, so a
  token would add no protection while breaking the documented curl usage.
  Other websites remain blocked by items 1–2.
- Header: Version 3.12, Last updated 2026-10-29. Changelog v3.12
  (2026-10-29, v10): reporting section; PACA emails not committed;
  `forPage`; 413 closes the connection; raw AI answer behind
  `REGISTRY_ENGINE_DEBUG`; no-token accepted risk.

## Done when

`npm test` and `npm run typecheck` pass; no other files change.

---

# v9 — public release: drop the CLI, document the API, code-finder fix, UI clarity pass, hygiene

Working branch: `v8-byok` (continues after the v8 commit 8db2cf3). Owner
decisions 2026-10-28: one phase, no sub-phases. Email in git history stays
(owner's call; no history rewrite). No sample result row on the empty page.
`.claude/agents/` stays. Everything below ships in one PR with v8.

## J1 — remove the CLI; the HTTP endpoints and the library are the API ✅ (2026-10-28; apps/cli deleted, lockfile refreshed; README "HTTP API and library"; CLAUDE.md, SECURITY v3.11 and K5 comments reworded)

- Delete `apps/cli/` entirely. Remove `"apps/cli/src/**/*.ts"` from
  `tsconfig.json` include. Run `npm install` so `package-lock.json` drops
  the workspace. No tests reference it (checked).
- `README.md`: replace the "## CLI" section with "## HTTP API and library":
  - The local server is the API. One curl example against
    `POST /api/search` with `Content-Type: application/json` and
    `Host: localhost:4317` (the Host check is deliberate: the API is
    local-only), body `{"query": "...", "near": "..."}`; the response is
    newline-delimited JSON, one event per line, ending with a `result`
    line. List the event types in one line each: `map`, `routed`, `origin`,
    `fetched`, `source_error`, `backfill_progress`, `recent`, `error`,
    `result`. Point at `apps/web/src/server.ts` (`parseSearchParams`) for
    the accepted fields, and list the other routes in one line each:
    `GET /api/status`, `GET /api/codes?q=`, `GET /api/history`,
    `GET /api/history/:id`, `GET /api/csv?id=`.
  - The library: `import { search } from "@registry-engine/qualify"` with a
    five-line example (query, region, no LLM, print names). Note the ≤2
    LLM calls budget and that `llm` is optional.
  - Token table: drop the two CLI rows; keep the web row; drop "and the CLI
    prints them after the results"; "measured through claude -p" stays.
- `CLAUDE.md`: Commands section drops the CLI block and the "CLI flags"
  paragraph; the `--check-all` mention moves to one sentence under the web
  app ("the web app's Check all button sets `backfillAll`"); the
  strip-types note becomes "`node --experimental-strip-types` does not work
  on this repo (NodeNext `.js` imports); use vite-node"; package layout
  drops `apps/cli`; "Delivery surface" is the web app only (plus the HTTP
  API and the library). Keep the ADR references.
- `SECURITY.md`: every "CLI" mention (lines ~42, 74, 85, 108, 132, 167,
  238) is reworded to the web app / API or removed where it only described
  the CLI (Threat 3: the CSV export is the web app's `/api/csv`). Changelog
  v3.11: "CLI removed; HTTP API documented."
- `PLAN.md` older sections may keep CLI wording (history).

## J2 — code finder: "canvas bag" must not return bakeries or bagasse ✅ (2026-10-28; K6 rule incl. `ies` and the `y` rule, no existing test broke; K7 assertions added)

`packages/registry-core/src/naics.ts`, `lookupCodes` + `stem`:
- Today a stem matches at a word start with the right side open, so `bag`
  matches `bagels` and `bagasse`. New rule: the stem must be followed by
  the end of the word or by one of the stemmer's own suffixes
  (`s|es|ed|er|ers|ing|ation|ication`), then a non-alphanumeric or end.
  Build the regex once per stem as today.
- Tests (`tests/registry-core/naics.test.ts` or wherever `lookupCodes` is
  tested): `canvas bag` returns 314910 (textile bag and canvas mills) in
  the top results and no code whose title contains "baker" or "pulp";
  `bakery` still returns bakeries (stem `baker` → `bakeries` matches via
  `ies`? No: `bakery` stems to `bakery` (no suffix rule hits, length rule);
  the coder must verify `bakery`, `bakeries`, `welding`, `welders` all
  still hit their codes and add those four as assertions, adjusting the
  suffix list only if one of them fails).

## J3 — UI clarity pass (`apps/web/public/*`, `design.html` samples updated) ✅ (2026-10-28; `.label`, displayName/displayCity pinned, placeholder weight, examples, buttons, favicon/wordmark, renderEmpty tips; a11y 0 serious)

1. **Spaced small caps only for distance headings.** `.eyebrow` keeps its
   style but is used only by `.band-head` headings ("Within 10 miles", …).
   Every other `eyebrow` (form labels, "We read this as", "Before you
   call", "About this search", group headings, the My calls headings)
   becomes a plain label class `.label` (same size `--t1`, weight `--wb`,
   no letter-spacing, no uppercase, color `--ink-2`). The test
   `tests/web/public-assets.test.ts:32` is updated to the new class.
2. **Display case for names and cities.** `labels.js` gets
   `displayName(name)` and `displayCity(city)`, pure, pinned by tests:
   - If the string has any lowercase letter, return it unchanged (as filed).
   - Otherwise title-case each word, except: words of ≤3 letters stay upper
     when they are in a small allow-list (`LLC`, `INC`, `CO`, `LP`, `LLP`,
     `PC`, `DBA`, `USA`, and two-letter state codes), words with a digit
     stay as filed, `HVAC` stays upper, and the particles `of`, `and`,
     `the`, `&` are lower unless first. Apostrophe-S stays lower (`JOE'S` → `Joe's`).
   - Applied at render only: lead rows, the open row, My calls rows,
     openers that quote the name, the trust/registry lines that show the
     filed name. CSV, history files, aria-labels and `textContent` of
     copy-to-clipboard stay as filed (the owner says the name as filed on
     the phone; the sheet also keeps a "filed as" line in the open row when
     display differs from filed).
3. **Placeholder looks like a placeholder.** `.ask-input::placeholder`
   color `--rule-2`, weight `--w`, and the query placeholder text becomes
   `What you need, or what you sell` (the label text above it goes; the
   label stays visually hidden for screen readers via an existing
   `.sr-only` class or a new one).
4. **Examples** replaced with three that show the range, still `.example`
   buttons but styled as small outline buttons (`btn sm`), not links:
   `Who would buy my small-batch hot sauce near Boulder`,
   `A shop that can powder-coat 200 steel brackets`,
   `A wholesale buyer for 40 acres of pinto beans`. The "Try:" prefix stays.
5. **Buttons instead of inline links for actions.** `linkish` is kept only
   for the "Show them" link inside a band's "N more" line. These become
   `btn sm`: `#more-toggle` ("More options"), "find buyers instead" /
   "find suppliers instead" in the reading line, "adjust" next to
   Industries (relabel "Change codes"), and the Check all button already
   is a button. The filters stay a segmented group (`.seg`), unchanged.
6. **Favicon and wordmark.** Inline SVG favicon as a `data:` URI in
   `<link rel="icon">`: a 32×32 teal (`#0d6f67`) rounded square with a
   white "R" in the system sans, nothing else. The `h1.brand-mark` gets a
   12×12 teal square (CSS `::before`, `--act`) before the text, no image
   file. CSP: `img-src 'self' data:` must be allowed for the icon; check
   `server.ts` CSP header and `tests/web/server.test.ts` CSP assertions.
7. **"Before you call" on the empty buyer page.** When `renderEmpty` runs
   for a buyer search and `app.map.caveats` exist, the caveats already
   print in the reading line; `renderEmpty` must not repeat them as tips.
   The empty-tips list is at most three items, each one sentence, and the
   first tip for a buyer search with no codes is the one that explains
   codes; drop "Try different words" when the direction is sell.
8. `design.html` gains samples for `.label`, the new examples row, the
   `displayName` cases (all caps → title, mixed stays, LLC/HVAC), and the
   favicon/wordmark; `/design` remains free of serious a11y violations.

## J4 — hygiene (coder does the file moves; the orchestrator runs gitleaks) ✅ (2026-10-28; docs/handoffs and LEARNING.md deleted, LICENSE-MIT → LICENSE; screenshots NOT re-captured: the capture includes the owner's Recent searches list, old images kept)

Gitleaks (K18): "gitleaks 8.30.1 scanned all 71 commits on 2026-10-28: no leaks found. The PACA shard's filed gmail addresses are public records (Threat 5) and did not trip it."

- Delete `docs/handoffs/` (four files). `original-kickoff.md` is the only
  reference to `LICENSE-MIT`'s old scope and goes with it.
- Rename `LICENSE-MIT` → `LICENSE` (content unchanged) and update the
  README line and PLAN v8 A12 wording.
- `.claude/agents/coder.md` stays. `registry-engine-audit.md` stays untracked.
- Orchestrator after the coder: `brew install gitleaks` (or `npx`-free
  binary) and `gitleaks detect --source . --log-opts="--all"`; record the
  result in PLAN.

## Amendments after the independent review (2026-10-28) — these override J1–J4 where they differ

K1. **README API section.** `curl -N -X POST http://localhost:4317/api/search -H 'Content-Type: application/json' -d '{"query":"…","near":"80302"}'`.
    State: any other Host header gets 403 (local-only by design); one
    search at a time (429); bad fields 400; non-JSON 415. Event types, one
    line each: `map`, `origin`, `routed`, `fetched`, `source_error`,
    `merged`, `backfilled`, `backfill_progress`, `probed`, `recent`,
    `contacts`, then exactly one of `result` or `error`. Body fields (see
    `parseSearchParams`): `query`, `near`, `radiusMi`, `naics`, `leads`,
    `region`, `direction`, `checkAll`, `findContacts`, `noLlm`. Routes also
    include `GET /api/csv` (last search) and HEAD on `/api/status`.
K2. **README library section.** "Inside this repo, run with `npx vite-node your-script.ts`; the packages aren't published." Example:
    `const out = await search("metal fabrication", { region: "US-CO", contacts: null })`
    then `out.ranked.slice(0, 10).map(l => l.entity.name)`. Say: leaving
    out `llm` means the static table (supplier searches only); pass
    `llm: { backend: llmBackendFromEnv().backend }` for the ≤2 AI calls;
    `contacts: null` keeps paid lookups off even when a key is in the env.
K3. **CLAUDE.md** check-all wording: "the web app's Check all button sends
    `checkAll: true`, which the server passes as `backfillAll`." Fix line
    81 ("…the web summary and the CLI"). Keep "Claude Code CLI (`claude -p`)"
    wording wherever it refers to Claude Code, not to apps/cli.
K4. **SECURITY.md** edits: line ~42 drop the `--verbose` clause; ~74 "The
    web server checks `region` against the manifest (`parseSearchParams`)";
    ~85 "The web app's `/api/csv` and My calls export write…"; ~108 drop
    "CLI `--check-all`"; ~132 "displayed in the web app"; ~167 "The web app
    labels them 'Agent/principals'". Changelog lines (238, 246) stay as
    history. Add v3.11.
K5. **Other apps/cli mentions**: engine.ts:68, adapter.ts:26 ("the web app
    injects a `claude -p` or API backend"), labels.js:279 ("summary.ts's
    copy"), labels.test.ts:263 title, ADR 0018:17 ("The page says which
    path is billed"). `summaryLines` stays exported (test-only now).
K6. **J2 rule, replacing the J2 text**: stems of 4+ letters keep today's
    open right side. A stem shorter than 4 letters must be followed by
    `(?:s|es|ed|ing)?` and then a non-alphanumeric or the end:
    `re = new RegExp("(^|[^a-z0-9])" + esc(s) + (s.length < 4 ? "(?:s|es|ed|ing)?(?![a-z0-9])" : ""))`.
    Comment: "Known trade-off: 'gas' no longer reaches 'gasoline'; type the full word."
    Plus the stemmer change (owner accepted): add `ies` to the suffix list
    before `es`, and drop a trailing `y` when 5+ letters remain. Existing
    naics tests at lines 58–70 stay unchanged and must pass; if the `y`
    rule breaks any existing test, keep the `ies` rule only and report it.
K7. **J2 tests** (naics.test.ts): `canvas bag` → `codes[0] === "314910"`
    and no title `/baker|pulp/i` in all 15; `bag` → no `/baker|pulp/i`,
    contains 314910, 322220, 326111; `hot sauce` → contains 311941, no
    `/hotel|casino/i`; `sew tote bags` → no 221320 or 237110 in the top 5,
    contains 315210 and 314910; `machining` → 332710; `welding` and
    `welders` → 333992; `bakeries` → 311811 and 311812; `bakery` → 311811;
    `brewery` → 312120; `printing` → 323111; `gasoline` → 447110.
K8. **J3.1 exact list** → `.label`: index.html:26, 31, 51, 59, 69, 77, 94,
    107, 112, 162; app.js:622, 675, 1165, 1285, 1296, 1299, 1468;
    design.html every non-band `eyebrow` including `design-label`
    captions. Keep `.eyebrow` only at app.js:1139 and design.html:86. Move
    app.css:138, 187, 212–217 selectors to `.label` (the group summary
    `+`/`−` `::before` lives there). public-assets.test.ts:32 regex →
    `class: "label"`. "About this search" is a `<summary>`, untouched. ADR
    0017 Decision gets one line: "Uppercase spaced eyebrows only for
    distance bands; other headings and labels use `.label`."
K9. **J3.2 displayName rules (replace)**: any lowercase letter → unchanged.
    Split on spaces. Keep as filed: tokens containing a digit, `&`, `/`,
    or a `.` other than trailing; tokens with no vowel `[AEIOUY]` (CNC, DJ,
    TV, RV, LLC, LLP, PC); allow-list INC, CO, LP, PLLC, DBA, USA, HVAC, II,
    III, IV (matched ignoring a trailing `.` or `,`). Particles OF, AND,
    THE, FOR, AT, IN, ON, DE, LA, DEL, Y → lowercase unless first word.
    Otherwise capitalize each hyphen-separated part; after an apostrophe a
    lone final `S` is lowercase, any other letter uppercase (`JOE'S` →
    `Joe's`, `O'BRIEN` → `O'Brien`). No state-code rule.
    **displayCity**: title-case each word with the same hyphen/apostrophe
    handling, no allow-list, no particles (`LA JUNTA` → `La Junta`).
K10. **J3.2 where applied**: `displayName` at app.js:1241 (`.lr-name`) and
    1487 (My calls), never for `lead.individual === true` or for
    officers/principals (as filed, ADR 0017); My calls entries store
    `individual: lead.individual === true` (app.js:1425–1437), entries
    without the field render as filed. `displayCity` only at app.js:1202
    (distance cell) and 1484 (My calls sub-line); the Reach "Address" row
    stays as filed. New `reachList` row `row("Filed as", lead.name)` when
    display ≠ filed. Aria-labels at 1294, 1413, 1469 use the display form.
    CSV, history, stored `entry.name`, clipboard text stay as filed. Drop
    "openers" and "trust/registry lines" from J3.2 (openers never carry
    the name). Both functions in labels.d.ts; pins in labels.test.ts:
    `ACME WELDING LLC` → `Acme Welding LLC`, `JOE'S HVAC INC.` → `Joe's HVAC INC.`,
    `O'BRIEN CNC` → `O'Brien CNC`, `MADE IN USA CO` → `Made in USA CO`,
    `A-1 SIGNS` → `A-1 Signs`, `B&B FARMS` → `B&B Farms`, `Mixed Case Inc`
    unchanged; `LA JUNTA` → `La Junta`.
K11. **J3.3 placeholder (replace)**: keep `color: var(--ink-2)` (a lighter
    colour fails WCAG contrast); the difference comes from weight: the
    placeholder is `--w`, typed text `--wb` (set `.ask-input` to `--wb`).
    Only the `#query` placeholder text changes; its label gets
    `class="label visually-hidden"` (existing class, app.css:56). The Near
    label stays visible.
K12. **J3.4 examples**: `class="btn sm example"`, `.examples-line` gets
    `align-items: center`; clicking an example clears `#near` so the town
    in the example is the centre.
K13. **J3.5**: remove the dead `.linkish.tap` rule; update design.html
    samples at lines 41, 50, 56.
K14. **J3.6 favicon**: `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%230d6f67'/%3E%3Ctext x='16' y='22' text-anchor='middle' font-family='system-ui,sans-serif' font-size='20' font-weight='700' fill='%23fff'%3ER%3C/text%3E%3C/svg%3E">`
    in index.html and design.html. CSP already allows `img-src 'self' data:`
    (server.ts:35): no server change; add `expect(csp).toContain("img-src 'self' data:")`
    at server.test.ts:139 and :151. `.brand-mark::before { display:inline-block; width:12px; height:12px; background:var(--act); margin-right:var(--s2) }`.
K15. **J3.7 renderEmpty (replace)**: at most 3 tips, in order: (a) if
    `app.map && app.map.direction === "sell" && app.map.naics.length === 0`:
    "Finding buyers needs industry codes: turn on the AI step, or add codes
    with the code finder under More options." and the reading line's
    "Before you call" skips the map.ts:228 caveat when `renderEmpty` runs;
    (b) if `p.radiusMi`: the existing radius tip; (c) if direction is not
    sell: "Try different words, like \"metal fabrication shop\"."; (d)
    "Add industry codes with the code finder under More options." only when
    (a) didn't run. Cut at 3.
K16. **J3.8**: design.js imports `displayName`/`displayCity` from
    `/labels.js` and fills a sample `<dl>` via `textContent`.
K17. **J4 additions**: delete `LEARNING.md` (describes removed packages).
    After everything passes, re-capture the README screenshots with
    `node scripts/docs/capture.mjs` (it drives the web app; 2 AI calls) so
    docs/media matches the new page; if Chromium isn't found, report and
    leave the old images.
K18. Orchestrator note: gitleaks 8.30.1 scanned all 71 commits on
    2026-10-28: no leaks found. The PACA shard's filed gmail addresses are
    public records (Threat 5) and did not trip it.

## Acceptance
`npm test`, `npm run typecheck`, `npm run a11y` pass; one live web search
on the Claude Code path with the server on `PORT=4399` then stopped;
screenshots are NOT re-captured in this phase (the capture script keeps
working: it drives the web app, not the CLI).

# v8 — bring your own keys, env only (before the repo goes public)

Working branch: `v8-byok` (off `main` after PR #11). Owner decision
2026-10-28: open-source the repo as a **run-it-yourself** tool. Every user
runs it on their own machine with their own credentials, read from the
environment only. No key field in the page, no hosted version. The server
stays single-user and localhost-bound (SECURITY Threat 8 unchanged).

What is true today, checked 2026-10-28: no secret has ever been committed
(history scanned), there are no `.env` files, the only secrets are
`EXA_API_KEY` / `PARALLEL_API_KEY` read at start, and the AI step works only
through `claude -p`. The adapter already has an Anthropic Messages backend
(`anthropicApiBackend`, not exported) that nothing wires up.

Scope rule: fix the mechanism (one place decides the LLM backend, and the
page/CLI tell the truth about who gets billed), document the keys, say what
is covered. Nothing else.

## Phase I1 — one place picks the LLM backend from the environment ✅ (2026-10-28; `llmBackendFromEnv` in `packages/qualify/src/llm/fromEnv.ts`, billing on the web result and CLI line; A6 API-key live gate: not run (no key in the orchestrator's shell), owner runs it before flipping visibility; Claude Code path re-measured: tote CLI 13,856 tokens $0.050, hot sauce 80302 CLI 14,351 $0.047, tote web 14,120 $0.050)

`packages/qualify/src/llm/adapter.ts`
- Add `export type LlmBilling = "subscription" | "api"`.
- `RawLlm` gets an optional readonly `billing?: LlmBilling`. The Anthropic
  backend sets `"api"`; `ClaudeCodeBackend` sets `"subscription"`.
- `Llm.usage()` (the object the engine copies into `SearchOutcome.llmUsage`)
  gains `billing: LlmBilling | null` (the raw backend's value, null when the
  backend declares none). Update the `LlmUsage`-summary type accordingly and
  the engine's copy, so the web stream and the CLI see it.
- `anthropicApiBackend(apiKey, modelOverride?)`: export it; when
  `modelOverride` is set it replaces `opts.model` (same contract as
  `ClaudeCodeBackend`). Nothing else in it changes. `costUsd` stays `null`
  on this path (the Messages API returns no price).
- New `export function llmBackendFromEnv(env: Record<string, string | undefined> = process.env, modelOverride?: string): { backend: RawLlm; billing: LlmBilling }`
  (put it in `claudeCodeBackend.ts` or a new `fromEnv.ts`, coder's choice,
  exported from the qualify index):
  - `ANTHROPIC_API_KEY` set and non-empty → `{ backend: anthropicApiBackend(key, modelOverride), billing: "api" }`.
  - otherwise → `{ backend: new ClaudeCodeBackend(modelOverride), billing: "subscription" }`
    (fails at call time if `claude` is missing, exactly as today).
  The key is read once here and lives only inside the backend closure. It
  is never logged, never put in an event, never written to history.

`apps/cli/src/index.ts`
- Replace `new ClaudeCodeBackend(flags["model"])` with
  `llmBackendFromEnv(process.env, flags["model"]).backend`.
- The usage line: keep tokens; the cost/billing tail becomes
  - billing `subscription`: `· about $X at API prices — billed to your Claude subscription via claude -p` (today's text)
  - billing `api`: `— billed to your Anthropic API key` (no dollar figure: the API returns none; the README table gives the order of magnitude)
- Help text: "LLM calls (max N/search) use ANTHROPIC_API_KEY when set,
  otherwise the Claude Code CLI (claude -p) on your subscription. --model
  is passed through as given (API model id, or a CLI alias like sonnet)."

`apps/web/src/server.ts`, `apps/web/src/main.ts`
- `AppDeps.llmAvailable: () => Promise<boolean>` becomes
  `llm: () => Promise<{ backend: RawLlm; billing: LlmBilling } | null>`.
  `main.ts` implements it: `ANTHROPIC_API_KEY` set → `llmBackendFromEnv()`
  result; else `claude --version` succeeds → `llmBackendFromEnv()` result;
  else null. (Same probe as today's `llmAvailable`, moved.)
- `/api/status` returns `llm: boolean` as before **plus**
  `llmBilling: "subscription" | "api" | null`. Nothing about the key itself
  reaches the browser.
- The search handler uses `(await deps.llm())?.backend`; when `noLlm` or
  null, omit `llm` as today.

`apps/web/public/labels.js`, `app.js`, `index.html`, `labels.d.ts`, `design.html`
- "AI calls" row: `billing === "api"` → `2 · 13.5k tokens · billed to your Anthropic API key`;
  otherwise today's text (`about $0.06 at API prices` when a cost exists).
  The predicate lives in `labels.js`.
- `#llm-hint` when `status.llm` is false: "AI is off: set ANTHROPIC_API_KEY,
  or install Claude Code and log in, then restart." (static text in the HTML, no data).
- The AI-failure note (app.js, `event.llmError`) becomes
  "The AI step failed (…). Check your ANTHROPIC_API_KEY, or if you use
  Claude Code run claude in a terminal and log in. Call notes below are templates."
- `design.html` sample: add the API-billing variant of the row.

Tests
- `tests/qualify/adapter.test.ts`: `llmBackendFromEnv` picks the API
  backend with the key, Claude Code without; empty-string key counts as
  unset; `modelOverride` reaches the API request body; `usage().billing`
  reflects the backend; a stub backend with no `billing` yields null.
- `tests/web/server.test.ts`: `/api/status` carries `llmBilling`; search
  uses the backend from `deps.llm`; `deps.llm` returning null means no LLM
  config reaches `search` (assert on the stub's received config).
- `tests/web/labels.test.ts`: the "AI calls" row for both billings.
- Existing fixtures that stub `llmAvailable` move to `llm`.

## Phase I2 — say what is covered ✅ (2026-10-28; `coverageLine` appended to the ask-bar fine print; README coverage line, ECHO in the coverage sentence, "Add a state or a source")

- `/api/status` already returns `regions`. `app.js` renders one quiet line
  under the State select (or under the ask bar when there is one region):
  "Public records for CO, CT and NY. Other states: add a source to the
  manifest (see README)." built from `status.regions` with `textContent`.
  Text builder in `labels.js` (`coverageLine(regions)`), pinned by a test.
- README: a **Coverage** paragraph right under the title paragraph: Colorado
  has every source; Connecticut and New York have their state registry plus
  PACA; EPA facilities are nationwide; other states are a manifest entry
  (link to the section in CLAUDE.md). Keep the sources table as is.
- README: a short **Add a state or a source** section after the sources
  table, three cases: (1) a registry on Socrata, a static shard, or ECHO is a
  manifest entry (point at `zero-code-state.test.ts` as the guarantee and
  at the `SourceSpec` keys listed in CLAUDE.md); (2) PPP for another state is
  `build_ppp_shards.py --state XX` over the public SBA CSVs; (3) another
  platform (CKAN, ArcGIS, bulk CSV) needs a new driver in
  `packages/registry-core/src/drivers/`, which is the one case that is code.
  ZIP and place centroids are already nationwide.

## Phase I3 — keys and data-flow documentation ✅ (2026-10-28; .env.example, .gitignore, README keys/data/cost/MIT, CLAUDE.md, SECURITY item 7 + v3.10, ADR 0018, handoff paths, license fields)

- `.env.example` at the repo root: the three optional variables with a
  one-line comment each (`ANTHROPIC_API_KEY`, `EXA_API_KEY`,
  `PARALLEL_API_KEY`) and a header saying the app reads the shell
  environment, nothing loads this file automatically (`export` or `source`
  it). `.gitignore` adds `.env` and `.env.*` with `!.env.example`.
- README "Run" section: rename the bullets to **Bring your own keys**:
  AI via `ANTHROPIC_API_KEY` or Claude Code login; contacts via Exa or
  Parallel; nothing is required. Add a short **Where your data goes** list:
  the server listens on localhost only; a search calls the public registries
  listed in the table, Anthropic (or your Claude Code login) for the two AI
  calls, and Exa/Parallel only if you set a key; finished searches are kept
  under `~/.cache/registry-engine`; keys are read from the environment, never
  stored or shown in the page.
- README cost section: note that with an API key the sheet shows tokens only
  and the bill is on your Anthropic console.
- `CLAUDE.md`: the "default path makes 2 LLM calls via the Claude Code CLI"
  sentences (Commands section, CLI flags) say "via `ANTHROPIC_API_KEY` when
  set, otherwise the Claude Code CLI". Nothing else.
- `SECURITY.md` Threat 8: new item 7 "Credentials": keys are read from the
  process environment at start, held only inside the backend closures,
  never written to history files or logs, and `/api/status` exposes only
  which billing path is active. Changelog entry v3.10.
- ADR 0018 (short): public repo as a run-it-yourself tool; env-only
  credentials; no key field and no hosted mode, with the reasons (keys never
  touch the page or disk; the server's threat model assumes one local user;
  hosting other people's keys is a different product).

## Amendments after the independent review (2026-10-28) — these override the text above

A1. **No `billing` on `RawLlm`, `Llm` or `SearchOutcome`.** `llmBackendFromEnv`
    returns `{ backend, billing }` with `billing: "claude-code" | "api-key"`
    (export the type `LlmBilling`). The CLI uses that value directly. The web
    server's `buildResult` adds `llmBilling: LlmBilling | null` (null when
    noLlm or no backend), so the stream and history carry it. Pre-v8 history
    files have no field and fall back to today's text. Drop the adapter
    "stub backend with no billing" test; add a server test asserting
    `result.llmBilling` for both paths and null under noLlm.
A2. **`anthropicApiBackend` must work live.** On this path only:
    `output_config: { effort: "low" }`, `max_tokens: Math.max(opts.maxTokens, 4000)`,
    `signal: AbortSignal.timeout(120_000)`, drop the
    `anthropic-dangerous-direct-browser-access` header. On `!resp.ok` parse
    the JSON body and throw `Anthropic API error <status> (<error.type>: <error.message sliced to 120>)`,
    never the raw body (fallback: `Anthropic API error <status>`). Throw when
    `stop_reason` is `max_tokens` or `refusal`. Keep `createLlm({apiKey})`
    as is (it calls the same function); do not add a third way.
A3. **CLI `--model` fail-fast**: when billing is `api-key` and `--model` is
    set and does not start with `claude-`, `fail("--model with ANTHROPIC_API_KEY needs a full model id, e.g. claude-sonnet-5-5")`.
    Help text: "LLM calls (max N/search) use ANTHROPIC_API_KEY when set
    (full model ids), otherwise your Claude Code login (claude -p; aliases
    like sonnet work)."
A4. **Probe once.** `main.ts` memoizes `llm()` (one promise, resolved
    lazily on first call). Fixtures to move from `llmAvailable` to `llm`:
    tests/web/server.test.ts (two sites), tests/web/sheet-fixture.test.ts,
    and **scripts/a11y/axe.ts** (not covered by typecheck; `npm run a11y`
    must still pass).
A5. **Labels read the result, not the status.** The "AI calls" row reads
    `result.llmBilling`: `api-key` → `2 · 13.5k tokens · billed to your Anthropic API key`;
    `claude-code` or missing → today's text, but the CLI/README wording
    "billed to your Claude subscription" becomes "via your Claude Code login
    (claude -p)" everywhere (Claude Code may itself be on a key, Bedrock or
    Vertex). The llmError hint is chosen by `status.llmBilling` in
    `labels.js` (`llmFailedHint(billing)`): api-key → "Check ANTHROPIC_API_KEY";
    claude-code → "Run claude in a terminal and log in"; then "Call notes
    below are templates." Pinned by labels.test.ts.
A6. **Live acceptance for I1**: with a real `ANTHROPIC_API_KEY` in the shell,
    one supplier and one buyer CLI search succeed (map parsed, brief not a
    template), tokens recorded here in PLAN; re-measure the README token
    table rows from the Claude Code path at the same time (the table still
    names Haiku 4.5 / Sonnet 5). If the orchestrator has no key, the gate is
    recorded as "not run" and the owner runs it before flipping visibility.
A7. **I2 UI: one always-visible line.** `coverageLine(regions)` in
    `labels.js` → "Public records for CO, CT and NY." appended to the
    existing `.quiet.fine` span in `.ask-actions` (index.html:37) via
    `textContent`. No manifest wording in the page; nothing under the State
    select.
A8. **I2 README**: fix the existing coverage sentence under the sources
    table to include EPA ECHO (nationwide); add one short coverage line to
    the title paragraph; no new paragraph. "Add a state" says: PPP needs
    `build_ppp_shards.py --state XX` **and** `US-XX` in the `ppp` entry's
    `quirks.shardRegions`; town-name centers need
    `python3 -I scripts/data/build_geo.py --states CO,CT,NY,XX`
    (ZIPs are already national, places are per state); the zero-code
    guarantee test pins the **socrata** driver; an existence registry wants
    `quirks.cities` for town detection. Delete "centroids are already nationwide".
A9. **`.env.example`** uses `export VAR=` lines and says `source .env` (or
    `set -a; . ./.env; set +a`), because plain `VAR=` lines don't reach
    child processes.
A10. **"Where your data goes"** also lists: Cloudflare DNS-over-HTTPS for
    lead domains (`probe.ts`); the contacts cache at
    `~/.cache/registry-engine/contacts.json` (30 days); saved searches at
    `~/.cache/registry-engine/searches`; the browser's localStorage for My
    calls; and what Anthropic receives (the request text and the record
    facts of the top N leads, individuals' names withheld).
A11. **SECURITY item 7** wording: keys are "read from the process
    environment only (never from a request, a file or the page), held inside
    the backend closures, never written to history or logs; API error text
    is reduced to status and error type before it reaches the page or
    history; `/api/status` exposes only which billing path is active."
A12. **Public-release hygiene (same phase, same PR):**
    - `docs/handoffs/v2-handoff.md` lines 3 and 8, `docs/handoffs/v5-handoff.md`
      lines 3 and 5: replace absolute `/Users/...` paths and the remote URL
      with repo-relative wording.
    - License: the root `LICENSE` (`LICENSE-MIT` until v9) covers the whole repo. Add
      `"license": "MIT"` to the root `package.json` and to qualify, cli and
      web package.json; one README line "MIT, see LICENSE"; CLAUDE.md
      package layout drops the "MIT." from registry-core's line (it is the
      whole repo now).
    - ADR 0018 adds one line: the PPP and PACA shards are public federal
      records that name individuals, published as filed (SECURITY Threat 5),
      and shipping them in the repo is a deliberate choice.
    - Not in scope for the coder: git author email in history and old
      Co-Authored-By trailers (owner's call); `registry-engine-audit.md`
      stays untracked.

## Out of scope (owner decisions)
- A key field in the page or browser storage of keys. Env only.
- Hosting, multi-user history, rate limiting for strangers.
- Pricing tokens on the API path.
- Flipping the GitHub visibility: the owner does that after merge.

# v7b — web label only from a lookup; check every name against the registry

Working branch: `v7b-web-label-check-all` (off `main` after PR #10). Owner
decisions 2026-10-27, after seeing the merged sheet live:

1. "No website on record" is on nearly every lead and reads as "no web
   presence". It only means the government filing has no website field,
   which is true of almost every PPP, SOS and EPA record. Decision: the
   page says nothing about web presence unless a real web lookup ran (Exa
   or Parallel key). Filters that depend on a record-only web fact go away.
2. Only 80 names per search are checked against the state registry
   (`MAX_BACKFILL_NAMES` in the Socrata driver, `BACKFILL_ENTITIES` 150 in
   the engine). Measured 2026-10-27 against CO SoS, produce near Denver
   (709 coded leads): capped 22 s / 33 registry matches; uncapped 180 s /
   223 matches. Cost is per name pattern (~0.25 s each) whatever the chunk
   size: 50 per query took 209 s, 100 per query hit the 20 s request
   deadline. Tote bags (46 coded) is fully checked either way, 31 s.
   Decision: fast by default, plus a "Check all N names" action that re-runs
   the search with no cap, shows progress, and replaces the sheet and its
   stored copy. CLI gets `--check-all`. `NAME_CHUNK` stays 25.

Same protocol as v7: independent read-only review of this spec against the
code (Opus 5.5 high), then the coder (Opus 5.5 medium) implements only the
agreed items, one commit per batch by the orchestrator.

## Phase H1 — web presence only from a lookup ✅ (2026-10-27)

Where `lead.web` ("verified" | "unresolved" | "none") comes from: the DNS
probe of a *filed* website (v7 F1). `lead.found` comes from the web lookup
(contacts verb), only for the top N leads and only with a provider key.

- `apps/web/public/labels.js`
  - `webTag(lead)`: returns `null` when nothing was actually checked: no
    `found` and `web === "none"`. Keep "Website responds" (a filed website
    that resolves is real), "Listed website didn't respond", and the three
    `found` labels. Delete the "No website on record" literal; the
    every-literal-pinned test in `tests/web/labels.test.ts` must still pass
    with that pin removed.
  - `FILTERS` "noweb" (`No web presence`): predicate becomes
    `lead.found !== null && !hasSite(lead)` (a lead nobody looked up is not
    "no web presence"). The page shows this filter button only when
    `result.contactLookups` is non-null (a lookup ran this search); the
    coder finds where `renderTools` builds the segment and skips it
    otherwise. `/design` (`design.js`) drops its "No website on record"
    sample and shows the `found` ones.
- `apps/web/public/app.js`: `trustLine` already tolerates a null tag (F10);
  make sure an empty `trust-tag` span is not rendered when `webTag` is
  null. The detail rows (`row("Web", …)`, `row("Search", …)`) stay.
- **Remove `hiddenOnly` / `--hidden`** everywhere: it filtered on
  `web === "none"`, a record-only fact that can't be made correct (the
  lookup never covers every lead). `packages/qualify/src/engine.ts`
  (`SearchConfig.hiddenOnly`, the filter at ~line 320), `apps/cli/src/index.ts`
  (flag + help line), `apps/web/src/server.ts` (`SearchParams.hiddenOnly`,
  `parseSearchParams`, the `search()` call), `apps/web/public/index.html`
  (`#hidden-only` checkbox) and `app.js` (`readParams`, the `renderEmpty`
  tip), `tests/web/server.test.ts:341` (drop the field), any engine test
  using it, README and CLAUDE.md lines that mention `--hidden`
  (CLAUDE.md "Ranking" paragraph: "`--hidden` filters on it" → delete that
  clause; the "Contacts and web presence add nothing" rule stays).
- `packages/qualify/src/summary.ts`: drop the "N have no website listed in
  the records searched" line and the `noWebsite` count (record-only).
  Update `tests/qualify/summary.test.ts`.
- `apps/cli/src/index.ts` web line: `domain ✓ <host>` (verified),
  `published domain did not resolve → <search url>` (unresolved),
  "Individual's record — no web search offered", else just
  `search → <url>` with no claim about websites. If `lead.found` exists,
  print `found  <status> <website or listings>` on its own line (check what
  the CLI prints for `found` today and keep it if it already does).
- `docs/decisions/0017-*.md` (field-sheet labels): one amendment: the web
  tag is shown only when something was checked. `README.md` "Know before
  you call": one sentence: without an Exa/Parallel key the sheet says
  nothing about websites; every business lead keeps its search link.

## Phase H2 — "Check all N names" against the registry ✅ (2026-10-27; live: produce near Denver, capped 80 of 752 names in 19 s; --check-all 752 names, 223 matched, 101 s)

- `packages/registry-core/src/driver.ts`: `Driver.fetchByNames(source,
  names, opts?, extra?)` gains an optional fourth argument
  `{ maxNames?: number; onProgress?: (checked: number, total: number) => void }`.
  `packages/registry-core/src/drivers/socrata.ts`: `maxNames` overrides
  `MAX_BACKFILL_NAMES` (`Infinity` = no cap); `onProgress` is called after
  each chunk's queries settle with the number of name patterns covered so
  far and the total. Chunks still run through the existing `Limiter`
  (concurrency 4); the coder replaces the single `Promise.all` with a
  per-chunk loop that keeps the limiter's parallelism (e.g. map chunks to
  promises and attach the progress call to each). `NAME_CHUNK` stays 25.
- `packages/qualify/src/engine.ts`: `SearchConfig.backfillAll?: boolean`.
  When true: no `BACKFILL_ENTITIES` slice, `maxNames: Infinity`, and a new
  event `{ type: "backfill_progress"; sourceId; checked; total }` from
  `onProgress`. `RegistryLookup` gains `all: boolean` and `candidates`
  becomes the full unmatched count (not `min(unmatched, 150)`), so the page
  can say "80 of 384"; `nameCap` is `null` when `all`.
  Test (`tests/qualify/engine-backfill.test.ts`): a stub driver records
  the `extra` argument; default run gets `maxNames` undefined and ≤150
  names; `backfillAll` gets every name, `maxNames: Infinity`, and the
  progress events arrive in order with the right total.
- `apps/web/src/server.ts`: `SearchParams.checkAll` (boolean, default
  false) → `backfillAll`. `translateEvent` maps `backfill_progress` to the
  step line the page already shows for the registry step, text "Checked
  200 of 384 names against the state registry". `historyId` ignores
  `checkAll` on purpose: the fuller run overwrites the stored copy.
  Test: `checkAll: true` reaches `search()` as `backfillAll: true`.
- `apps/web/public/app.js` + `labels.js`:
  - A line under the summary sentence (next to `#new-since`), from
    `result.registryLookup`: when `status === "ran"` and `!all` and
    `namesChecked < candidates`: "Checked 80 of 384 names against the state
    registry." plus a button **Check all 384 names** with the estimate in
    the label: `about N min` from `Math.ceil(candidates * 0.25 / 60)`, or
    "under a minute" when `candidates * 0.25 < 60`. Click →
    `runSearch({ ...app.lastParams, checkAll: true })` via the same guard
    path the direction link uses (F7). When `all`: "Checked all 384 names
    against the state registry." and no button. `aboutRows` registry row:
    "80 of 384 not already matched (at most 80 per search unless you check
    all)" / "all 384".
  - `readParams` never sets `checkAll`; only that button does. A stored
    search opened from Recent shows the line from its stored result.
  - Pin the two sentence forms in `tests/web/labels.test.ts` if they live
    in `labels.js` (put them there).
- `apps/cli/src/index.ts`: `--check-all` → `backfillAll: true`; the summary
  prints "Checked 80 of 384 names against the state registry (--check-all
  checks every name, about N min)" or "Checked all 384 names". Progress
  events print as `backfill co_sos: 200/384 names` lines (verbose or not,
  coder's call: match how `fetched` lines print).
- Docs: ADR 0013 amendment (the cap, the measured cost, the check-all
  action); README CLI flags (`--check-all`) and the web line; SECURITY.md
  Threat 4: "check all" sends `ceil(names/25) × 2` registry requests at
  concurrency 4 under the same deadlines; changelog v3.9. CLAUDE.md CLI
  flags list: add `--check-all`, drop `--hidden`.

## Amendments after the independent review (2026-10-27) — these win over the bullets above

H1
- `webTag` simply ends with `return null` (covers `found.status === "skipped"`).
  `apps/web/public/labels.d.ts:20` → `string | null`.
- A **failed** lookup is not "no web presence": `contacts.ts:331-334` stores a
  failure as `status: "not-found"` with `reason`. `webTag` returns null when
  `f.reason` is set; the noweb predicate is
  `Boolean(lead.found) && !lead.found.reason && !hasSite(lead)`; app.js:1309
  ("likely no web presence") gets the same exclusion. Pin the failed case.
- `trustLine` (app.js:1171): compute the tag first; render no `trust-tag` span
  when it is null (today an empty span is rendered for individuals).
- The "No website on record" sample is in `design.html:89` (not design.js):
  replace with a `found` sample; keep the noweb filter button at :73. Add a
  sample of the H2 registry line + button to design.html.
- `hiddenOnly` removal also touches: `tests/web/server.test.ts:345`
  (`toMatchObject`), `tests/qualify/engine-coded.test.ts:213-223` (delete
  the test), `brief.ts:16-17` comment, ADR 0015:50 (one-line "removed in
  v7b"), SECURITY.md integrity item 6 (:158) → "Without a web lookup the
  sheet makes no website claim; every business lead keeps a search link."
  README has no `--hidden` mention.
- `noWebsite` removal also breaks `tests/web/server.test.ts:253` and
  `tests/qualify/summary.test.ts:20, 32-41`; update them.
- CLI: `found` is already printed (`foundLine`, index.ts:273); keep it. Only
  the last branch at :271 becomes `search → <url>`.
- `brief.ts:248`: omit the `web` field from the brief prompt when it is
  `"none"` (the model must not be told "no website"); update
  `brief.test.ts:175`.

H2
- **The engine caps too.** `planBackfill(candidates, driver, cap =
  driver.maxBackfillNames ?? Infinity)` gets a third argument; under
  `backfillAll` pass `Infinity`. Never spread the driver object (it drops the
  prototype method `backfillKey`). The driver's own `MAX_BACKFILL_NAMES`
  stays as the default and is overridden only by `maxNames`.
- **Units.** Drop `all` and leave `candidates` alone. Add
  `RegistryLookup.totalNames = planBackfill(unmatched, driver, Infinity).keyCount`
  (pure, no requests). The page/CLI show the button iff
  `namesChecked < totalNames`; "Checked all N names" when equal; the
  estimate uses `totalNames`. `nameCap` is null under `backfillAll`. A
  stored result without `totalNames` shows no line.
  Breaks and updates: `engine-registry-check.test.ts:83`,
  `server.test.ts:51, :269`, `tests/web/fixtures/sheet-outcome.ts:103`,
  `labels.test.ts:188/195`.
- Under `backfillAll`, the candidates are the unmatched entities whose codes
  relate to the map's codes (`naicsRelated`), i.e. the ones the sheet lists;
  when the map has no codes, all unmatched. `totalNames` is computed over
  the same set.
- Progress: emit `backfill_progress` on every run, not only under
  `backfillAll` (removes a branch; a default run has ≤4 chunks). In
  socrata.ts, map each chunk to `Promise.all([active, inactive?]).then(...)`
  with a running sum (chunks settle out of order); a chunk counts when both
  its queries settle; `total` is the deduped, capped pattern count. The
  server sends counts `{ type: "backfill_progress", checked, total }` and
  labels.js composes the text, like every other step. The page updates the
  existing "confirm" step (app.js:503) in place: `setStep("confirm",
  "active", "200 of 384 names")`.
- Server: `checkAll` must be read explicitly in `parseSearchParams`
  (unknown keys are ignored): `flag("checkAll", false)`.
- Page: static `<p id="registry-line" class="fine quiet" hidden>` after
  `#new-since` (index.html:148), filled in `renderTools`; add it to the
  print-hide list in app.css (~275). The direction link builds its params
  **without** `checkAll`; Retry keeps it.
- Estimate: one named constant `SECONDS_PER_NAME = 0.25` in labels.js with
  a comment (measured 2026-10-27 on CO SoS); the CLI keeps a copy exported
  from qualify's `summary.ts`, and labels.test.ts asserts the two are equal.
- SECURITY Threat 4 wording: "check all" sends `ceil(names/25)` requests
  (×2 with `backfillInactive`), plus pagination past 200 rows per chunk, at
  concurrency 4 under the 20 s deadline.
- Docs: README has no CLI flags list; only the web sentence goes there.
  Note in ADR 0013: check-all is a full re-run, so the AI map call may
  pick slightly different codes; accepted.

### Not changed
- The cap itself (80 names / 150 candidates) stays the default. Raising it
  was measured and rejected: cost is linear in names.
- No background continuation: "check all" is a second full search the user
  asks for, through the existing single-search lock and the stream.

---

# v7 — audit fixes + search history

Working branch: `v7-audit-fixes` (off `main`). Input: `registry-engine-audit.md`
(independent, read-only, run at 7873319). Triage decided 2026-10-27 with the
owner: fix the real bugs, keep each fix at the mechanism that caused it, add
nothing the audit didn't observe. Each item below is one commit. Before the
coder runs, an independent reviewer (Opus 5.5, high) reads this spec against
the code and marks each item agree / push back / not relevant; only agreed
items are implemented.

Rules for the coder: implement each item exactly; `npm test` and
`npm run typecheck` must pass; no refactors beyond the item; DEVIATION
REQUEST when the spec and the code disagree.

## Phase F — audit fixes ✅ (2026-10-27; committed in three groups by file overlap: F1/F2/F4, F3/F5, F6/F8, then F7/F10 with Phase G)

### F1. Email host is not a website (audit H2)
`packages/qualify/src/verbs/probe.ts`, `publishedDomain`: return a host only
from URL-shaped contacts (the second branch). An email address never yields a
domain, so it is never DNS-probed and never turns `web` into `verified`. The
email stays in `entity.contacts` as filed. The `info@` guess stays, and now
only follows a filed website whose MX resolves (unchanged `hasEmail` guard).
Since the URL branch is then the only path, require an alphabetic TLD in its
regex so a dotted phone ("303.555.0100") is not a host.
Tests to update (reviewer's list): `tests/qualify/probe.test.ts:28-30`
(`sales@acmegems.com` → null); `probe.test.ts:64-74` Leevers → contacts
`["debbiel@leevers.com","https://leevers.com"]`, expect domain `leevers.com`
and `emailGuess` null; `tests/qualify/brief.test.ts:111-115,126-132` fixture
`withSite` → `"https://example.com"`; `tests/qualify/engine-coded.test.ts`
Visser's contact → `"https://visser.example"`. Add: contacts
`["ldiess@mccarronlaw.com"]` → `publishedDomain` null, `webPresence`
`"none"`. Run `tests/e2e-golden.test.ts` and confirm it still passes.
Update the header comment in `probe.ts` (lines ~4-9 and ~132) and add a
one-line amendment to ADR 0013 (it says probe verifies "an email or website").
Why not "email host resolves" as a third label: it adds a state the sheet
would have to explain, for no decision the caller makes differently.

### F2. Every outbound fetch has a deadline; Retry-After is capped (audit H3)
`packages/registry-core/src/util/http.ts`: `FetchRetryOptions` gains
`timeoutMs?: number` (default 20_000). Each attempt calls
`fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })`. A timeout
rejects like a network error and is retried by the existing loop. In the 429
branch: `delay = Math.min(parsed * 1000, 30_000)` (the same ceiling
`jitteredBackoff` uses; lift `30000` into one `MAX_BACKOFF_MS` constant used
by both). Every driver already calls `fetchWithRetry`, so no driver changes.
Also `packages/qualify/src/verbs/probe.ts` `hasRecords`: pass
`signal: AbortSignal.timeout(5_000)` to the DoH fetch (the existing catch
turns a timeout into `false`); a stalled DoH call otherwise blocks the probe's
`Promise.all` on every search.
Note: the signal also covers the body read, and a stall during `resp.json()`
rejects in the driver (a `source_error`), not in the retry loop. Worst case
per request is about 5 attempts × 20 s plus backoff.
Tests (`tests/registry-core/http.test.ts`, `vi.stubGlobal("fetch", …)`):
(a) a stubbed `fetch` that only settles when its signal aborts,
`timeoutMs: 20, maxRetries: 0` → rejects within 1 s; (b) 429 with
`Retry-After: 3600` then 200, `maxRetries: 1`, `vi.useFakeTimers` →
resolves after advancing 30 s, not 3600 s. No `opts.fetch` injection.
`SECURITY.md` Threat 4: "each request attempt has a 20 s deadline (DNS
probe 5 s); Retry-After is capped at 30 s"; changelog v3.8.
Not in scope: aborting the search when the browser tab closes (needs a signal
through every verb; the freeze was reasoned, not observed).

### F3. Code lookup matches word starts (audit M1)
`packages/registry-core/src/naics.ts`, `lookupCodes` → `matched`: a stem
counts only at a word start: `new RegExp("(^|[^a-z0-9])" + escape(stem))`
over the lowercased text. Right side stays open (stems are prefixes:
"fabr" must still find "fabricating"). Escape regex metacharacters in the
stem and compile the stem RegExps once per `lookupCodes` call, not inside
`matched` (which runs ~20k times). Known remaining prefix hits: "bag" →
"bagels", "bagasse"; accepted.
Tests (`tests/registry-core/naics.test.ts`): `lookupCodes(["canvas","bag"])`
does not contain `111219` (cabbage) or `236210` (garbage); still contains
`314910` first; `["metal","fabrication"]` still finds 332312/332322.

### F4. CLI map prompt capped at 300 (audit M5)
`packages/qualify/src/verbs/map.ts`: build the prompt from
`query.slice(0, 300)`. Test in `tests/qualify/map.test.ts`: a 1,000-char
query → the stub LLM's prompt starts with the first 300 chars and the query
part is 300 long. `SECURITY.md` Threat 1 says the request is "JSON-stringified and capped at
300" for map and brief; map sends plain text. Fix the wording: "map sends the
request as text, capped at 300; brief sends it JSON-stringified". Do not
JSON-stringify the map prompt (it would change the validated prompt and
break `map.test.ts:111-112`).

### F5. Socrata asks for what it needs and checks the status (audit M4)
`packages/registry-core/src/drivers/socrata.ts`, `pages`: `$limit` is
`Math.min(PAGE_SIZE, limit - rows.length)` (`limit` may be `Infinity`);
`offset += requested`; stop when a page is shorter than what was requested. Before `resp.json()`: `if (!resp.ok) throw new
Error(\`${source.id}: HTTP ${resp.status}\`)`. Tests
(`tests/registry-core/socrata-driver.test.ts`): a fetch with `limit: 5`
requests `$limit=5`; a 404 response rejects (the engine already turns a
driver throw into a `source_error` event).

### F6. The CLI says when the AI call failed (audit M6a)
`apps/cli/src/index.ts`, the `LLM calls:` summary line: when
`out.map.llmError !== undefined`, append ` (the AI step failed; see the
warning above)`. The counter itself is not changed: it increments before the
call on purpose, as the budget guard. No env-selected API backend (M6b):
owner declined.

### F7. Buyers without AI: don't run a search that can't work (audit H1)
`apps/web/public/app.js`:
- `function sellNeedsCodes(params)`: `params.noLlm && params.direction ===
  "sell" && !params.naics`.
- Submit handler and the saved-search "Run" button: if `sellNeedsCodes`,
  don't call `runSearch`; `updateCodeBox()` already shows the box for
  Skip AI + sell; focus `#code-q`; return. Results on screen stay.
- The "find buyers instead" link: `setDirection(other)`, then the same
  check with `{ ...app.lastParams, direction: other }`; run only when it
  passes. A sheet is never replaced by a search that is known to be empty.
- One helper `blockForCodes()` used by all three paths: `updateCodeBox()`,
  `scrollTo($("code-box"))`, `$("code-q").focus()`. Add
  `aria-describedby="code-why"` to `#code-q` in index.html.
- `renderEmpty`: keep the existing gate (`p.noLlm && app.map &&
  app.map.direction === "sell"`) and add `&& !p.naics`. Inside it, branch on
  wording only: when `app.status && app.status.llm === false` the tip reads
  "Finding buyers needs industry codes when the AI step is off. Look them up
  with the code finder above."; otherwise the current sentence.
What this does not catch: "Let us guess" with the server guessing sell
(the README hot-sauce example). That search still runs and returns empty;
the code box already shows there (the map event sets `codeBoxReason`), and
F7 only improves the wording.
Tests: `tests/web/labels.test.ts` pins label text, not flows; no new test
harness for app.js. The reviewer checks the three paths by reading.

### F8. CLI flags and plural (audit L1, L2)
`apps/cli/src/index.ts`: one `VALUE_FLAGS` list (`csv`, `near`, `naics`,
`model`, `region`, `shards`); any of them given without `=value` → print
`--<flag> needs a value (e.g. --csv=leads.csv)` and exit 1. Unknown command
→ help, exit 2; no-args and `help` keep exit 0.
`packages/qualify/src/summary.ts`: "1 business" / "n businesses"; same for
"1 has no website" and "+1 individual's record".
Test: `tests/qualify/summary.test.ts` for the singular forms.

### F9. Copy opener (audit L3) — dropped
Reviewer: `copyText` already toasts on every failure path and user
activation outlasts a rejected promise in Chrome and Firefox; the audit
marked it inconclusive. Nothing observed, nothing changed.

### F10. Individual's record never gets the web tag (audit M3, residual)
`apps/web/public/app.js` `trustLine` (~line 1039): the fallback to `webTag`
is skipped for `lead.individual` (`t.tag || (lead.individual ? null :
webTag(lead))`). Only reachable when an individual's record joins a
registry entry; one line.

### Not changed (stale: the audit ran before the v6 field sheet)
M2 (intro promised phones: the sentence is gone), M3 (individuals are a
separate group with no web row; the residual is F10), L4 (the step list is
still hidden on every result, but the per-source counts moved into "About
this search", which was the audit's own alternative fix). Confirmed by the
reviewer on 5ea00b7.

## Phase G — search history ✅ (2026-10-27; live check: one search wrote a 125 KB json + 52 KB csv under a 0700 dir; list, open, csv-by-id and bad-id 400 all verified against the running server)

Problem: a finished sheet lives only in the server's memory. A reload, the
next search, or restarting `npm start` loses it, and re-running costs 5–12 s
and the AI calls. Decision: every finished search is kept on disk, server
side; the browser's "Saved searches" keeps its meaning (what's new since).

### G1. Server: write each result, list, open
`apps/web/src/server.ts`:
- `AppDeps.historyDir?: string`. `main.ts` passes
  `join(homedir(), ".cache", "registry-engine", "searches")` (next to the
  contacts cache). Undefined (tests that don't care) = no history.
- `historyId(params)`: sha1 hex of `JSON.stringify([region ?? "",
  query.trim().toLowerCase(), (near ?? "").trim().toLowerCase(), naics
  sorted and joined by ",", direction ?? "auto"])`. Server-only; the page
  never computes it. Region is in it so a CO and a CT search with the same
  words don't overwrite each other.
- After `buildResult` succeeds: `mkdir -p` the dir (mode 0o700; the files
  hold individuals' records as filed) and write two files, each via a temp
  name then rename: `<id>.json` = `{ id, ranAt, params, map, result }`
  where `map` is the `translateEvent` line of the map event (the reading
  line and the "Before you call" caveats live there, not in `result`), and
  `<id>.csv` = `leadsToCsv(ranked, existenceIds)` (about 1 KB per lead;
  full Lead objects would be 2–4 MB per search). Then prune: keep the 20
  newest `.json` by mtime and delete their pairs. A write failure is logged
  to stderr and never fails the search.
- `GET /api/history` → `200 []` when `historyDir` is undefined. Otherwise
  newest first by mtime, only names matching `/^[a-f0-9]{40}\.json$/`:
  `[{ id, query, near, naics, direction, region, ranAt, businesses:
  result.sheet.businesses }]`; a file that fails to parse is skipped.
- `GET /api/history/:id` → id must match `/^[a-f0-9]{40}$/` (400 otherwise;
  the path is built only from the validated id). 404 if missing. A pure
  read: returns `{ params, ranAt, map, result }`, no server state changes.
- `GET /api/csv?id=<40 hex>` → serves `<id>.csv` from the dir (404 if
  missing; 400 on a bad id). Without `id` it behaves as today (`last`).
- No delete endpoint; pruning is the only removal.
Tests (`tests/web/server.test.ts`, temp dir per test): a search writes the
pair and `/api/history` lists it; `/api/history/:id` returns the stored
result and map; a fresh `createApp` with the same dir serves
`/api/csv?id=` from it; `/api/history` with no dir → `[]`; a bad id → 400;
a missing id → 404; 21 searches with different queries → 20 pairs remain,
oldest gone. `SECURITY.md` Threat 8: one paragraph (local files under the
user's home, 0o700, id validated, no path from input, contains whatever
the sheet showed), changelog v3.8. README line ~69 ("saved searches are
stored in your browser"): add one sentence on the server-side history.
`scripts/a11y/axe.ts`: pass a temp `historyDir` so the Recent box is
scanned.

### G2. Page: "Recent searches"
`apps/web/public/index.html`: a `#recent` box under `#saved`, same classes
(`saved-box`, eyebrow "Recent searches", `ul#recent-list`), hidden when
empty.
`apps/web/public/app.js`:
- `loadRecent()`: `GET /api/history`, render rows like `renderSaved`:
  query, then near / codes / direction / "ran <date>" / "<n> businesses";
  buttons **Open** and **Run again**. Called at startup and after every
  finished search.
- One `fillForm(params)`: query, near, naics (`string[]` joined with
  ", "), direction (`setDirection(params.direction || "auto")`), radius;
  Skip AI only when `!$("no-llm").disabled` (the server may have forced it
  on); region only when `#region-field` is visible; then `updateCodeBox()`.
- Open: `GET /api/history/:id`; `fillForm(params)`; `app.lastParams =
  readParams()` (one params shape everywhere; the stored one has an array
  for naics); `resetForRun(app.lastParams)`; `$("steps").hidden = true`;
  `app.map = map`; `$("csv").href = "/api/csv?id=" + id` (`resetForRun`
  puts it back to `/api/csv`); `showResult(result, { stored: ranAt })`.
- `showResult(result, opts = {})`: when `opts.stored`, skip the saved-search
  seen/lastRunAt update (opening is not a run); `#new-since` shows
  "Results from <date>. Run again to refresh." instead of the new-since
  sentence; the print head uses the stored date; `renderAbout` gets no
  `seconds` (no "Time 1 s" for an opened sheet).
- Run again: `fillForm(params)` then the submit path (so the F7 guard
  applies).
- Errors (server gone, 404) go to `toast`. Rendering uses `h()` /
  `textContent` only.
A11y: the two buttons carry `aria-label`s like the saved rows. `npm run
a11y` must stay clean.

### Left out, and why
- Abort on tab close (see F2).
- Env-selected API backend (M6b): declined.
- Vitest 5 / Vite 8 / vite-node 6 (audit L5): done as its own commit after
  Phase G. Vitest 5 treats Vite as a peer, and vite-node 6 needs Vite 8, so
  `vite` is now an explicit devDependency; `@types/node` moved to 22.
  `npm audit` is clean; tests, typecheck, CLI, loopback bind and a11y re-run.
- A delete button for recent searches: pruning at 20 is enough until it
  isn't.

---

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

### Phase E — audit fixes ✅
An independent audit of the branch found six issues; one commit each.
1. **Sentence vs chips.** `partitionLeads` (qualify `summary.ts`) is the one
   split (coded businesses / individuals' records / name-only) behind
   `sheetCounts`, the server's lists and the CLI. The sentence counts coded
   businesses ("35 businesses ... 17 are confirmed"), ends with "11
   individuals' records are listed separately", and notes a capped list.
   `sheetCounts` gains `businesses` and `listed`; confirmed, phones and
   within-radius are over businesses. Pinned in
   `tests/web/sheet-fixture.test.ts` (the fixture's individual is now
   matched, so the old count would fail).
2. **Dissolved businesses.** Live check of CO SoS (4ykn-tg5h): inactive names
   carry ", Dissolved October 23, 2026", ", Delinquent January 1, 2025",
   ", Colorado Authority Terminated/Relinquished <date>"; `entitystatus`
   says "Voluntarily Dissolved" etc. New manifest quirk `backfillInactive`
   (co_sos only) adds a second per-chunk query `entitystatus<>'Good
   Standing'`; the engine matches those rows on the bare name
   (`splitStatusSuffix`), locality guard kept, without merging them, and
   sets `registryCheck: "inactive"` + `registryStanding`. Pill "Dissolved
   Oct 2026" (amber), tag "The state registry lists it as <status>. Confirm
   it still operates." Brief, probe evidence and CLI say the status too.
   ACME TENT & CANVAS itself stays "Not on state registry at this address":
   its dissolved record is in Englewood, the PPP record in Denver.
3. **CLI individuals.** The CLI prints coded businesses, then
   "Individuals' records (shown as filed)" (no search or maps link), then a
   name-only count. CSV gains a last column `individual_record`.
4. **Recent filings "sew".** `recentNameMatch`: whole-word hit that isn't
   only a static collision (sew/sewer, car/care, pet/peter, bar/bare). Not
   done: dropping request words under 4 letters, because "sew" would then
   also drop the real sewing shops (no NAICS title carries "sewing"). The
   group stays collapsed and its heading is muted.
5. **Caveats** sit under a "Before you call" eyebrow (only when present)
   and print.
6. **Raw map answer.** On a parse failure `SearchOutcome.mapRawAnswer` holds
   the answer (2,000 chars, newlines kept, control characters replaced).
   CLI `--verbose` prints it; the web server logs it to stderr only. It
   never reaches the brief call (the engine strips it from the map
   result). SECURITY.md 3.7.

- API model tiers (`TIER_MODELS` in `qualify/src/llm/adapter.ts`) moved to
  `claude-haiku-5-5` (map) and `claude-sonnet-5-5` (brief). Only the API-key
  path uses them; the default `claude -p` path is unchanged.

### Next — the 20-call validation gate (decided 2026-10-27)
No new source (FMCSA, SAM.gov, business licenses, Places) and no new UI
work until the ADR 0017 call log is filled: 20 leads from real searches, at
least 6 per trust tone where possible, each called and marked Reached / No
answer / Not a fit in My calls, then the CSV exported and the reached rate
computed per `trust_tone_at_call`. The result goes into ADR 0017
"Validation". That number decides whether the next step is liveness data
(low reached rate on PPP-only leads), a softer amber label (no reached-rate
gap between tones), or a new coded source with phones (FMCSA).

### Left out, and why
- Live web contact lookup (Exa / Parallel): there's still no key; untested
  live, as in v5.
- Better individual detection (personal names filed with a business entity
  type): an engine change, not a UI one; recorded in ADR 0017.
- The transient unusable map answer: it couldn't be reproduced within the
  live-run budget. The raw answer is now logged when parsing fails (Phase
  E), so the next occurrence can be diagnosed.
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

# Security Threat Model — Registry Engine

Version: 3.14 (v12, v1-readiness review)
Last updated: 2026-10-30

The known threats, their mitigations, and where each mitigation lives in the
code. Update the code locations when code moves.

## Reporting a vulnerability

Report it privately through GitHub's private vulnerability reporting: open
the repo's Security tab and choose "Report a vulnerability". Please don't
open a public issue.

---

## Threat 1: Prompt injection through record data or the request

**Severity:** Medium. No web content is retrieved any more (that surface left
with v2's verify stage). The LLM now sees two untrusted inputs. One is the
user's request, in `map` and `brief`. The other is registry text inside
`brief`: business names, trade names and contacts, which anyone can file.

**Mitigations:**
1. **Data, not instructions.** Both system prompts tell the model to treat
   the request and lead data as data. The request is capped at 300 chars:
   map sends the request as text, capped at 300; brief sends it
   JSON-stringified.
   - `packages/qualify/src/verbs/map.ts` (`MAP_SYSTEM`), `packages/qualify/src/verbs/brief.ts` (`BRIEF_SYSTEM`, packing in `briefLeads`)
2. **Schema-constrained parsing.** The map output keeps only NAICS codes
   that exist in the official list (`isNaicsCode`), capped at 6. Keywords
   are lowercased, stripped to `[a-z0-9 ]`, filtered against stopwords and
   capped. Unknown keys are dropped. Brief output keeps only `i`/`brief`/
   `opener`, with each string word-clamped.
   - `parseMapResponse` in `map.ts`, `parseBriefResponse` in `brief.ts`
3. **No side effects from model output.** The model's codes and keywords
   only select read-only public queries. Ranking is arithmetic in code, and
   the model never scores leads.
4. **Budget.** At most 2 calls per search. The adapter's call counter throws
   `LlmCallBudgetError`, so a loop can't run up calls.
   - `packages/qualify/src/llm/adapter.ts`
5. **Minimal data to the model.** Officers, agents and addresses are never
   sent to the LLM.
6. **Rejected map answers are logged, not reused.** When `parseMapResponse`
   rejects the model's answer, the raw text is clipped to 2,000 chars with
   control characters (terminal escapes) replaced (`rawAnswerForLog`) and
   travels only as `SearchOutcome.mapRawAnswer`: the engine strips it from
   the map result before the brief call. The web server writes it to stderr
   only when `REGISTRY_ENGINE_DEBUG=1` (otherwise only its length), never into the
   NDJSON stream or the page. It never feeds a prompt or a query.
   - `mapQuery` in `map.ts`, `search` in `engine.ts`, `handleSearch` in `apps/web/src/server.ts`
7. **No tools for the headless model.** `claude -p` runs with `--tools ""`
   and `--strict-mcp-config`, so injected request or registry text can't
   trigger tool use.
   - `packages/qualify/src/llm/claudeCodeBackend.ts`

---

## Threat 2: Query injection into government APIs

**Severity:** Medium. LLM-derived and user-derived values reach external
queries.

- **SoQL (Socrata).** Keywords, cities and names are interpolated into
  `LIKE` clauses. `soqlSafeLiteral` strips quotes, `%` and `_`, uppercases,
  and collapses whitespace. Keywords under 3 chars are dropped, and there are
  at most 8.
  - `packages/registry-core/src/drivers/socrata.ts`
- **Formation-date filter (recent filings).** The `since` literal is built from
  the engine clock and validated as `YYYY-MM-DD` before it is interpolated
  into SoQL; keywords still go through `soqlSafeLiteral`.
  - `SocrataDriver.fetchRecent` in `packages/registry-core/src/drivers/socrata.ts`
- **EPA ECHO.** Only codes matching `/^\d{3,6}$/` are sent (and the map has
  already validated them against the NAICS list). All parameters go through
  `URLSearchParams`.
  - `packages/registry-core/src/drivers/echo.ts`
- **Shard paths.** `repo:` shard files are read from disk at
  `<endpoint>/<region>[/<sector>].json`. Sector is two digits taken from
  validated codes. Region must match a strict region-code pattern, so a
  caller can't traverse out of the shard directory. The web server checks
  `region` against the manifest (`parseSearchParams`).
  - `packages/registry-core/src/drivers/staticShard.ts`

All endpoints are read-only, so the worst case is a malformed query, not
data damage.

---

## Threat 3: CSV injection

**Severity:** Low. The web app's `/api/csv` and My calls export write
registry-derived text that users open in spreadsheets.

**Mitigation:** every cell is double-quoted with embedded quotes doubled. A
cell starting with `=`, `+`, `-`, `@`, tab or CR gets a leading `'`.
- `packages/qualify/src/csv.ts`, tested in `tests/qualify/csv.test.ts`
- The browser-side My calls export uses the same rules (`csvCell` in
  `apps/web/public/app.js`).

---

## Threat 4: Rate limits and IP bans

**Severity:** Low–Medium.

1. Concurrency limiters on every external source: Socrata 4, ECHO 2, DNS
   probes 4.
2. Jittered exponential backoff on 429/5xx (`fetchWithRetry`). Network
   failures (no response: refused, DNS, timeout) are retried once, not with
   the full backoff budget. Each request attempt has a 20 s deadline (DNS
   probe 5 s); Retry-After is capped at 30 s.
3. An optional Socrata app token sent as `X-App-Token`.
   Socrata page responses (200 only) are cached in memory for 15 minutes, up
   to 200 entries, so a repeated search doesn't repeat its requests.
4. Bulk-only sources (PPP) are served from local shards, never queried per
   search.
5. The registry name lookup sends at most 80 name patterns per search by
   default. "Check all" (web button) lifts that cap: it
   sends `ceil(names/25)` requests (×2 with `backfillInactive`), plus
   pagination past 200 rows per chunk, at concurrency 4 under the 20 s
   deadline. It is a full search the user asks for, through the same
   single-search lock.
- `packages/registry-core/src/util/http.ts`

---

## Threat 5: Privacy posture

**Severity:** Reputational.

- Contacts come from two places. One is what a registry publishes, plus a
  pattern email on a published domain with MX, always marked UNVERIFIED. The
  other is what a business published about itself on the web, found by
  searching the business name (ADR 0016), always labeled "verify" with its
  source. Nothing is guessed from names (ADR 0013).
- **Individuals.** PPP records include sole proprietors, and the Colorado
  farm-products financing list names individual farm debtors. These records
  are public by statute (SBA FOIA release; Food Security Act central filing,
  which exists so buyers can check liens). They are shown exactly as filed.
  The engine never looks up personal phones, emails or home addresses for
  them.
- Officers and agents are displayed in the web app but never sent to the LLM.
- **PACA emails.** The committed PACA shards keep the filed phone and website
  and drop the filed email. About 665 of them were personal mailboxes, and a
  bulk file in a public repo is a harvest target.

---

## Threat 6: Data-integrity honesty

**Severity:** Product. Presenting weak evidence as strong misleads users.

Every limitation below is surfaced in the output, not hidden:
1. **Industry code ≠ capability.** A code says what a business is, not
   whether it can take a given job. The brief prompt requires saying so.
2. **PPP is a 2020–21 snapshot.** Standing is tri-state and never inferred
   from a missing join alone: "On state registry" (joined a registry
   record), "Not on state registry" (its name was really sent to the
   registry lookup and nothing joined), "Not checked against registry"
   (beyond the names looked up this search, or no lookup ran). The engine
   replicates the driver's dedupe-and-cap to know who was checked. A fourth
   case, "inactive": the registry has the name at a compatible locality but
   not in good standing (Colorado appends ", Dissolved <date>" to the name);
   the lead shows the registry's status ("Dissolved Oct 2026"), never "not
   found", and never counts as confirmed. Opt-in per source
   (`quirks.backfillInactive`); the extra SoQL clause uses the manifest's own
   `statusValue`, no user or LLM input.
   - `planBackfill` and `registryCheck` in `packages/qualify/src/engine.ts`;
     labels in `apps/web/public/labels.js`, pinned by `tests/web/labels.test.ts`
3. **Capped fetches** are flagged (`fetched.capped`) and shown as "500+
   (capped)", never as a full count.
4. **Buyer leads fit by industry**, never by confirmed demand. A static
   caveat is attached to every sell-direction search.
5. **Name matches without a code** never enter the headline count or the
   main list; the web app shows them in a collapsed "Name matches only"
   group.
6. Without a web lookup the sheet makes no website claim; every business
   lead keeps a search link.
7. **Registered agent ≠ contact person.** SoS agent fields are often law
   firms or agent services. The web app labels them "Agent/principals".
8. **Name merges** require compatible locality (same zip or city), so
   same-named businesses in different towns stay separate.

---

## Threat 7: Web contact lookup (Exa / Parallel)

**Severity:** Medium. Third-party web pages now flow into results (ADR 0016).

**Mitigations:**
1. **Web text never reaches the LLM.** `extractContact` pattern-extracts
   only a website origin, a US phone and an email. The brief's packed lead
   line carries only those strings, never page text. The provider `summary`
   feature (which is model-generated) is not requested.
   - `packages/qualify/src/verbs/contacts.ts`, `packages/qualify/src/verbs/brief.ts`
2. **Wrong-business guard.** A page counts only if it matches the business
   name (≥60% of distinctive tokens) *and* its city or ZIP. Directory hosts
   are never taken as the website.
3. **Individuals are not searched.** PPP sole-proprietor or self-employed
   records and "LAST, FIRST" names are skipped (`isLikelyIndividual`).
4. **Cost and abuse.** Lookups run for the top N leads only, at concurrency
   3, with a 20 s timeout. Results are cached 30 days and failures aren't
   cached. API keys come from env vars only and are never logged.
5. **Provenance.** Every found value keeps its source URLs and is labeled
   "verify".

---

## Threat 8: Local web app (`apps/web`)

**Severity:** Medium. A local server that can spend LLM and web-search
credits is a target for other websites open in the same browser.

**Mitigations:**
1. Binds to 127.0.0.1 only.
2. **DNS-rebinding / cross-site guard.** Every request must carry
   `Host: localhost:<port>` or `127.0.0.1:<port>`, or it gets a 403. Searches
   require `Content-Type: application/json`, which forces a CORS preflight,
   and the server sends no CORS headers, so cross-origin pages can't trigger
   a search.
3. One search at a time (429 otherwise), with a 10 KB body cap and
   validated, length-capped fields. A closed tab cancels its search (abort
   signal through the engine, drivers, `fetchWithRetry`, the DNS and contact
   requests and the LLM call, which kills the `claude -p` child), so an
   abandoned search stops spending credits and frees the slot. An oversized body gets 413 with
   `Connection: close` as soon as the declared or streamed size passes the cap,
   and the socket is closed.
4. **XSS.** All registry and web strings are rendered with `textContent`;
   `innerHTML` is never used with data. A strict CSP allows `'self'` only,
   with no inline script. Website links must parse as http(s), and `tel:` /
   `mailto:` values are sanitized.
5. Static files come from an exact whitelist, so no path is built from the
   URL.
6. **Search history.** Each finished search is kept as `<id>.json` and
   `<id>.csv` under the user's home (`~/.cache/registry-engine/searches`,
   created with mode 0o700), the newest 20 only. The files contain whatever
   the sheet showed, including individuals' records as filed. The id is a
   server-computed SHA-1; `/api/history/:id` and `/api/csv?id=` accept only
   `/^[a-f0-9]{40}$/` (400 otherwise), and no path is built from any other
   input. Opening a stored search is a pure read; there is no delete endpoint.
7. **Credentials.** Keys (`ANTHROPIC_API_KEY`, `EXA_API_KEY`,
   `PARALLEL_API_KEY`) are read from the process environment only (never
   from a request, a file or the page), held inside the backend closures,
   never written to history or logs. API error text is reduced to status and
   error type before it reaches the page or history. `/api/status` exposes
   only which billing path is active (`llmBilling`). Other error text sent to
   the page or history has home-directory paths replaced with `~` and is
   clipped to 300 chars (`forPage`).
8. **No API token (accepted risk).** The server takes no token, so any local
   process can start searches that spend the user's AI and web-search credits.
   Not mitigated: such a process can already read the user's environment or
   .env keys or run `claude` as the user, so a token would add no protection
   while breaking the documented curl usage. Other websites remain blocked by
   items 1 and 2.
- `apps/web/src/server.ts`, `apps/web/src/main.ts`, `apps/web/public/app.js`,
  `packages/qualify/src/llm/fromEnv.ts`, `packages/qualify/src/llm/adapter.ts`

---

## Changelog

- v1.0 (2026-07-07, Phase 0): Initial threat model.
- v1.4 (2026-07-07, Phase 4): Prompt-injection test suite; UCC fuzzy-match
  warning; digest CLI.
- v2.0 (2026-07-08, distillation): Query-driven pipeline; added SoQL
  injection threat.
- v2.1 (2026-07-18): Artifact app removed (ADR 0012); UI-only surfaces
  retired.
- v3.0 (2026-10-22, v5 / ADR 0015): Rewritten for the current code. The
  web-content injection surface is gone, while the request and registry text
  remain as injection surfaces. Added the ECHO URL and shard-path surfaces.
  CSV export is live again in the CLI. Added individuals in PPP and
  farm-financing records to the privacy policy, plus new integrity
  disclosures. Stale code pointers fixed (`soqlSafeLiteral` lives in
  `drivers/socrata.ts`; v2 `pipeline/verify.ts` no longer exists).
- v3.1 (2026-10-22, ADR 0016): Added Threat 7 (web contact lookup: no web
  text to the LLM, name+place match guard, individuals never searched,
  provenance) and Threat 8 (local web app: localhost bind, Host check, JSON
  content-type, one search at a time, textContent-only rendering, CSP).
  Privacy now allows contacts a business published about itself on the web.
- v3.2 (2026-10-22, Phase 6 audit): Fixed the CSV code pointer
  (`packages/qualify/src/csv.ts`) and listed the browser-side export.
  Individuals' records no longer get a name-search link, and their names are
  withheld from the LLM brief.
- v3.3 (2026-10-27, Phase 7c): recent-filings query (fetchRecent); date literal validated.
- v3.4 (2026-10-27): claude -p runs with no tools and no MCP servers; per-search token usage reported.
- v3.5 (2026-10-27, v6 Phase A / ADR 0017): tri-state registry standing, capped-fetch
  flag, name-only matches out of the headline. Individuals' records get `mapsUrl: null`
  and `searchUrl: null` from the server (`leadView` in `apps/web/src/server.ts`), and
  the web app lists them in a collapsed group. Openers no longer quote NAICS titles.
- v3.6 (2026-10-27, v6 Phase D): My calls export (was "my list") keeps the CSV rules and adds
  the trust label at call time. The accessibility check (`scripts/a11y/axe.ts`) runs the real
  server against a fictional fixture search, with no network and no AI.
- v3.7 (2026-10-27, v6 Phase E audit fixes): rejected map answers are kept for diagnosis
  only (Threat 1, item 6). Registry standing gains "inactive" (dissolved, delinquent),
  opt-in per source via `quirks.backfillInactive`; its extra SoQL clause uses only the
  manifest's `statusValue` (Threat 6, item 2). CSV adds `individual_record`.
- v3.8 (2026-10-27, v7 Phase F audit fixes): each request attempt has a 20 s deadline
  (DNS probe 5 s) and Retry-After is capped at 30 s (Threat 4). Threat 1 wording: map
  sends the request as text capped at 300; brief sends it JSON-stringified. The web app
  keeps the 20 newest searches on disk, mode 0o700, ids validated (Threat 8, item 6).
- v3.9 (2026-10-27, v7b): "check all" registry name lookup (Threat 4, item 5):
  `maxNames` override in `SocrataDriver.fetchByNames`, `backfillAll` in the engine.
  Threat 6 item 6: no website claim without a web lookup; `--hidden` removed.
- v3.10 (2026-10-28, v8 / ADR 0018): bring your own keys, env only. `llmBackendFromEnv`
  (`packages/qualify/src/llm/fromEnv.ts`) picks the Anthropic API when `ANTHROPIC_API_KEY`
  is set, else `claude -p`; API errors carry status and error type only (Threat 8, item 7).
- v3.11 (2026-10-28, v9): CLI removed; HTTP API documented.
- v3.12 (2026-10-29, v10): reporting section; PACA emails not committed; `forPage`
  strips home-directory paths from error text; 413 closes the connection; raw AI
  answer logged only with `REGISTRY_ENGINE_DEBUG=1`; no-token accepted risk.
- v3.13 (2026-10-29, v11): network failures are retried once; 429/5xx keep the
  backoff (Threat 4, item 2).
- v3.14 (2026-10-30, v12 Batch A): a closed browser tab aborts its search (signal
  threaded through `search`, `fetchWithRetry`, probe, contact lookup and both LLM
  backends; an abort is never retried; Threat 8, item 3). Socrata pages are cached
  for 15 minutes (Threat 4, item 3). `/api/search` accepts an empty query when `naics`
  holds a valid code (the query becomes the code titles).

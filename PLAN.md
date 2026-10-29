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
    - License: the root `LICENSE-MIT` covers the whole repo. Add
      `"license": "MIT"` to the root `package.json` and to qualify, cli and
      web package.json; one README line "MIT, see LICENSE-MIT"; CLAUDE.md
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

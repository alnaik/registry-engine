# Registry Engine — v5 Handoff (2026-10-26)

Repo: `/Users/fcolty/dev/projects/registry-engine` · branch `v5-activity-coded`
(HEAD includes phases 1–6 plus the Phase 7/8 plan; **not pushed**) · remote
`git@github.com:alnaik/registry-engine.git`.

> **Update 2026-10-27:** Phases 7 (7a–7d) and 8 are done and committed.
> PLAN.md has the results, the fixes (F1–F7), and what's still open. The
> user asked for the branch to be pushed, and it has been pushed to
> `origin/v5-activity-coded`. That was a one-time instruction; the rule
> below about pushing still applies by default. Tests: 27 files, 298 tests,
> green; typecheck clean. The sections below are the original plan for
> phases 7–8, kept for reference.

## Paste this into the new chat

> Read `docs/handoffs/v5-handoff.md`, then `PLAN.md`. Build Phase 7 (7a → 7d)
> under the PLAN.md protocol: one spec per feature, sent to the `coder`
> subagent. Re-run `npm test` and `npm run typecheck` yourself before each
> commit. Then do Phase 8, the web app test pass, using the checklist in the
> handoff. Don't push.

## Working rules
- **Orchestration protocol (PLAN.md).** You plan, write specs, review and
  own git. The `coder` subagent (`.claude/agents/coder.md`) implements
  exactly one spec or returns a DEVIATION REQUEST. Keep specs in the
  session scratchpad, not the repo.
- **Never push or open PRs.** Give the user the command instead.
- **No Co-Authored-By trailers** in commit messages (user decision,
  2026-10-27). They were stripped from every unpushed commit on this branch.
- **Commit timing is your call:** commit after each verified phase or
  feature. `CLAUDE.md` and `docs/handoffs/` are tracked now, so keep them
  current in the same commits.
- **"Deeper, not bigger"** (the user's direction). Don't add states or
  sources to chase coverage; improve recall and precision on what exists. No
  overengineering: each Phase 7 feature should be a small diff.
- **Privacy is fixed:**
  - Never search the web for individuals' records.
  - Contacts are only what a registry publishes, or what a business
    published about itself (labeled "verify", with the source).
  - Web text never goes to the LLM.
  - Never put data into `innerHTML`.
- **LLM budget:** at most 2 calls per search, none per lead. The LLM path
  shells out to `claude -p`, which spends the user's subscription, so keep
  live LLM test runs to a handful.

## What the product is (v5)
A small business owner types what they need or what they sell, plus a ZIP or
town. They get local businesses that search engines under-show, from public
records carrying an industry code (NAICS):

- SBA PPP loan data (CO, 153k businesses, 2020–21 snapshot, in `shards/ppp`)
- EPA ECHO (live)
- the CO farm-products financing list (live)
- USDA PACA (shards)
- the CO/CT/NY Secretary of State registries, for identity and standing

Results:
- The whole state is fetched, then grouped by distance from the center.
- Coded matches come first and sort by category fit inside each distance
  band; name-only matches come last.
- Each lead is a call sheet with a brief and an opener.

Surfaces: the local web app (`npm start`, http://localhost:4317) and the CLI.
Optional web contact lookup with `EXA_API_KEY` or `PARALLEL_API_KEY`. **It
has never run against the live APIs** because no key has been available.

Read for the reasoning: ADR 0015 (activity-coded discovery and its Census
validation), ADR 0016 (location, web contacts, local app), and `SECURITY.md`
v3.2.

## State at handoff
- Tests and typecheck: 26 files, 275 tests, all green; strict typecheck
  clean (verified 2026-10-22 on the Phase 6 commit).
- Phase 6 audit (Fable 5.1, medium): every confirmed finding fixed. Details
  are under Phase 6 in PLAN.md.
- Known gaps are listed in PLAN.md. The ones that touch Phase 7:
  - **`Entity.id` isn't stable across runs.** It's the id of the first source
    that merged, and whether the state registry joins depends on the capped
    backfill (80 names). Saved searches (7b) must key on normalized name +
    ZIP5. Phase 8 should check whether the existing tracker
    (`localStorage` key `TRACKER_PREFIX + id` in `apps/web/public/app.js`)
    loses a lead's notes on a re-run for the same reason. If it does, rekey
    it the same way.
  - PPP is a fixed snapshot, so "new since last time" (7b) can only come from
    live sources.

## Phase 7 — the features (full specs in PLAN.md)
1. **7a Supplier/buyer switch.** Web toggle plus `--direction`. It
   overrides `SELL_PATTERN` and the map's guess. Today, buyer searches
   without the AI step need codes, and the direction is inferred from
   wording (fixed in Phase 6, but still a guess).
   - Code: `packages/qualify/src/verbs/map.ts` (`SELL_PATTERN`, line ~172;
     `MAP_SYSTEM`), `engine.ts` (`SearchConfig`), `apps/web/src/server.ts`
     (body validation), `app.js` (`renderInterp` already prints
     "Looking for suppliers/buyers").
2. **7b Saved searches.** localStorage only, a "New since <date>" badge,
   and a stable lead key.
3. **7c New-business watch.** Registry entities formed in the last 90 days,
   near the center, matched on keywords. Formation-date fields, checked live
   on 2026-10-26:
   - CO `4ykn-tg5h`: `entityformdate`
   - CT `n7gp-d28j`: `date_registration` (some rows hold `0001-01-01`)
   - NY `n9v6-gdp6`: `initial_dos_filing_date`

   CT rows also carry `naics_code` as a title string (e.g. "Full-Service
   Restaurants") and a `business_email_address`. That's a possible coded
   source and a registry-published contact for CT; it's recorded here and
   not in scope unless the user wants it. Label all CO/NY matches as name
   matches.
4. **7d Distance view.** An inline SVG with rings and dots. It must keep the
   CSP strict (`'self'` only): no tile servers, no library.

## Phase 8 — web app test checklist
Start the app with `PORT=4318 npm start` in the background, run the checks
below, and stop it afterward.

**Browser driver.** `docs/handoffs/v5-tools/shoot.mjs` drives the Playwright
headless shell already installed at
`~/Library/Caches/ms-playwright/chromium_headless_shell-1248/` over CDP. It
uses Node's built-in WebSocket, so there's nothing to install. Usage:
`APP_URL=http://localhost:4318/ node docs/handoffs/v5-tools/shoot.mjs <outDir> 1280 "<query>" "<near>" [codes]`.
It saves screenshots and the page's text; put `outDir` in the scratchpad. The
`claude-in-chrome` skill is an alternative when the user's Chrome is
available.

**Checks:**
- [ ] Empty state at 1280 and 390 px: no horizontal scroll, readable
      controls.
- [ ] Supplier search with AI ("someone to sew 500 custom tote bags",
      Denver): codes 315210/314910; cut-and-sew and canvas shops near the
      top.
- [ ] Buyer search with AI ("who would buy my small-batch hot sauce",
      80302): specialty food, restaurants, grocers; the buyer caveat is
      shown.
- [ ] Skip AI + supplier ("produce supplier", Denver): static table
      codes.
- [ ] Skip AI + buyer: the "needs the AI step" empty state appears, and
      after 7a the toggle fixes it.
- [ ] Find codes helper: "metal fabrication" returns 332312; "canvas
      bag" returns 314910.
- [ ] Location three ways: ZIP, town, and none (no bands, and the "no
      center" note is shown).
- [ ] Unknown town ("near Atlantis") gives a clear message, not a crash.
- [ ] Bands in order; name-only group last; an individual's record shows
      "no web search offered".
- [ ] Tracker: set a status and a note, reload, re-run the same search;
      the note must still be there (see the `Entity.id` gap).
- [ ] CSV (all results) and "my list" export: open both in a spreadsheet,
      and check that a name starting with `=` is escaped.
- [ ] Print call sheet (print preview or a PDF via CDP
      `Page.printToPDF`).
- [ ] Errors:
  - a second search while one is running gets a 429 message;
  - `claude` missing or logged out gives a clear message;
  - the network off during an ECHO fetch degrades gracefully.
- [ ] Guards still hold (curl):
  - a foreign `Host` header gets 403;
  - a POST without JSON content-type is refused;
  - `HEAD /` returns 200.
- [ ] Contacts: if the user provides `EXA_API_KEY` or `PARALLEL_API_KEY`,
      run 1–2 searches. This is the first live test of `contacts.ts`; check
      that each found value's source page really is that business.
- [ ] After 7a–7d: each feature at both widths and in dark mode
      (`prefers-color-scheme` is supported in `app.css`).

## Commands
```bash
npm test && npm run typecheck
npm start                                   # web app, http://localhost:4317
npm run --workspace apps/cli start -- search "potato farm" --near=Alamosa --no-llm --leads=8
npm run --workspace apps/cli start -- codes metal fabrication
```
`node --experimental-strip-types` doesn't work (`.js` import suffixes). Use
the vite-node npm scripts.

## Gotchas
- The CO SoS status value `"Good Standing"` differs from trade names'
  `"GOOD"`.
- The government source misspells `jurisdictonofformation`, and the code
  uses that spelling on purpose.
- The Census CBP API now requires a key; use the bulk files (ADR 0015).
- A missing registry join is usually a fetch-coverage or locality-guard
  issue, not a `mergeEntities` bug. Example: ACME TENT & CANVAS has PPP in
  Denver 80203 but SoS in Englewood 80110.
- The map's automatic NAICS index matcher was tried and dropped as too
  noisy ("welding shop" mapped to leather goods). Codes come from the LLM,
  the static table, `--naics`, or the `codes` helper.
- PPP data adds 42 MB to the repo. Mention it before the user opens a PR.

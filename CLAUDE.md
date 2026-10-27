# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A small business owner types what they need ("someone to sew 500 tote bags
near Denver") or what they sell ("who would buy my hot sauce in Boulder") and
gets real local businesses that search engines under-show, as an actionable
call sheet. Thesis (ADR 0015): businesses leave records they can't opt out of
(loans, permits, inspections, licenses, crop liens), and those records carry
an **industry code (NAICS)** filed by a regulator or lender. Discovery is
**routing on NAICS codes**, never searching names or web presence, and never
per-candidate LLM verification.

## Commands

```bash
npm install
npm test                                                         # full suite (hermetic: stub drivers / stubbed fetch)
npx vitest run tests/registry-core/zero-code-state.test.ts       # single test file
npm run test:watch
npm run typecheck                                                # strict TS across the workspace

# Web app (localhost:4317; vite-node, no build) — the customer-facing surface
npm start

# CLI (no build step — vite-node)
npm run --workspace apps/cli start -- search "I need someone to sew tote bags near Denver"
npm run --workspace apps/cli start -- search "metal fabrication in denver" --no-llm --naics=332
npm run --workspace apps/cli start -- codes canvas bag           # look up NAICS codes

# Data rebuilds (Python 3 stdlib, always run with -I)
python3 -I scripts/data/build_naics.py
python3 -I scripts/data/build_ppp_shards.py --state CO --out shards/ppp <ppp csvs…>
```

CLI flags: `--near=<ZIP|town>` distance center · `--radius=<mi>` ·
`--no-contacts` · `--naics=<codes>` override ·
`--direction=buy|sell` (buy = find suppliers, sell = find buyers; overrides the guess) · `--hidden` only leads with no website
in any record · `--csv=<path>` all ranked leads · `--leads=<n>` (default 12)
· `--verbose` evidence · `--region=<US-XX>` · `--limit=<n>` · `--model=<m>`
· `--shards=<url>`. The default path makes 2 LLM calls via the Claude Code
CLI (`claude -p`). `--no-llm` uses a static table for supplier searches;
buyer searches then need `--naics`.

`node --experimental-strip-types apps/cli/src/index.ts` does **not** work —
`.js`-suffixed ESM imports (NodeNext) can't be resolved by strip-types. Always
use `vite-node` (the npm script).

## Architecture

Five verbs over a query-driven pipeline (`packages/qualify/src/engine.ts`,
`search()`):

```
map(query)    1 cheap LLM call → NAICS codes of the LEADS (direction-aware:
              need → suppliers' codes, sell → buyers' codes), validated by
              isNaicsCode. No LLM: static table / --naics override.
route(intent) pure manifest lookup: geo ∩ NAICS prefix (naicsRelated). 0 tokens.
fetch(...)    drivers fetch + normalize to Entity; merge on normalized name
              only when locality is compatible; existence backfill by name. 0 tokens.
              recent filings: existence entities formed in the last 90 days near the center, name-matched (fetchRecent). 0 tokens.
probe(...)    published domains checked A+MX via DNS-over-HTTPS. 0 tokens.
contacts(...) top N leads: one web search each (Exa/Parallel, env key),
              deterministic extraction + provenance, 30-day cache, never for
              individuals' records, web text never sent to the LLM (ADR 0016).
brief(...)    1 best-tier LLM call over the top N: why it fits, verified vs.
              inferred, how to reach, opener. Template briefs otherwise.
```

Location (ADR 0016): a town in the request or `near` is the *center*, not a
filter. The whole region is fetched, and coded matches are sorted into
distance bands (Census ZIP/place centroids in `registry-core/src/geo/`),
with name-only matches in one trailing group.

Hard budget: **≤2 LLM calls per search, zero per-candidate calls**
(`MAX_LLM_CALLS_PER_SEARCH` in `engine.ts`), enforced by the adapter's call
counter and by tests.

**Ranking** (`scoreEntity` in `brief.ts`) = code fit (respects the map's
best-first order) + keyword match + independent sources + state standing +
recency. **Contacts and web presence add nothing**. That's deliberate, since
the target population has no web footprint. Web presence is a label
(`verified | unresolved | none`), and `--hidden` filters on it. Don't
reintroduce web/contact points.

Package layout:

```
packages/registry-core/   MIT. Entity, NAICS lookup (naics.ts + naics2017.json), drivers, manifest, route().
packages/qualify/         LLM adapter (tiered), map/probe/brief verbs, engine.
apps/web/                 Local web app: server.ts (localhost, Host check, NDJSON stream) + public/ vanilla UI.
apps/cli/                 CLI: lead cards, CSV export, codes lookup.
shards/                   ppp/US-CO/<sector>.json (153k businesses), paca/<region>.json.
scripts/data/             Rebuild NAICS and PPP data from public sources.
```

### The manifest is the extension point

Adding a source or a state is a JSON entry in
`packages/registry-core/src/sources/manifest.json`: plane, coverage
(`geo` ∩ `naics`, `["*"]` = any), endpoint, field map, quirks. **Zero code
changes required**, guaranteed by `tests/registry-core/zero-code-state.test.ts`.
`SourceSpec` (`driver.ts`) is the schema. Canonical field-map keys: `id`,
`name`, `status`, `street`, `city`, `state`, `zip`, `address_line`, `naics`,
`employees`, `date`, `formedDate`, `officer*`. Common quirks: `defaultNaics`,
`evidenceFields`, `keywordFields`, `statusValue` (optional), `shardBy:
"naics2"`, `shardRegions`, `cities`.

Sources: `co_sos`/`ct_sos`/`ny_dos` (existence: identity + standing),
`ppp` (static_shard, CO, every industry, 2020–21 snapshot), `epa_echo`
(live, US, regulated facilities + last inspection), `co_farm_products`
(socrata, growers + crops + lenders), `paca` (static_shard, produce dealers
with phones).

Drivers: `socrata`, `echo`, `static_shard` (`repo:` endpoints read from disk;
http(s) fetched; optional per-NAICS-sector files). Existence backfill
(`Driver.fetchByNames`, ADR 0013) looks up category-plane entities by name in
the existence registry. A missing join is usually a fetch-coverage gap, not
a `mergeEntities` bug.

### Delivery surface

The local web app (`apps/web`) plus the CLI. The chat-artifact app was
removed (ADR 0012) because the claude.ai artifact sandbox blocks outbound
fetch (ADR 0011). The web app works because its server runs locally. UI rule:
never put data into `innerHTML`; build DOM with `textContent`.

### Privacy / data policy

Public records only, plus contacts a business published about itself on the
web, found by name search, labeled "verify" with sources (ADR 0016). Never
search for individuals. Pattern email on a published domain with MX is
always UNVERIFIED. Leads
without a website get a prefilled search link, never a guessed domain. PPP
and farm-financing records name individuals: show as filed, never enrich.
Briefs must disclose what is inferred versus verified (code ≠ capability, PPP
is a snapshot, buyer fit is by industry). Don't weaken this in `probe.ts`
or `brief.ts`.

### Threat model

`SECURITY.md`: prompt injection via the request and registry text, query
injection (SoQL via `soqlSafeLiteral`, ECHO params, shard paths), CSV
injection (`packages/qualify/src/csv.ts`), rate limits, privacy, integrity
disclosures. Read it before changing `llm/adapter.ts`, `util/http.ts`,
`map.ts`/`brief.ts` parsing, or anything that builds a query or path from
LLM/user input, and update its changelog when mitigation code moves.

## Working conventions in this repo

Plan-driven, two-role protocol described in `PLAN.md` (read it first; it
holds the current phase and open items):

- The orchestrator owns git and writes a spec per phase. The `coder`
  subagent (`.claude/agents/coder.md`) implements exactly that spec and
  returns a **DEVIATION REQUEST** instead of improvising.
- The coder runs `npm test` and `npm run typecheck` before reporting, and
  reports failures verbatim.
- Decisions are ADRs in `docs/decisions/`. 0015 covers activity-coded
  discovery and its validation numbers vs Census CBP. 0016 covers location,
  web contacts and the local web app.

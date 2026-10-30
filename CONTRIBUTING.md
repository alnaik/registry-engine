# Contributing

Registry Engine finds local businesses from public records. Read
[`CLAUDE.md`](CLAUDE.md) first: it has the architecture and the rules a change
has to keep (two AI calls per search at most, routing on industry codes, no
web or contact points in ranking).

## Setup

Node 24 is what the code is tested on (`.nvmrc`); 20.19 and later runs it.

```bash
npm install
npm start          # http://localhost:4317
```

## Before you open a pull request

```bash
npm test                 # hermetic: stub drivers, stubbed fetch, no network
npm run typecheck
npm run a11y             # axe-core over the app in headless Chromium
npm run smoke            # drives the app: search, CSV, history, error box
```

The two browser scripts use `CHROME` if set, else the newest Chromium in the
Playwright cache (`npx playwright install chromium-headless-shell`).

## Adding a state or a source

A source is an entry in
[`packages/registry-core/src/sources/manifest.json`](packages/registry-core/src/sources/manifest.json).
A Socrata registry, a static shard or EPA ECHO needs no code, and
[`tests/registry-core/zero-code-state.test.ts`](tests/registry-core/zero-code-state.test.ts)
keeps it that way. Steps and the town-name data are under "Add a state or a
source" in the [README](README.md#add-a-state-or-a-source).

## Data rebuilds

Python 3 standard library only, always run with `-I`:

```bash
python3 -I scripts/data/build_naics.py
python3 -I scripts/data/build_ppp_shards.py --state CO --out shards/ppp <ppp csvs…>
python3 -I scripts/data/build_geo.py --states CO,CT,NY
```

## How changes are planned

Work is plan-driven. [`PLAN.md`](PLAN.md) holds the current phase and its
spec; the `coder` agent in `.claude/agents/coder.md` implements exactly one
spec and raises a deviation request when the spec doesn't fit. Decisions are
recorded as ADRs in [`docs/decisions/`](docs/decisions/).

## Security-sensitive changes

Read [`SECURITY.md`](SECURITY.md) before changing anything that builds a
query, a URL or a file path from a request or from LLM output (`llm/adapter.ts`,
`util/http.ts`, `map.ts`, `brief.ts`, the drivers, `apps/web/src/server.ts`),
and update its changelog when a mitigation moves.

## The UI

Never put data into `innerHTML`; build DOM with `textContent`. Trust and
status wording lives in `apps/web/public/labels.js` and is pinned to its
predicate by `tests/web/labels.test.ts`: new wording goes there, with a test.

## No personal data in the repo

Shards and test fixtures hold public records about businesses and nothing
about private people: no personal email addresses (a company's own domain is
fine) and no invented-but-real-looking people. A scan test,
[`tests/data/no-personal-emails.test.ts`](tests/data/no-personal-emails.test.ts),
covers `shards/` and `tests/fixtures/`; fixtures use made-up names, addresses
and `555` phone numbers.

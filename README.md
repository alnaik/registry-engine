# Registry Engine

A pluggable multi-registry B2B lead finder. Government registries in, ranked
leads with contacts out.

## Quickstart

```bash
npm install
npm run --workspace apps/cli start -- search "produce supplier in denver" --no-llm
```

Runs in any terminal with Node 20+ via `vite-node` — no build step, no API
key. Drop `--no-llm` to enable the two LLM calls per search; that path shells
out to the Claude Code CLI (`claude -p`), so it needs Claude Code installed
and logged in. Flags: `--limit=<n>` per-source fetch cap (default 500) ·
`--leads=<n>` max briefed leads (default 12) · `--model=<m>` Claude model for
headless calls · `--shards=<url>` alternate shard host.

> Note: `node --experimental-strip-types apps/cli/src/index.ts` does **not**
> work — the source uses `.js`-suffixed ESM imports, which strip-types can't
> resolve back to `.ts` files. Use the `vite-node` command above.

**Status:** v3 "socket" — query-driven pipeline over a declarative source
manifest. Two plugs live: Colorado SoS (existence) and USDA PACA (produce
category + contacts).

## The thesis

Web search shows businesses that market themselves; registries enumerate
businesses that *legally exist* — and federal license registries say what a
business *does* with regulatory certainty. Category is therefore a **routing
problem**, not a verification problem: classify the query, look up which
registry natively carries that category, fetch, and join. No per-candidate
LLM verification.

## Five verbs, three planes

```
map(query)   1 cheap LLM call max — common queries resolve from a static
             table with ZERO calls → {categories, geo, direction} + caveats
route(intent) pure manifest lookup: category ∩ geo ∩ plane. 0 tokens.
fetch(...)   drivers pull the routed registries, normalize to a canonical
             Entity, merge on normalized name. 0 tokens.
probe(...)   contact discovery: published domains verified, else name-slug
             guesses checked A+MX via DNS-over-HTTPS. 0 tokens.
brief(...)   1 best-tier LLM call, batched over all ranked leads; must
             surface what registries can't verify. 0 calls if no backend.
```

Planes: **existence** (SoS registries) · **category** (federal license
registries: PACA today; FMCSA/SAM later) · **contact** (registry POC fields,
DNS/MX, pattern email).

Hard budget: **≤2 LLM calls per search, zero per-candidate calls** — enforced
by a call counter that throws, and by tests.

## Adding a source or a state

A manifest entry in `packages/registry-core/src/sources/manifest.json` —
plane, coverage (geo ∩ categories), endpoint, field map, quirks. **Zero code
changes**, guaranteed by `tests/registry-core/zero-code-state.test.ts`.

Drivers are few and generic: `socrata` (CO SoS; CT/WA/NY later), `rest`
(future), `static_shard` (registries browsers can't reach — recorded JSON
shards per region, e.g. `shards/paca/US-CO.json`; see `docs/data/paca.md`
for the recorded PACA protocol).

## Architecture

```
packages/registry-core/   MIT. Canonical Entity, drivers, manifest, route().
packages/qualify/         LLM adapter (tiered), map/probe/brief verbs, engine.
apps/cli/                 Validation harness (LLM via headless claude -p).
shards/                   Recorded region shards for static_shard sources.
```

## Development

```bash
npm install
npm test              # driver fixtures, route, verbs, E2E golden queries
npm run typecheck     # strict TS across the workspace
```

CLI harness: see Quickstart above.

## Delivery surface

The artifact app was removed in v4 because the claude.ai chat-artifact
sandbox blocks outbound fetch (ADR 0011); see
`docs/decisions/0012-remove-artifact-app.md`. The CLI harness is the
delivery surface.

## Privacy

Public records only. Probe results are name-derived guesses unless a contact
was published by the registry itself — evidence marks the difference, and
briefs must disclose what is inferred versus verified.

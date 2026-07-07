# Registry Engine

A registry-grounded local-business discovery and qualification tool.

**Status:** Phase 0 complete — scaffold, data verification, architecture docs.

## What it does

Web search and Google Maps show businesses that market themselves. Government registries enumerate businesses that *legally exist*. Registry Engine queries official state business registries (starting with Colorado's Secretary of State), lets you describe what you're looking for in plain English, and returns qualified, actionable results.

Works for finding both **customers** (seller mode) and **suppliers** (buyer mode) with the same engine.

## Key features (Phases 1–4)

- **Registry-grounded completeness** — coverage by law, not by web presence
- **Natural-language qualification** — arbitrary fit criteria, not fixed categories
- **Timing signals** — new filings, status transitions, new trade names
- **Dossiers** — one-page actionable brief per lead
- **Registry-exclusive analytics** — UCC supplier intelligence, market vitality, gap density
- **Negative-space filter** — entities with no web presence (invisible to Maps-based tools)
- **Zero cost to operator** — runs as a Claude Artifact using your own Claude subscription

## Privacy

Registry Engine queries public records only. It does not attempt to discover non-published personal contact information. Principal addresses are registered agent addresses in many cases — this is noted wherever addresses are displayed.

## Architecture

npm workspaces monorepo:

```
packages/registry-core/   — MIT. Data layer. No LLM code.
packages/qualify/         — Proprietary. LLM qualification pipeline.
packages/shared/          — Shared utilities (CSV export, formatting).
apps/artifact/            — The Claude Artifact (.jsx bundle).
apps/cli/                 — Dev harness and future digest backend.
```

See `docs/decisions/` for architectural decision records.
See `docs/states/` for data source documentation.

## Development

```bash
npm install
npm test          # run fixture sanity tests
```

## Adding a state

See `docs/states/README.md`.

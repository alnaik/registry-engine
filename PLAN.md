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

### Phase 1 — registry-core: NAICS routing + new sources
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

### Phase 2 — qualify + CLI: map, rank, call sheet
- `map`: LLM → validated NAICS codes for the *leads* (direction-aware);
  no-LLM fallback via the index matcher; `--naics` override; region words
  never become keywords.
- Ranking: fit + operating evidence; web presence is a label, not points.
- Brief: actionable (why, what's verified vs. not, how to reach, opener).
- CLI: compact lead cards, `--hidden`, `--csv=<path>`, `--verbose`, summary line.

### Phase 3 — docs + measured validation
- README, CLAUDE.md, SECURITY.md (new URL/SoQL surfaces, individuals' data).
- One recall check vs Census County Business Patterns (bulk file) for a
  manufacturing query, recorded in ADR 0015's follow-up section.

## Later (only if Phase 3 numbers justify it)
- Liveness for PPP-only leads in Denver: city business licenses (`s9wt-dsfz`).
- Relationship edges: UCC secured parties, PACA claims, federal subawards.
- FMCSA (trucking, has phones) and SAM.gov entity extract (has POCs).

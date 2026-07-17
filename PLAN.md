# v4 Plan — cleanup, multi-state socket, probe rework

Working branch: `v4-cleanup-and-states`. Orchestrated per the protocol below.

## Orchestration protocol (Fable plans, Sonnet codes)

- **Roles.** The Fable model is planner/orchestrator/reviewer and owns git.
  All code changes are implemented by the `coder` subagent
  (`.claude/agents/coder.md`, model: sonnet), which receives a written spec
  per phase.
- **Spec discipline.** The coder implements exactly the spec. Any needed
  change not covered by the spec is returned as a DEVIATION REQUEST and must
  be approved by the orchestrator before implementation. The coder never
  improvises.
- **Review.** The orchestrator diffs the result against the spec, re-runs
  `npm test` + `npm run typecheck` itself, and only then commits.
- **Context discipline.** No long runs: one phase (or less) per turn. Coding
  happens inside subagents so orchestrator context stays small. At each
  checkpoint: commit first, then the user runs `/compact` (compact is a
  user command — the orchestrator ends its turn and asks for it).
- **State.** Progress lives in the session task list and this file, both of
  which survive `/compact`. On resume, read PLAN.md before acting.

## Phases

### Phase 0 — README quickstart + orchestration setup ✅ (this checkpoint)
Verified CLI run instructions at the top of README (vite-node; the old
`--experimental-strip-types` command fails on `.js`-suffixed ESM imports).
`vite-node` promoted to an explicit root devDependency. This file and the
coder agent created.

### Phase 1 — remove the artifact app ✅ (this checkpoint)
The pasted-into-chat artifact is a dead end (ADR 0011: sandbox blocks all
outbound fetch). Remove `apps/artifact/`, `scripts/bundle-artifact.mjs`,
`dist/`, the root `bundle` script, and all references (README, SECURITY.md
stale component paths, comment-only mentions). `windowClaudeBackend()` in
`packages/qualify/src/llm/adapter.ts` needs care — it is the default backend
fallback in `createLlm`. Record the removal as ADR 0012; git history keeps
the code if a standalone search page is ever revisited (that page would need
a real API for the search agent — out of scope, deliberately deferred).

### Phase 2 — `--region` flag + manifest-driven regions
`SearchConfig.region` exists (`packages/qualify/src/engine.ts`) but the CLI
never sets it, and `map.ts` hardcodes `DEFAULT_REGION = "US-CO"` plus a
Colorado-only city list. Work: add `--region=US-XX` to the CLI; derive the
valid-region set (and a sensible default) from the manifest
(`coverage.geo` ∪ `quirks.shardRegions`); move city lists into manifest
quirks or drop city inference to a generic mechanism. Acceptance:
`zero-code-state.test.ts` still proves manifest-only state adds, and a
fictional state is reachable end-to-end via `--region`.

### Phase 3 — probe/web-check rework
Live-run findings (2026-07-17): DNS/MX **works** for registry-published
domains (multiple `A:yes MX:yes`); name-slug `.com` guesses essentially
never hit; and the `co_sos` existence cross-match failed for **every**
entity ("no co_sos match") — investigate the merge-on-normalized-name logic
first; that silent existence-join failure is the primary suspect for "the
whole check feels wasted." Then: keep DNS/MX for published domains, demote
or drop slug guessing (LLC/INC tokens are currently kept in slugs), and for
each lead without a verified domain emit a ready-to-open web-search URL in the
CLI/brief output — the manual post-list search flow.

### Phase 4 — more states in the socket
After Phase 2: add states where **both** planes have data — existence via a
Socrata SoS dataset (CT/WA/NY are the known candidates) and category via a
recorded PACA shard for that region (protocol: `docs/data/paca.md`), hosted
alongside `US-CO.json` on the gist. Manifest entries + shard files only;
zero code changes is the acceptance test. First step of the phase is a
data-availability survey to pick the states.

## Next iteration (v5) — new category planes

Access research (2026-07-17):

- **FMCSA — free.** QCMobile API (self-serve WebKey via Login.gov) for
  on-demand checks; daily "Entities with a USDOT Number" census + Licensing
  & Insurance bulk files (Socrata-hosted, so same driver family) for base
  ingestion. Zero cost.
- **SAM.gov — free.** Entity Management API (system account = 1,000
  req/day) + monthly public entity extract (first Sunday, CSV/.dat). Public
  tier excludes some sensitive/contact fields.
- **Customs (AMS bills of lading) — the only paid item.** Raw CBP feed is
  purchasable at production cost (19 CFR 103.31; ocean vessel only, call CBP
  for quote) but needs a homegrown AMS parser + entity resolution. Practical
  entry: ImportGenius USA tier ~$229–449/mo, cleaned + exportable. Panjiva
  is enterprise-priced; ImportYeti is free web search but no licensed API.
  Recommendation: start ImportGenius monthly, graduate to raw CBP only if
  the pipeline is worth owning.

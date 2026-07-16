# 0010 — v3 "socket" refactor: Phase 0 keep/delete/port inventory

Status: proposed (awaiting confirmation)
Date: 2026-07-15

Rule applied: code survives only if it sits on the path
**query → ranked lead with contact**. Deleted code dies completely; git
history is the archive.

Baseline at b763cf2: 45/45 tests pass, dist/artifact.jsx = 59kb.

## KEEP (moves with little or no change)

| File | Why it survives |
|---|---|
| `registry-core/src/util/http.ts` | Limiter, fetchWithRetry (429/5xx + jitter), buildSoqlUrl — the transport under every driver. |
| `registry-core/src/sources/colorado/search.ts` (core logic) | Server-side SoQL keyword search incl. `soqlSafeKeyword` injection guard, trade-name→entity-ID join, zip chunking, pagination. This IS the socrata driver's fetch path. |
| `registry-core/src/sources/colorado/tradeNames.ts` → `fetchTradeNamesForEntities` only | Trade names feed canonical `names[]` and evidence. |
| `registry-core/src/util/cache.ts` + `apps/artifact/src/storage.js` | KVCache / WindowStorageCache — caching probe + LLM results. |
| `apps/cli` incl. `claudeCodeBackend.ts` | The validation harness; rewired to the five verbs. Node-only, never bundled. |
| `scripts/bundle-artifact.mjs` | Single-file bundler + banned-imports check. Add a hard <100kb fail. |
| Test harness (vitest, fixtures dir, `fixture-sanity`, `http.test`) | Recorded-fixture pattern is exactly what Phase 2 drivers need. |

## PORT (survives as an idea, rewritten into the new shape)

| Source | Becomes |
|---|---|
| `colorado/entityFields.ts`, `tradeNameFields.ts` | Field maps inside the `co_sos` manifest entry (config, not code). Quirks preserved: `jurisdictonofformation` typo, `GOOD` vs `Good Standing`, dataset IDs `4ykn-tg5h` / `u7sb-g482`. |
| `colorado/normalize.ts` | Generic field-map-driven normalizer inside the socrata driver → canonical `Entity`. |
| `colorado/index.ts` (ColoradoRegistrySource class) | Dissolves into `driver:"socrata"` + manifest entry. Per-state classes are the thing v3 exists to kill. |
| `qualify/pipeline/intent.ts` | `map(query)`: same parse-hardening pattern (strip fences, sanitize lists, length caps, zero-LLM fallback), new output `{categories[], geo, direction}` + static category keyword table checked first. |
| `qualify/pipeline/brief.ts` → `assembleBrief` | Data assembly survives; becomes the input packer for the ONE batched `brief()` call (tier:best, ~150 words/lead cap). |
| `qualify/llm/LlmBackend.ts` + `budgeter.ts` | Collapse into the single `callLLM(prompt, {tier})` adapter. TokenBudgeter's token ceilings are replaced by the hard call-counter (≤2/search); usage totals survive for the UI. |
| `qualify/llm/artifactBackend.ts` | Rewritten for the tier scheme (see discrepancy 3). |
| Tests: `normalize`, `intent`, `injection`, `brief`, `budgeter` | Re-targeted: driver fixture tests, `map()` parse tests, parse-boundary hardening tests, call-counter test. |

## DELETE (dies completely)

| File | Why it dies |
|---|---|
| `qualify/pipeline/verify.ts` | The per-candidate web-search verification loop — the central v3 delete. Sources are chosen because their category signal is already trustworthy. |
| `qualify/pipeline/classify.ts` | Per-candidate LLM triage (Y/N/U batches). Same reason. |
| `qualify/pipeline/search.ts` (`runSearch`) | The orchestrator of classify/verify streaming. Replaced by map→route→fetch→probe→brief. |
| `qualify/pipeline/brief.ts` → `draftOutreach` + `OUTREACH_SYSTEM` | Not one of the five verbs. |
| `qualify/prompts` (`CLASSIFY_SYSTEM`, `VERIFY_SYSTEM`, `OUTREACH_SYSTEM`) | Only `INTENT_SYSTEM`'s successor (map prompt) survives, rewritten. |
| `qualify/llm/ollamaBackend.ts`, `openaiCompatibleBackend.ts` | Not on the path; adapter surface is claude.ai + apiKey tiers + CLI backend only. |
| `registry-core/src/sources/colorado/entities.ts` (`fetchEntities` full dump) | Only consumer is the CLI `entities` debug command; not on the query→lead path. |
| `tradeNames.ts` → `fetchNewTradeNames` | Digest-era leftover; no caller on the path. |
| `registry-core/src/location/zipCentroids.ts` (533 lines), `geometry.ts`, `resolve.ts`, `scripts/gen-centroids.mjs` | Metro-radius client logic (expected delete). Frees ~1/3 of the artifact budget. See discrepancy 2 for the replacement geo mechanism. |
| `apps/artifact/src/App.jsx` | Map-geofence UI + streaming lead-upsert/verify-badge UI, built around deleted radius + verify machinery. v3 UI rebuilt on the five verbs. |
| `packages/shared` | Empty placeholder (`export {}`). |
| Tests: `geometry.test`, `classify.test` | Die with their subjects. |
| `RegistrySource.ts` interface | Replaced by the generic Driver interface + manifest. |

## Discrepancies vs the spec's expectations

1. **There are no DNS/MX utils in this repo.** The spec lists them as an
   expected keep, but v2 has no probe code at all — contact discovery lived
   inside the deleted per-candidate verify LLM call. `probe()` (domain-slug
   guesses → Cloudflare DoH A+MX) is **net-new in Phase 3**, not a port.
2. **Deleting metro-radius leaves fetch needing a geo filter.** The CO SoS
   datasets carry `principalcity` / `zipcode` fields. Recommendation:
   `map()` emits geo as a city list (e.g. "Denver" → `['DENVER']`, "near me"
   defaults to statewide CO in v3.0) and drivers filter on the city field —
   zero client geometry, no 16kb centroid table. Radius UX can return later
   as a static metro→cities table if needed.
3. **`ArtifactBackend` does not use `window.claude.complete`** — it POSTs
   `api.anthropic.com/v1/messages` directly (model hardcoded to
   claude-sonnet-4-6, no auth header, relying on claude.ai's proxy). The v3
   adapter will follow the spec: both tiers → `window.claude.complete` on
   claude.ai; `cfg.apiKey` → haiku-4-5 (cheap) / sonnet-5 (best).

## LLM call budget after refactor

`map()` = 0 or 1 call (0 when the static keyword table hits) +
`brief()` = 1 batched call → **≤2 per search, zero per-candidate**, enforced
by a call-counter test.

# ADR 0008 — Concurrency Limits

**Status:** Accepted

## Context

The pipeline makes three types of external requests: Socrata data fetches, Census geocoder calls, and LLM API calls. Each has different rate limits and cost characteristics. Uncontrolled concurrency would either hit rate limits (Socrata) or cost more than necessary (LLM calls).

## Limits Chosen

| Request type          | Concurrency | Rationale                                                    |
|-----------------------|-------------|--------------------------------------------------------------|
| Socrata page fetches  | 4           | Below Socrata's undocumented rate limit; with app token: 4 is conservative |
| Socrata aggregation   | 2           | Lower because aggregate queries are heavier on the server    |
| Census geocoder       | 1           | Nominatim's stated limit is 1 req/s; Census has no stated limit but we match it |
| LLM classify batches  | 2–3         | Balances throughput vs. cost; user can see progress at this rate |
| LLM qualify per-lead  | 3           | Spec requirement; per-lead calls are heavier (web_search)    |

## Implementation

A single `Limiter` class in `packages/registry-core/src/util/http.ts` accepts `maxConcurrent` and queues excess calls. It is not Socrata-specific — it wraps any `() => Promise<T>`. Callers pass their own limiter instance so the limits are explicit at the call site.

## Consequences

- No global rate-limit state — each caller owns its limiter. This avoids hidden coupling between pipeline stages.
- The limiter adds minimal overhead (a counter and a queue of promises) — it is not a bottleneck.
- Future tuning (e.g., raising Socrata concurrency when an app token is present) is a config change at the call site, not a refactor.

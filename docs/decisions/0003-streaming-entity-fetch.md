# ADR 0003 — Stream Entities Page-by-Page, Don't Batch the Full Set

**Status:** Accepted

## Context

A Colorado registry query for a metro area (Denver, 80201–80299) can return tens of thousands of entities. Waiting for the full set before starting the classify stage would mean a 30–60 second blank screen before any results appear. Socrata's SODA API is paginated (`$limit`/`$offset`).

## Options Considered

1. **Stream pages as they arrive** — `fetchEntities` returns an `AsyncIterable<NormalizedEntity>`. Each page is passed to the pipeline as it lands. Concurrency: 4 pages in flight.
2. **Fetch all pages, then process** — simpler orchestration, but blocks the UI and wastes time.
3. **Cursor-based streaming** — Socrata supports `$order` + `$where` cursor patterns, but they require a stable sort key and are more complex.

## Decision

Option 1: `AsyncIterable<NormalizedEntity>` with 4 concurrent page fetches (controlled by the concurrency limiter in `http.ts`). The prefilter stage consumes entities as they arrive, and the classify stage receives batches of ~30 as they accumulate. The UI renders each batch as it resolves — the `FunnelProgress` component shows a live count.

## Consequences

- The pipeline orchestrator (`run.ts`) must handle backpressure: if classify is slower than fetch, entities queue up. The concurrency limiter on classify (2–3 in flight) naturally applies this backpressure.
- Total memory usage is bounded by the number of in-flight pages × page size, not by the full result set.
- The `$limit` page size is set to 1000 (Socrata's max) to minimize round trips; actual concurrency is 4, so peak in-flight = 4000 entities.

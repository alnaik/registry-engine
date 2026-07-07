# ADR 0005 — TSV/Pipe-Delimited Lines for LLM I/O, Not JSON

**Status:** Accepted

## Context

Every token sent to the LLM costs money and latency. The classify stage processes batches of ~30 entities. If each entity were sent as a JSON object, the structural tokens (braces, quotes, colons, newlines) would be roughly equal to the data tokens. The output (verdicts) also needs to be machine-parseable.

## Options Considered

1. **Pretty JSON** — human-readable, but bloated. A 30-entity batch might cost 800–1200 tokens just for structure.
2. **Minified JSON** — smaller, but still includes field name repetition per row.
3. **TSV lines** — `id<TAB>name<TAB>tradeDesc` — structural overhead is just the tabs. No field names repeated. A 30-entity batch costs roughly 300–500 tokens.
4. **Pipe-delimited** — similar savings; `|` is less ambiguous than tab in some contexts.

## Decision

TSV for the classify stage input. IDs are short integers (0–29, local to the batch) mapped back to entity IDs in code — this saves ~10–15 chars per entity compared to sending the full `entityid` string.

Output format: `id:V` lines where `V ∈ {Y, N, U}` (Yes/No/Uncertain). No JSON envelope, no prose. The model is instructed: "Output ONLY `id:V` lines. No explanation. No preamble."

An unparseable line in the output is treated as `U` (uncertain) — it doesn't crash the pipeline.

## Consequences

- Prompts require careful instruction to elicit the coded format reliably. Tested across models before shipping.
- Token counts for the classify stage are documented in `packages/qualify/src/prompts/README.md` with measured numbers.
- The `tradeDesc` field is truncated to 120 chars to bound input size per entity.

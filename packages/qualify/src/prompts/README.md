# Prompt Accounting

Every prompt used in the qualification pipeline is documented here with measured token counts.
Entries are added as each stage is implemented (Phase 2+).

| Stage     | Prompt file     | System (tokens) | Typical input (tokens) | Max output (tokens) | Notes                          |
|-----------|----------------|-----------------|------------------------|---------------------|-------------------------------|
| prefilter | prefilter.ts   | TBD             | TBD                    | TBD                 | 1 call per run                |
| classify  | classify.ts    | TBD             | ~30 entities × ~20 tok | TBD                 | batched; TSV in, coded out    |
| qualify   | qualifyLead.ts | TBD             | TBD                    | TBD                 | web_search enabled, 3 concurr |
| feedback  | feedback.ts    | TBD             | TBD                    | TBD                 | small batch; heuristic first  |

Token counts are MEASURED from actual API responses, not estimated from character counts.
Rule: system prompts ≤ 120 words. Rationales requested only where a human reads them.

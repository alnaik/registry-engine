# Prompt Accounting

Every prompt used in the qualification pipeline is documented here with measured token counts.

## System Prompt Sizes (chars / 4 heuristic)

| Stage     | Prompt constant    | Chars | Est. Tokens | Max output | Notes                          |
|-----------|--------------------|-------|-------------|------------|-------------------------------|
| prefilter | PREFILTER_SYSTEM   | ~370  | ~93         | 300        | 1 call per run; JSON out      |
| classify  | CLASSIFY_SYSTEM    | ~280  | ~70         | 200        | batched 30; TSV in, coded out |
| qualify   | QUALIFY_SYSTEM     | ~530  | ~133        | 300        | web_search enabled, 3 concurr |
| outreach  | OUTREACH_SYSTEM    | ~370  | ~93         | 150        | 1 call per lead; prose out    |

Token counts are estimated from character counts (chars / 4). Measure from actual API responses when available.
Rule: system prompts ≤ 120 words. Rationales requested only where a human reads them.

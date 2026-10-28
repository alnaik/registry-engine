# 0015 — Activity-coded discovery (v5)

## Context

The v4 engine found businesses by searching legal names for query keywords
(ADR 0009: "name text is the only semantic signal a registry has"). Live runs
on 2026-10-22 showed this has the same self-marketing bias as web search: it
only finds businesses that put what they do in their name.

- "metal fabrication in denver": EPA ECHO lists 36 active NAICS-332
  facilities in Denver; ~7 have "metal" in their name (Ardco, Fintech,
  Heggem Lundquist, Goldberg Brothers, Provision Inc are unreachable by name).
- "packaging manufacturer in colorado": "colorado" leaked into the name
  search; the top lead was a hospital system.
- "restaurants in boulder that buy produce": the product word routed to PACA
  as if produce sellers were the target; direction never reached routing.
- Scoring added points for contacts and DNS, so web-visible businesses scored
  ~105 and invisible ones ~20 — the target population ranked last.

That assumption was wrong. Government and lender records *do* carry what a
business does, as an industry code, filed by someone other than the business:

- **SBA PPP loan data** (FOIA, 2020–21): nearly every US small business that
  existed then, including sole proprietors, with NAICS code, address and jobs.
- **EPA ECHO**: every active regulated facility, with NAICS codes and last
  inspection date.
- **Colorado farm-products financing list** (`ej2c-jkvh`): growers, their
  crops and lenders — 3,876 filings list potatoes alone.
- **PACA**: licensed produce dealers with published phone/email.

## Decision

Route on **NAICS codes**, not on keywords.

1. `map` turns the query into the NAICS codes of the businesses to contact.
   The direction decides which side: needing something → codes of businesses
   that make or supply it; selling something → codes of businesses that buy or
   use it. One cheap LLM call does this, and its codes are validated against
   the official NAICS 2017 list. Without an LLM, a matcher over the Census
   NAICS index file is the fallback (supplier direction only), and `--naics`
   lets the user pass codes directly.
2. `route` matches query codes against each source's `coverage.naics` by
   prefix; `["*"]` sources (SoS, PPP, ECHO) filter by code themselves.
3. Secretary of State registries become the identity and liveness check
   (existence backfill, ADR 0013). Their keyword name search stays as a
   secondary signal, scored below coded matches.
4. Ranking = category fit (code match, keyword match) + evidence of operating
   (independent sources, current SoS standing, recent dated records). Web
   presence and contacts are **not** scored. They are reported as a label.
   (`--hidden`, a filter to leads with no website on any public record, was
   removed in v7b.)
5. Output is a call sheet: what the business is (code + which agency says
   so), size, liveness evidence, how to reach it, a short opener, and a CSV
   of every ranked lead.

PPP data is too large to query per search and has no API. It ships as
static shards per region and NAICS sector (`shards/ppp/US-CO/33.json`),
built by `scripts/data/build_ppp_shards.py`, read from the repo via a
`repo:` endpoint. PACA moves to `repo:shards/paca` too, so the open item
about uploading the gist goes away.

Scope stays deep, not broad: Colorado gets the new sources; CT/NY keep
their v4 entries unchanged.

## Consequences

- Suppliers and buyers in any industry are reachable, regulated or not,
  because NAICS covers every industry and PPP covered most small businesses.
- PPP is a 2020–21 snapshot. A PPP-only lead is a "probably still exists";
  SoS standing or a recent ECHO inspection upgrades it. The brief must say
  which.
- An industry code says what a business *is*, not whether it can take a
  specific job (minimums, capacity). That is still the phone call; the brief
  says so.
- Businesses with no published contact get address, officers/agent and a
  prefilled search link — there is no free phone source for invisible
  businesses, and none is guessed.
- Buyer-side (sell direction) mapping needs the LLM; the no-LLM path says so
  rather than returning the wrong side of the market.
- Records naming individuals (PPP sole proprietors, farm debtors) are shown
  only as filed; nothing is enriched.
- Recall can be measured against Census County Business Patterns
  establishment counts per NAICS × county (bulk files; the API now needs a
  key).

## Validation (2026-10-22)

Census CBP 2022 (`cbp22co.txt`, employer establishments, Denver County)
against PPP borrowers whose project county is Denver (deduped on name+zip):

| NAICS | Industry | CBP establishments | PPP borrowers |
|---|---|---|---|
| 332 | Fabricated metal products | 79 | 94 |
| 314 | Textile product mills | 16 | 16 |
| 315 | Apparel manufacturing | 16 | 39 |
| 311 | Food manufacturing | 114 | 138 |

PPP matches or exceeds the Census count in every row (it also includes
non-employers and businesses that have closed since 2021), so for small
businesses the coded universe is essentially complete as of 2020–21. The
counts can't be joined record by record (CBP is aggregate), so this shows
coverage, not per-record precision.

Name search is what v4 relied on, and it would have missed most of them: of
the 105 Denver-city PPP borrowers coded 332, 28 (27%) have metal, fab,
weld, steel or iron in their name.

Live runs:
- "I need someone to sew 500 custom tote bags near Denver" → LLM codes
  315210 + 314910; top leads were canvas and cut-and-sew shops (2–10 jobs),
  none with a website in any record.
- "who would buy my small-batch hot sauce in Boulder" → specialty food
  stores, restaurants, grocery wholesalers, supermarkets.

These runs found three problems, fixed in Phase 3: briefs never saw the
user's words, ranking ignored the map's best-first code order, and generic
words ("custom") became name keywords.

# 0016 — Distance from the user, web contact lookup, local web app

## Context

After v5 (ADR 0015), live runs and user feedback (2026-10-22) left three
gaps:

1. Most coded leads have no phone or email. PPP, ECHO and SoS publish none.
2. A city in the request was an exact filter, so "near Denver" excluded
   Aurora and Englewood. The user wants the whole state searched, with
   results grouped by how close they are.
3. The CLI is not something a small business owner can use.

The user asked for contacts to come from a web-data service (Exa, Parallel
or context.dev were suggested). That changes the v4 policy of using only
contacts the registries publish.

## Decision

**Location.** Census Gazetteer 2024 ZIP (ZCTA) and place centroids ship in
`packages/registry-core/src/geo/`. A place in the request (after a locative
like "near" or "in") or `--near` becomes the origin. The whole region is
fetched and leads are sorted into bands (within 10 / 10–25 / 25–50 / 50–100
/ 100+ mi / unknown), then by score. `--radius` cuts off by distance.
Distance is ZIP-centroid accurate. PO-box ZIPs fall back to the city
centroid.

**Web contact lookup.** For the top N leads only (N = the number briefed),
one search per lead through Exa (`EXA_API_KEY`) or Parallel
(`PARALLEL_API_KEY`):

- Extraction is deterministic. A page must match the business name *and*
  its city or ZIP. Directory sites (Yelp, BBB, Facebook…) count as listings,
  never as the website. Phone and email come by pattern from matching pages,
  and every value keeps its source URL.
- Web text never reaches the LLM. The brief only sees the extracted strings.
  The prompt-injection surface stays closed.
- Results are labeled "found online — verify", cached 30 days
  (`~/.cache/registry-engine/contacts.json`), and capped per search. These
  are search calls, not LLM calls, so the ≤2 LLM-call budget is unchanged.
- Records of individuals (PPP sole proprietors and self-employed borrowers,
  "LAST, FIRST" farm debtors) are never searched. A personal name search
  would surface personal contact details.
- Ranking still ignores contacts. A lead that web search can't find at all
  is labeled "no web presence found", the measured version of the hidden
  businesses this product exists to surface.

context.dev was considered. Its documented lookup is by domain, and these
leads mostly have none, so it was not wired. It fits the same
`WebSearchProvider` interface if its search endpoint proves useful.

**Local web app.** `npm start` serves a vanilla HTML/JS UI from
`apps/web` on 127.0.0.1. It reuses `search()` and calls the LLM through the
user's Claude Code login, as the CLI does. A hosted version would need an
API key and a real backend, which is out of scope and the reason the chat
artifact failed (ADR 0011).

## Consequences

- Each search can spend web-search credits (Exa reports `costDollars`, and
  the total is shown). The cache makes repeat searches free.
- A contact found on the web may be stale or wrong, and every one is marked
  for verification with its source.
- The privacy policy now allows contacts that a business published about
  itself on the web, found by searching the business name. It still never
  allows searching for individuals.

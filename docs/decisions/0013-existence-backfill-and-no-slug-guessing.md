# 0013 — existence backfill by name, and dropping slug-guessed domains

Status: accepted
Date: 2026-07-18

## Context

Live-run diagnosis of the pipeline showed the existence-registry join
consistently missing for one class of entity: category-plane (PACA) records
whose legal name carries none of the query's search keywords. The existence
fetch (`co_sos` and friends) is keyword-only by design — a statewide dump
without a keyword would stream the whole registry — so those legal-name-only
rows are simply never fetched, and there is nothing for `mergeEntities` to
join against. The merge logic itself is correct; the problem is upstream,
in what gets fetched at all.

Separately, `probe()`'s name-slug `.com` guessing (`slugCandidates`) almost
never resolves against a live domain in real runs, and on the rare occasion
it does resolve, there is no guarantee the domain belongs to the business
being probed — a guessed slug can attach the wrong company's website and
email pattern to a lead.

## Decision

(a) Add an optional `Driver.fetchByNames(source, names, opts)` method,
    implemented on `SocrataDriver`. Given the names of entities discovered on
    other planes, it builds normalized-name LIKE patterns
    (`soqlSafeLiteral(normalizeName(name))`, tokens joined with `%`), chunks
    them into OR'd clauses per request, filters by the existence source's
    status value, and issues no city filter — this is a targeted lookup, not
    a regional scan. The engine runs a backfill pass after the first merge:
    for every plane-mismatched (existence-less) entity, it calls
    `fetchByNames` on the routed existence source (if the driver supports
    it), keeps only the rows whose normalized name actually matches one of
    the unmatched entities (a LIKE pattern can overmatch), and re-merges
    existence-plane-first so the legal name and status win. An `EngineEvent`
    of type `backfilled` reports how many rows joined.

(b) `probe()` now verifies published contacts only — an email or website
    contact from the registry itself — checked A + MX over DNS-over-HTTPS.
    Name-slug guessing is removed entirely.
    *Amended v7 (F1): only a website contact is probed; an email address's
    host is never probed and never marks the web presence verified.*

(c) Leads with no published domain to verify carry a prefilled DuckDuckGo
    search URL (`"<legal name>" <city> <state>`) instead of a guessed one,
    so a human still has a one-click next step without registry-engine
    asserting a domain it can't verify.

## Consequences

The existence join no longer depends on the query's keyword happening to
appear in a business's legal name — it costs a handful of extra Socrata
requests per search (roughly `unmatched / NAME_CHUNK`, capped at
`MAX_BACKFILL_NAMES` distinct patterns). Guessed domains and their derived
"pattern guess" emails no longer appear anywhere except pattern emails on
MX-live *published* domains, which were already marked UNVERIFIED. Briefs
and the CLI surface a search link instead of silence for leads DNS can't
confirm.

## Amendment (2026-10-27, v7b): the cap and "check all"

The backfill stays capped by default: the engine sends the top 150 unmatched
leads (`BACKFILL_ENTITIES`) and the Socrata driver at most 80 distinct name
patterns (`MAX_BACKFILL_NAMES`). Measured 2026-10-27 against CO SoS, produce
near Denver (709 coded leads): capped 22 s / 33 registry matches; uncapped
180 s / 223 matches. Cost is per name pattern (~0.25 s each) whatever the
chunk size (50 per query took 209 s; 100 per query hit the 20 s request
deadline), so `NAME_CHUNK` stays 25 and the default cap stays.

"Check all" (web button, CLI `--check-all`, `SearchConfig.backfillAll`)
re-runs the search with no cap: every unmatched lead whose code relates to
the map's codes is sent (`fetchByNames(..., { maxNames: Infinity })`), with
`backfill_progress` events per chunk. `RegistryLookup.totalNames` says how
many names that is, so the sheet can say "Checked 80 of 384 names". The web
run overwrites the stored copy of the same search. Check-all is a full
re-run, so the AI map call may pick slightly different codes; accepted.

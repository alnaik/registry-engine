# 0017 — Field sheet UI and honest trust labels

## Context

The v5 web app (ADR 0016) worked but read like a dashboard: cards, a
distance map, several colors, and labels that overstated what the records
say. The worst case: "Not on state registry" was shown for any lead the
capped existence backfill never looked up, so a business in good standing
could be labeled as if it had lapsed. Name-only matches and individuals'
records sat in the headline count. Openers quoted NAICS titles ("Hi, are you
a Textile Bag and Canvas Mills?").

An approved mockup set a new direction: a field sheet, meaning one column of
ruled rows on paper that a person can call down, print, and mark up.

## Decision

**Design language.** One column of ruled rows. 4px spacing scale. Type
13/15/17/22/30 at weights 450 and 650, tabular numbers, uppercase eyebrows.
One ink, one paper. Teal is only for actions and links. Three trust tokens:
confirmed (green), unchecked (grey), not found (amber). Dark mode comes from
`prefers-color-scheme`, with `[data-theme]` re-scoping so `/design` can show
both themes. The only card is an expanded row. Tokens and every component
live on `GET /design`, which uses fictional data.

**Lead row.** Name; a plain "what" (`naicsPhrase`: "Makes textile bag and
canvas products", never the raw title) and "about N jobs"; a trust line
(pill, tag, call status); a reach line; distance on the right with city and
ZIP. A row expands inline (one at a time, Escape closes) into Why it fits,
What to say (opener and Copy), Reach, Your call (outcome and note), and
Where this comes from (collapsed evidence).

**Tri-state registry standing.** `Lead.registryCheck` is `matched`,
`checked_not_found` or `not_checked`. The engine knows which names were
really sent because `planBackfill` replicates the driver's dedupe key and
cap. Labels:

- matched: "On state registry · <status>"
- checked, not found: "Not on state registry" plus "Last record <year>.
  Confirm it still operates."
- checked, but a same-named record exists at an incompatible locality: "Not
  on state registry at this address" plus "A business with this name is
  registered elsewhere. Confirm it's the same one." Plain "Not on state
  registry" would be false here.
- not checked: "Not checked against registry" plus one of "Beyond the N
  names checked this search", "The registry lookup failed this search", or
  "No state registry lookup for this search". A top-150 candidate whose name
  is too short to look up (under 4 letters) also falls under "Beyond the N
  names". That is slightly loose, but never claims a check that didn't
  happen.

All label strings live in `apps/web/public/labels.js` (pure, no DOM).
`tests/web/labels.test.ts` pins each one to its LeadView predicate, and it
fails if a label is added without a pin or hard-coded in `app.js`.

**What leaves the main list.** Name-only matches (no code for this work),
individuals' records and recent filings each go in their own collapsed
group, outside the headline count. Individuals' names are shown as filed,
because the records are public by statute (ADR 0015, SECURITY.md Threat 5),
but they get no map link, no web search and no contact lookup. The server
sends `mapsUrl: null` and `searchUrl: null` for them.

**Capped fetches** read "500+ (capped)", never a bare count.

**Openers** use the user's own words (`requestPhrase`) and never a NAICS
title or a person's name. This holds for both the template and the LLM
prompt.

**Summary and About.** One sentence: coded count in the state, how many
within the radius (or 25 mi), individuals' records, how many are confirmed,
how many publish a phone. Everything else (per-source counts, names
checked, AI calls and tokens, contact lookup status, time) goes in a
collapsed "About this search" table at the bottom.

**Three surfaces on one page.** Masthead tabs Find and My calls. Find is the
ask bar, then the reading line ("looking for suppliers (guessed) · find
buyers instead"), then bands. The direction override and the code finder
live in More options; the code finder opens itself when Skip AI meets a
buyer search, or when the map found no codes. My calls is a table over
every logged call (business, from search, outcome, note, updated) with CSV
export.

**Call outcomes** are Not called, Reached, No answer and Not a fit. Older
entries migrate on read: called becomes Reached, interested becomes Reached
with the note prefixed "Interested. ", and new becomes Not called.
Outcomes are plain bold ink, not colored pills, because color is reserved
for trust state. For the same reason the row's call status is ink, not
teal.

**Removed: the distance map.** Bands already carry the distance. The map
added a second color system, needed coordinates per row, and duplicated
the list. It is gone from the code, the CSS and the README.

**Print.** Ruled rows with a blank dotted notes line under each. The tools,
ask bar, groups and About are hidden; band headings stay with their first
row. About 8 rows per page, so 12 leads fit on two pages.

**Accessibility.** ARIA tabs with arrow keys; rows are buttons with
`aria-expanded`/`aria-controls`; the scrollable calls table is a focusable
region; a polite status region announces "Search done. <summary>".
`npm run a11y` runs axe-core against `/design`, a Skip AI search page and
My calls at 390 and 1280 px in light and dark, using a fictional fixture
search (`tests/web/fixtures/sheet-outcome.ts`), and fails on any serious or
critical violation.

## Consequences

- No ranking change: trust labels are display only, and web and contact
  data still add no points.
- Privacy and LLM limits are unchanged: at most 2 calls per search, no web
  text to the LLM, no web search for individuals.
- The CSV gains a `registry_check` column, and the My calls export gains
  `trust_at_call` and `trust_tone_at_call`.
- Some sole proprietors file under a plain personal name with a business
  entity type, and `isLikelyIndividual` misses them, so they stay in the
  main list. Detection is out of scope for this UI change.

## Validation (pending)

The labels make a testable claim: a lead labeled "On state registry" should
be reachable more often than one labeled "Not on state registry", with "Not
checked" in between. Nothing is measured yet, and no outcomes are invented
here.

Scaffold in place: when a call outcome is set, the tracker stores the trust
label as it read at that moment (`trustAtCall` in `labels.js`: a note edit
keeps it, a new outcome re-records it, Not called records none, and older
entries get none). The My calls CSV exports it as `trust_at_call` and
`trust_tone_at_call`.

Protocol: over real searches, log 20 leads, at least 6 from each tone (ok /
unk / no) where possible. Call each one and set Reached, No answer or Not a
fit. Export My calls and compute the reached rate by `trust_tone_at_call`.
Record here: the date, the searches, n per tone, reached per tone, and any
lead where the label proved wrong (for example a "Not on state registry"
business that is operating under a new entity). If "no" is reached about as
often as "ok", the amber tone overstates risk and should soften.

## Addendum (2026-10-27, audit fixes)

- **Dissolved is its own label.** Colorado's SoS appends ", Dissolved
  <date>" (also Delinquent, Colorado Authority Terminated/Relinquished) to
  an inactive entity's name, and the backfill asked only for Good Standing
  rows, so dissolved businesses read "Not on state registry". With
  `quirks.backfillInactive` (co_sos only; CT and NY unchanged) the backfill
  also asks for inactive rows, matches them on the bare name with the same
  locality guard, and sets `registryCheck: "inactive"`. The pill states the
  registry's fact, "Dissolved Oct 2026" (or "<status> on state registry"
  without a date), in the amber "no" tone, with the tag "The state registry
  lists it as <status>. Confirm it still operates." It never counts as
  confirmed. A dissolved namesake at another locality still reads "Not on
  state registry at this address" (ACME TENT & CANVAS: PPP in Denver, the
  dissolved SoS record in Englewood).
- **One population for the sentence and the chips.** The summary sentence
  counted all coded records, individuals' records included, while the
  filter chips counted business rows, so one screen said "18 confirmed"
  and "Confirmed 17". `partitionLeads` (qualify) is now the one split behind
  `sheetCounts`, the server's lists and the CLI: the sentence counts coded
  businesses, closes with "N individuals' records are listed separately",
  and says when the list is capped ("The sheet lists the top N; the CSV has
  all of them"). `tests/web/sheet-fixture.test.ts` pins the agreement.


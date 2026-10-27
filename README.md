# Registry Engine

Find the local businesses search engines miss: type what you need or what
you sell, and get a call sheet built from public records.

<img src="docs/media/search.png" alt="A real search in the app: typing a request and a location, the progress steps, then results grouped by distance" width="800">

## Run

```bash
npm install
npm start          # → http://localhost:4317
```

- **AI (optional).** If [Claude Code](https://claude.com/claude-code) is
  installed and logged in, each search makes 2 calls through it. Without it,
  tick **Skip AI**: supplier searches still work, and buyer searches need
  industry codes (the app's **Find codes** helper looks them up).
- **Contacts (optional).** Set `EXA_API_KEY` or `PARALLEL_API_KEY` before
  `npm start`, and the top results get a web lookup for website, phone and email.

Tested on Node 24.

## How a search works

**1. Say what you need, or what you sell.** One AI call turns the request into
the industry codes (NAICS) of the businesses to contact: makers and
suppliers if you need something, likely buyers if you sell something. Pick
the direction yourself, or let it guess.

<img src="docs/media/search-form.png" alt="The search form with a request, the supplier/buyer switch and a location" width="640">

**2. Public records are searched by industry code, not by name.** Most
of these businesses don't advertise and have no website. Each record is
confirmed against the state business registry.

<img src="docs/media/progress.png" alt="Progress: industries chosen, sources searched with counts, state registry matches" width="640">

**3. You get a call sheet,** grouped by distance from you. Each card says what
the business does and which record says so, how to reach it, a short note
on why it fits, and an opener to copy. A second AI call writes the notes and
openers for the top 12.

<img src="docs/media/lead-card.png" alt="A lead card: industry, source, registry status, address, call notes, opener and outreach tracker" width="640">

<img src="docs/media/recently-registered.png" alt="Recently registered near you: new state filings whose names match" width="480">

**Recently registered near you** lists state filings from the last 90 days
whose names match your request.

Also in the app: an outreach tracker and saved searches (both stored in your
browser), CSV export, and a printable call sheet.

## Sources

| Source | What it adds | Where | How fresh | Link |
|---|---|---|---|---|
| SBA Paycheck Protection Program loans | Industry code, address and job count for nearly every small business, including sole proprietors | Colorado (153,093 businesses) | 2020–21 snapshot, in `shards/ppp` | [data.sba.gov](https://data.sba.gov/dataset/ppp-foia) |
| EPA ECHO | Regulated facilities: industry code, last inspection | US | Live | [echo.epa.gov](https://echo.epa.gov/) |
| Colorado farm-products financing statements | Growers, their crops and their lenders | Colorado | Live | [data.colorado.gov](https://data.colorado.gov/d/ej2c-jkvh) |
| USDA PACA licenses | Produce dealers, with the phone and email they filed | CO 132 · CT 115 · NY 1,324 | Recorded July 2026, in `shards/paca` | [apps.mrp.usda.gov](https://apps.mrp.usda.gov/public_search) |
| Colorado Secretary of State | Legal name, standing, registered agent, trade names, formation date | Colorado | Live | [entities](https://data.colorado.gov/d/4ykn-tg5h) · [trade names](https://data.colorado.gov/d/u7sb-g482) |
| Connecticut Secretary of the State | Legal name, standing, formation date | Connecticut | Live | [data.ct.gov](https://data.ct.gov/d/n7gp-d28j) |
| New York Department of State | Legal name, registered agent, filing date | New York | Live | [data.ny.gov](https://data.ny.gov/d/n9v6-gdp6) |

Each search uses only the sources that cover its state and industries.
Colorado has all of them; Connecticut and New York have their registry plus PACA.

Bundled reference data: [NAICS 2017 codes and index](https://www.census.gov/naics/)
(Census) and [ZIP and place centroids](https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html)
(Census 2024 Gazetteer), used for distances.
Outside services: [Exa](https://exa.ai) or [Parallel](https://parallel.ai) for
the optional contact lookup, and Cloudflare DNS-over-HTTPS to check domains a
record lists.

## Token usage

Every search makes at most 2 AI calls, never one per business. Both go
through `claude -p` with no tools loaded, so the prompt is only the request
and the record facts. The app's summary shows the tokens each search used
(hover for the per-call split), and the CLI prints them after the results.

Measured on 2026-10-27:

| Search | Map call (Claude Haiku 4.5) | Notes call (Claude Sonnet 5) | Total | API-price equivalent |
|---|---|---|---|---|
| Tote bags near Denver (web app, above) | 3,446 in / 1,643 out | 6,064 in / 2,321 out | 13,474 | $0.059 |
| Tote bags near Denver (CLI) | 4,726 | 8,482 | 13,208 | $0.059 |
| Who would buy my hot sauce, 80302 (CLI) | 4,776 | 8,216 | 12,992 | $0.055 |

About 13k tokens per search. The notes call costs more because it reads the
facts of the top 12 businesses.

The cost column is the API-price equivalent that `claude -p` reports. With
a Claude subscription, searches count against your plan's usage, not a per-token bill.
**Skip AI** uses 0 tokens.

## CLI

```bash
npm run --workspace apps/cli start -- search "someone to sew 500 tote bags near Denver"
npm run --workspace apps/cli start -- search "who would buy my hot sauce" --near=80302 --csv=leads.csv
npm run --workspace apps/cli start -- codes metal fabrication     # look up industry codes
npm run --workspace apps/cli start -- help                       # all flags
```

## Know before you call

- An industry code says what a business **is**, not whether it can take your job.
- Buyer leads fit by industry. No public record shows what a business buys.
- PPP is a 2020–21 snapshot. Cards show which leads the state registry still lists as active.
- Public records only. Contacts found on the web are labeled "verify", with
  sources. Individuals' records never get a web lookup.

## Development

```bash
npm test && npm run typecheck
```

Architecture, conventions and the data rebuild scripts: [`CLAUDE.md`](CLAUDE.md).
Threat model: [`SECURITY.md`](SECURITY.md). Decisions: [`docs/decisions/`](docs/decisions/).
README media is captured from the running app with
[`scripts/docs/capture.mjs`](scripts/docs/capture.mjs).

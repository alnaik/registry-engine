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

**1. Say what you need, or what you sell,** and where you are. One AI call
turns the request into the industry codes (NAICS) of the businesses to
contact: makers and suppliers if you need something, likely buyers if you
sell something. It guesses the direction and says so; one click flips it.

<img src="docs/media/search-form.png" alt="The ask bar: what you need or sell, near, Find businesses, More options" width="640">

**2. Public records are searched by industry code, not by name.** Most of
these businesses don't advertise and have no website. The strongest
candidates' names are checked against the state business registry.

<img src="docs/media/progress.png" alt="The reading line: looking for suppliers (guessed), find buyers instead, sorted from Denver, and the sources being searched" width="640">

**3. You get a field sheet.** One sentence says how many businesses are coded
for the work, how many are near you, how many the state registry confirms
and how many publish a phone. Below it, one ruled row per business, grouped
by distance: what it does in plain words, a trust line, and how to reach it.

<img src="docs/media/summary.png" alt="The summary sentence, the filters, and the first rows of the sheet" width="640">

The trust line says only what was checked:

- **On state registry** (green): the business joined a registry record.
- **Not on state registry** (amber): its name was looked up and nothing
  matched. Confirm it still operates.
- **Not checked against registry** (grey): it ranked beyond the names
  checked this search.

**4. Open a row** for why it fits, what to say (one copyable sentence in your
own words), every way to reach it, and a place to record the call. A second
AI call writes the notes for the top 12. Your calls collect on the **My
calls** tab across searches.

<img src="docs/media/lead-card.png" alt="An open row: why it fits, what to say, reach, your call" width="640">

<img src="docs/media/recently-registered.png" alt="Registered in the last 90 days: new state filings whose names match" width="480">

**Registered in the last 90 days** lists state filings near you whose names
match your request. Individuals' records and name-only matches sit in their
own collapsed groups and never count toward the headline. **About this
search** at the bottom lists every source with its count, how many names
were checked, and the AI tokens used.

Also in the app: saved searches (stored in your browser), CSV export, and a
printable call sheet with a notes line under each business.
Recent searches: the server keeps your 20 newest finished searches in
`~/.cache/registry-engine/searches`, so you can reopen a sheet and its CSV
without running it again.

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
and the record facts. **About this search** at the bottom of the results
shows the tokens each search used, and the CLI prints them after the results.

Measured on 2026-10-27:

| Search | Map call (Claude Haiku 4.5) | Notes call (Claude Sonnet 5) | Total | API-price equivalent |
|---|---|---|---|---|
| Tote bags near Denver (web app) | 3,446 in / 1,643 out | 6,064 in / 2,321 out | 13,474 | $0.059 |
| Tote bags near Denver (CLI) | 4,726 | 8,482 | 13,208 | $0.059 |
| Who would buy my hot sauce, 80302 (CLI) | 4,776 | 8,216 | 12,992 | $0.055 |

The run that produced the screenshots above used 12.9k tokens (about $0.05).
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
- PPP is a 2020–21 snapshot. The trust line shows which leads the state registry still lists, and which weren't checked.
- Public records only. Contacts found on the web are labeled "verify", with
  sources. Individuals' records never get a web lookup.
- Without an Exa or Parallel key the sheet says nothing about websites; every
  business lead keeps its search link.
- Each search checks up to 80 names against the state registry. When there
  are more, the sheet says "Checked 80 of N names" and a **Check all N names**
  button re-runs the search with every name checked (about 0.25 s per name).

## Development

```bash
npm test && npm run typecheck
```

Architecture, conventions and the data rebuild scripts: [`CLAUDE.md`](CLAUDE.md).
Threat model: [`SECURITY.md`](SECURITY.md). Decisions: [`docs/decisions/`](docs/decisions/).
README media is captured from the running app with
[`scripts/docs/capture.mjs`](scripts/docs/capture.mjs).

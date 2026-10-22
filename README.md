# Registry Engine

Type what your business needs, or what it sells, and get the local businesses
that search engines under-show. Results come as a call sheet: what each one
does, how big it is, whether it's still operating, and how to reach it.

```bash
npm install
npm start            # opens the app at http://localhost:4317  (add -- --open to launch the browser)
```

Type what you need ("someone to sew 500 custom tote bags") or what you sell
("who would buy my small-batch hot sauce"), add your ZIP or town, and get the
whole state's matching businesses grouped by distance (within 10 mi, 10–25,
25–50 …). Each comes as a card with what it does, size, whether it's still
operating, how to reach it, call notes, an opener you can copy, and a
tracker (New / Called / Interested / Not a fit, plus notes, saved in your
browser). Export everything to CSV, export just your tracked list, or print
a call sheet.

**AI.** Two LLM calls per search, run through your Claude Code login
(`claude -p`), with no API key. Without Claude Code, tick "Skip AI".
Supplier searches still work from a built-in table, and buyer searches need
industry codes (the app's "Find codes" helper looks them up).

**Contacts.** Most of these businesses publish no phone or website in any
record. Set `EXA_API_KEY` (or `PARALLEL_API_KEY`) before `npm start` and the
top results get a web lookup for website, phone and email. Each value comes
with its source page and a "verify" label. The lookup is cached for 30 days
and never runs for an individual's record. Without a key, every card gets a
ready-made search link.

### CLI

```bash
npm run --workspace apps/cli start -- search "I need someone to sew 500 custom tote bags near Denver"
npm run --workspace apps/cli start -- search "who would buy my small-batch hot sauce" --near=80302 --csv=leads.csv
npm run --workspace apps/cli start -- search "metal fabrication" --near="Castle Rock" --radius=25 --no-llm --naics=332
npm run --workspace apps/cli start -- codes canvas bag
```

Flags:
- `--near=<ZIP|town>`: center for distance grouping. Default: a town named in the request.
- `--radius=<mi>`: drop leads farther away than this.
- `--naics=<c1,c2>`: use these industry codes instead of inferring them.
- `--hidden`: only leads with no website listed in any record.
- `--csv=<path>`: write every ranked lead.
- `--leads=<n>`: number of briefed and looked-up leads (default 12).
- `--no-contacts`: skip the web lookup.
- `--verbose`: show the raw evidence.
- `--region=<US-XX>`: region to search (default US-CO).
- `--no-llm`, `--limit=<n>`, `--model=<m>`, `--shards=<url>`.

> `node --experimental-strip-types apps/cli/src/index.ts` does **not** work.
> The source uses `.js`-suffixed ESM imports. Use the `vite-node` script above.

## Why this finds what search engines don't

Search engines show businesses that market themselves. But every business
leaves records it can't opt out of: loans, permits, inspections, licenses,
crop liens. Regulators and lenders write those records, and they carry an
**industry code (NAICS)** saying what the business does. Registry Engine
searches those codes, not names or websites.

| Source | What it adds | Coverage |
|---|---|---|
| SBA PPP loan records (2020–21) | Nearly every small business, incl. sole proprietors: NAICS, address, jobs | CO (153k businesses, `shards/ppp`) |
| EPA ECHO | Every active regulated facility: NAICS, last inspection date | US (live API) |
| CO farm-products financing list | Growers, their crops, their lenders | CO (live) |
| USDA PACA | Licensed produce dealers, with published phone/email | CO, CT, NY (`shards/paca`) |
| Secretary of State registries | Legal name, current standing, registered agent | CO, CT, NY (live) |

Check (ADR 0015): in Denver County, Census counts 79 fabricated-metal
establishments, and PPP lists 94. Only 27% of them have a metal-related word
in their name, so a name or keyword search misses most of them.

## How a search works

```
map(query)    1 cheap LLM call → the NAICS codes of the businesses to contact.
              Need something → codes of businesses that make/supply it.
              Sell something → codes of businesses that buy/use it.
              Codes are validated against the official NAICS 2017 list.
route(intent) pure manifest lookup: geo ∩ NAICS prefix. 0 tokens.
fetch(...)    drivers pull the routed sources and merge on normalized name +
              compatible locality; state registries are joined by name to
              confirm standing. 0 tokens.
probe(...)    published domains checked A+MX over DNS-over-HTTPS. 0 tokens.
brief(...)    1 best-tier LLM call for the top leads: why it fits, what's
              verified vs. not, how to reach it, an opening line.
```

Hard budget: **≤2 LLM calls per search, zero per lead**, enforced by a call
counter that throws, and by tests.

Ranking is industry-code fit plus evidence that the business operates
(independent sources, state standing, recent records). Having a website or
contact info adds nothing: the point is to find businesses with no web
footprint. Web presence is shown as a label, and `--hidden` filters on it.

## What it can't tell you

- An industry code says what a business **is**, not whether it can take your
  job (capacity, minimums, certifications). That is the phone call.
- Buyer leads fit by industry. No public record shows what a business is
  currently buying.
- PPP is a 2020–21 snapshot. A lead confirmed by the state registry or a
  recent EPA inspection is more likely still operating, and each brief says
  which applies.
- Most of these businesses publish no phone or email in any record. With a
  web-search key the top leads are looked up (website, phone and email from
  pages that match the business's name *and* town, each with its source).
  Otherwise you get the address, the registered agent or principals, and a
  prefilled search link (not for individuals' records). Nothing is guessed.
- Distance is measured from ZIP centroids, so it's approximate to a mile or
  two.

## Adding a source or a state

Add an entry to `packages/registry-core/src/sources/manifest.json`: plane,
coverage (geo ∩ NAICS codes, `["*"]` = any), endpoint, field map and quirks.
It needs **zero code changes**, as `tests/registry-core/zero-code-state.test.ts`
proves. Drivers: `socrata`, `echo`, `static_shard` (local or hosted JSON
shards, optionally split per NAICS sector).

Rebuild data:
- `python3 -I scripts/data/build_naics.py` (NAICS titles + Census index)
- `python3 -I scripts/data/build_ppp_shards.py --state CO --out shards/ppp <ppp csvs…>`
  (SBA PPP FOIA files from https://data.sba.gov/dataset/ppp-foia)

## Layout

```
packages/registry-core/   MIT. Entity, NAICS lookup, drivers, manifest, route().
packages/qualify/         LLM adapter, map/probe/brief verbs, engine.
apps/web/                 Local web app (npm start): server.ts + vanilla public/ UI.
apps/cli/                 CLI harness (LLM via headless claude -p).
shards/                   PPP (per region/sector) and PACA (per region) data.
packages/registry-core/src/geo/  Census ZIP + place centroids (build_geo.py).
scripts/data/             Rebuild NAICS and PPP data from the public sources.
```

```bash
npm test              # drivers, route, verbs, engine golden queries (hermetic)
npm run typecheck     # strict TS across the workspace
```

## Privacy

Public records only, plus what a business published about itself on the web
(found by searching its name, labeled "verify", with sources; ADR 0016). No
web lookup ever runs for an individual's record. Registry-published domains
with MX may get a pattern email guess, always marked UNVERIFIED.
PPP and farm-financing records name some individuals (sole proprietors,
farm debtors). They are shown exactly as filed and never enriched. They get
no web-search link, and the AI brief never sees the person's name.

# Registry Engine

Type what your business needs, or what it sells, and get the local businesses
that search engines under-show. Results come as a call sheet: what each one
does, how big it is, whether it's still operating, and how to reach it.

```bash
npm install
npm run --workspace apps/cli start -- search "I need someone to sew 500 custom tote bags near Denver"
npm run --workspace apps/cli start -- search "who would buy my small-batch hot sauce in Boulder" --csv=leads.csv
```

The default path makes two LLM calls per search through the Claude Code CLI
(`claude -p`), so it needs Claude Code installed and logged in. No API key.
`--no-llm` runs with zero calls: supplier searches use a small built-in
table, and buyer searches need `--naics=<codes>`. Look codes up with
`codes <words>`:

```bash
npm run --workspace apps/cli start -- codes tote bag
npm run --workspace apps/cli start -- search "metal fabrication in denver" --no-llm --naics=332
```

Flags:
- `--naics=<c1,c2>`: use these industry codes instead of inferring them.
- `--hidden`: only leads with no website listed in any record.
- `--csv=<path>`: write every ranked lead, not just the top N.
- `--leads=<n>`: number of briefed leads (default 12).
- `--verbose`: show the raw evidence behind each lead.
- `--region=<US-XX>`: region to search (default US-CO).
- `--limit=<n>`: per-source fetch cap.
- `--model=<m>`: Claude model for the headless calls.
- `--shards=<url>`: alternate shard host.

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
- Most of these businesses publish no phone or email. You get the address,
  the registered agent or principals, and a prefilled search link. Nothing is
  guessed.

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
apps/cli/                 The delivery surface (LLM via headless claude -p).
shards/                   PPP (per region/sector) and PACA (per region) data.
scripts/data/             Rebuild NAICS and PPP data from the public sources.
```

```bash
npm test              # drivers, route, verbs, engine golden queries (hermetic)
npm run typecheck     # strict TS across the workspace
```

## Privacy

Public records only. Contacts are only those a registry publishes, plus a
pattern email guess when that domain has MX (always marked UNVERIFIED).
PPP and farm-financing records name some individuals (sole proprietors,
farm debtors). They are shown exactly as filed and never enriched.

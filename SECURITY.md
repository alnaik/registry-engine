# Security Threat Model — Registry Engine

Version: 3.4 (v5, activity-coded discovery + web app)
Last updated: 2026-10-27

The known threats, their mitigations, and where each mitigation lives in the
code. Update the code locations when code moves.

---

## Threat 1: Prompt injection through record data or the request

**Severity:** Medium. No web content is retrieved any more (that surface left
with v2's verify stage). The LLM now sees two untrusted inputs. One is the
user's request, in `map` and `brief`. The other is registry text inside
`brief`: business names, trade names and contacts, which anyone can file.

**Mitigations:**
1. **Data, not instructions.** Both system prompts tell the model to treat
   the request and lead data as data. The request is sent JSON-stringified
   and capped at 300 chars.
   - `packages/qualify/src/verbs/map.ts` (`MAP_SYSTEM`), `packages/qualify/src/verbs/brief.ts` (`BRIEF_SYSTEM`, packing in `briefLeads`)
2. **Schema-constrained parsing.** The map output keeps only NAICS codes
   that exist in the official list (`isNaicsCode`), capped at 6. Keywords
   are lowercased, stripped to `[a-z0-9 ]`, filtered against stopwords and
   capped. Unknown keys are dropped. Brief output keeps only `i`/`brief`/
   `opener`, with each string word-clamped.
   - `parseMapResponse` in `map.ts`, `parseBriefResponse` in `brief.ts`
3. **No side effects from model output.** The model's codes and keywords
   only select read-only public queries. Ranking is arithmetic in code, and
   the model never scores leads.
4. **Budget.** At most 2 calls per search. The adapter's call counter throws
   `LlmCallBudgetError`, so a loop can't run up calls.
   - `packages/qualify/src/llm/adapter.ts`
5. **Minimal data to the model.** Officers, agents and addresses are never
   sent to the LLM.
6. **No tools for the headless model.** `claude -p` runs with `--tools ""`
   and `--strict-mcp-config`, so injected request or registry text can't
   trigger tool use.
   - `packages/qualify/src/llm/claudeCodeBackend.ts`

---

## Threat 2: Query injection into government APIs

**Severity:** Medium. LLM-derived and user-derived values reach external
queries.

- **SoQL (Socrata).** Keywords, cities and names are interpolated into
  `LIKE` clauses. `soqlSafeLiteral` strips quotes, `%` and `_`, uppercases,
  and collapses whitespace. Keywords under 3 chars are dropped, and there are
  at most 8.
  - `packages/registry-core/src/drivers/socrata.ts`
- **Formation-date filter (recent filings).** The `since` literal is built from
  the engine clock and validated as `YYYY-MM-DD` before it is interpolated
  into SoQL; keywords still go through `soqlSafeLiteral`.
  - `SocrataDriver.fetchRecent` in `packages/registry-core/src/drivers/socrata.ts`
- **EPA ECHO.** Only codes matching `/^\d{3,6}$/` are sent (and the map has
  already validated them against the NAICS list). All parameters go through
  `URLSearchParams`.
  - `packages/registry-core/src/drivers/echo.ts`
- **Shard paths.** `repo:` shard files are read from disk at
  `<endpoint>/<region>[/<sector>].json`. Sector is two digits taken from
  validated codes. Region must match a strict region-code pattern, so a
  caller can't traverse out of the shard directory. The CLI also checks
  `--region` against the manifest.
  - `packages/registry-core/src/drivers/staticShard.ts`

All endpoints are read-only, so the worst case is a malformed query, not
data damage.

---

## Threat 3: CSV injection

**Severity:** Low. The CLI's `--csv` and the web app's exports write
registry-derived text that users open in spreadsheets.

**Mitigation:** every cell is double-quoted with embedded quotes doubled. A
cell starting with `=`, `+`, `-`, `@`, tab or CR gets a leading `'`.
- `packages/qualify/src/csv.ts`, tested in `tests/qualify/csv.test.ts`
- The browser-side "my list" export uses the same rules (`csvCell` in
  `apps/web/public/app.js`).

---

## Threat 4: Rate limits and IP bans

**Severity:** Low–Medium.

1. Concurrency limiters on every external source: Socrata 4, ECHO 2, DNS
   probes 4.
2. Jittered exponential backoff on 429/5xx (`fetchWithRetry`).
3. An optional Socrata app token sent as `X-App-Token`.
4. Bulk-only sources (PPP) are served from local shards, never queried per
   search.
- `packages/registry-core/src/util/http.ts`

---

## Threat 5: Privacy posture

**Severity:** Reputational.

- Contacts come from two places. One is what a registry publishes, plus a
  pattern email on a published domain with MX, always marked UNVERIFIED. The
  other is what a business published about itself on the web, found by
  searching the business name (ADR 0016), always labeled "verify" with its
  source. Nothing is guessed from names (ADR 0013).
- **Individuals.** PPP records include sole proprietors, and the Colorado
  farm-products financing list names individual farm debtors. These records
  are public by statute (SBA FOIA release; Food Security Act central filing,
  which exists so buyers can check liens). They are shown exactly as filed.
  The engine never looks up personal phones, emails or home addresses for
  them.
- Officers and agents are displayed in the CLI but never sent to the LLM.

---

## Threat 6: Data-integrity honesty

**Severity:** Product. Presenting weak evidence as strong misleads users.

Every limitation below is surfaced in the output, not hidden:
1. **Industry code ≠ capability.** A code says what a business is, not
   whether it can take a given job. The brief prompt requires saying so.
2. **PPP is a 2020–21 snapshot.** The "alive" line says whether the lead is
   confirmed by the state registry or a recent dated record, or should be
   confirmed by phone.
3. **Buyer leads fit by industry**, never by confirmed demand. A static
   caveat is attached to every sell-direction search.
4. **Name matches without a code** are counted separately in the summary
   and scored below coded matches.
5. **"No website"** means none is listed in the records searched, not that
   none exists. Each such lead gets a search link.
6. **Registered agent ≠ contact person.** SoS agent fields are often law
   firms or agent services. The CLI labels them "agent/principals".
7. **Name merges** require compatible locality (same zip or city), so
   same-named businesses in different towns stay separate.

---

## Threat 7: Web contact lookup (Exa / Parallel)

**Severity:** Medium. Third-party web pages now flow into results (ADR 0016).

**Mitigations:**
1. **Web text never reaches the LLM.** `extractContact` pattern-extracts
   only a website origin, a US phone and an email. The brief's packed lead
   line carries only those strings, never page text. The provider `summary`
   feature (which is model-generated) is not requested.
   - `packages/qualify/src/verbs/contacts.ts`, `packages/qualify/src/verbs/brief.ts`
2. **Wrong-business guard.** A page counts only if it matches the business
   name (≥60% of distinctive tokens) *and* its city or ZIP. Directory hosts
   are never taken as the website.
3. **Individuals are not searched.** PPP sole-proprietor or self-employed
   records and "LAST, FIRST" names are skipped (`isLikelyIndividual`).
4. **Cost and abuse.** Lookups run for the top N leads only, at concurrency
   3, with a 20 s timeout. Results are cached 30 days and failures aren't
   cached. API keys come from env vars only and are never logged.
5. **Provenance.** Every found value keeps its source URLs and is labeled
   "verify".

---

## Threat 8: Local web app (`apps/web`)

**Severity:** Medium. A local server that can spend LLM and web-search
credits is a target for other websites open in the same browser.

**Mitigations:**
1. Binds to 127.0.0.1 only.
2. **DNS-rebinding / cross-site guard.** Every request must carry
   `Host: localhost:<port>` or `127.0.0.1:<port>`, or it gets a 403. Searches
   require `Content-Type: application/json`, which forces a CORS preflight,
   and the server sends no CORS headers, so cross-origin pages can't trigger
   a search.
3. One search at a time (429 otherwise), with a 10 KB body cap and
   validated, length-capped fields.
4. **XSS.** All registry and web strings are rendered with `textContent`;
   `innerHTML` is never used with data. A strict CSP allows `'self'` only,
   with no inline script. Website links must parse as http(s), and `tel:` /
   `mailto:` values are sanitized.
5. Static files come from an exact whitelist, so no path is built from the
   URL.
- `apps/web/src/server.ts`, `apps/web/public/app.js`

---

## Changelog

- v1.0 (2026-07-07, Phase 0): Initial threat model.
- v1.4 (2026-07-07, Phase 4): Prompt-injection test suite; UCC fuzzy-match
  warning; digest CLI.
- v2.0 (2026-07-08, distillation): Query-driven pipeline; added SoQL
  injection threat.
- v2.1 (2026-07-18): Artifact app removed (ADR 0012); UI-only surfaces
  retired.
- v3.0 (2026-10-22, v5 / ADR 0015): Rewritten for the current code. The
  web-content injection surface is gone, while the request and registry text
  remain as injection surfaces. Added the ECHO URL and shard-path surfaces.
  CSV export is live again in the CLI. Added individuals in PPP and
  farm-financing records to the privacy policy, plus new integrity
  disclosures. Stale code pointers fixed (`soqlSafeLiteral` lives in
  `drivers/socrata.ts`; v2 `pipeline/verify.ts` no longer exists).
- v3.1 (2026-10-22, ADR 0016): Added Threat 7 (web contact lookup: no web
  text to the LLM, name+place match guard, individuals never searched,
  provenance) and Threat 8 (local web app: localhost bind, Host check, JSON
  content-type, one search at a time, textContent-only rendering, CSP).
  Privacy now allows contacts a business published about itself on the web.
- v3.2 (2026-10-22, Phase 6 audit): Fixed the CSV code pointer
  (`packages/qualify/src/csv.ts`) and listed the browser-side export.
  Individuals' records no longer get a name-search link, and their names are
  withheld from the LLM brief.
- v3.3 (2026-10-27, Phase 7c): recent-filings query (fetchRecent); date literal validated.
- v3.4 (2026-10-27): claude -p runs with no tools and no MCP servers; per-search token usage reported.

# Security Threat Model — Registry Engine

Version: 3.0 (v5, activity-coded discovery)
Last updated: 2026-10-22

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

---

## Threat 2: Query injection into government APIs

**Severity:** Medium. LLM-derived and user-derived values reach external
queries.

- **SoQL (Socrata).** Keywords, cities and names are interpolated into
  `LIKE` clauses. `soqlSafeLiteral` strips quotes, `%` and `_`, uppercases,
  and collapses whitespace. Keywords under 3 chars are dropped, and there are
  at most 8.
  - `packages/registry-core/src/drivers/socrata.ts`
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

**Severity:** Low. `--csv` writes registry-derived text that users open in
spreadsheets.

**Mitigation:** every cell is double-quoted with embedded quotes doubled. A
cell starting with `=`, `+`, `-`, `@`, tab or CR gets a leading `'`.
- `apps/cli/src/csv.ts`, tested in `tests/cli/csv.test.ts`

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

- Public records only. Contacts are only those a registry publishes. The one
  exception is a pattern email on a published domain with MX, always marked
  UNVERIFIED. Nothing is guessed from names (ADR 0013).
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

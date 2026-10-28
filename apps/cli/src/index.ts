import { writeFileSync } from "node:fs";
import { search, MAX_LLM_CALLS_PER_SEARCH, ClaudeCodeBackend, leadsToCsv, summaryLines, partitionLeads, SECONDS_PER_NAME, codeSourceIds, naicsFieldMap, isLikelyIndividual } from "@registry-engine/qualify";
import type { Lead, FoundContact } from "@registry-engine/qualify";
import { SOURCES, knownRegions, lookupCodes, naicsLabel, isNaicsCode } from "@registry-engine/registry-core";
import type { Entity } from "@registry-engine/registry-core";

const DEFAULT_LEADS = 12;   // the engine's default --leads

// Validation harness: the full pipeline, with LLM calls through the Claude
// Code CLI (headless) — subscription-billed, no API key.

// Flags that only make sense with a value; given bare, they are an error
// (otherwise "--csv" would write a file named "true").
const VALUE_FLAGS: Record<string, string> = {
  csv: "leads.csv", near: "80202", naics: "332312", model: "sonnet", region: "US-CO", shards: "http://localhost:8080",
};

function parseArgs(argv: string[]): { command: string; positional: string[]; flags: Record<string, string> } {
  const args = argv.slice(2);
  const command = args[0] ?? "help";
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (match !== null) {
      const name = match[1] ?? "";
      if ((match[2] === undefined || match[2] === "") && VALUE_FLAGS[name] !== undefined) {
        console.error(`--${name} needs a value (e.g. --${name}=${VALUE_FLAGS[name]})`);
        process.exit(1);
      }
      flags[name] = match[2] ?? "true";
    }
    else positional.push(arg);
  }
  return { command, positional, flags };
}

async function cmdSearch(positional: string[], flags: Record<string, string>): Promise<void> {
  const query = positional[0];
  if (query === undefined || query.trim().length === 0) {
    printHelp();
    process.exit(1);
  }

  // --shards=<base> points static_shard sources at a local server so the
  // full join can be validated before shards are published.
  const sources = flags["shards"] === undefined ? undefined : SOURCES.map(s =>
    s.driver === "static_shard" ? { ...s, endpoint: `${flags["shards"]}/${s.id}` } : s);

  if (flags["region"] !== undefined) {
    const valid = knownRegions(sources ?? SOURCES);
    if (!valid.includes(flags["region"])) {
      console.error(`unknown region "${flags["region"]}" — valid regions: ${valid.join(", ")}`);
      process.exit(1);
    }
  }

  const naics = flags["naics"] === undefined ? undefined
    : flags["naics"].split(",").map(c => c.trim()).filter(c => c.length > 0);
  const fail = (message: string): never => {
    console.error(message);
    process.exit(1);
  };
  const positiveInt = (name: string): number | undefined => {
    const raw = flags[name];
    if (raw === undefined) return undefined;
    if (!/^\d+$/.test(raw) || parseInt(raw, 10) < 1) return fail(`--${name} must be a positive whole number (got "${raw}")`);
    return parseInt(raw, 10);
  };
  const limit = positiveInt("limit");
  const leads = positiveInt("leads");
  let radiusMi: number | undefined;
  if (flags["radius"] !== undefined) {
    radiusMi = /^\d+(\.\d+)?$/.test(flags["radius"]) ? parseFloat(flags["radius"]) : NaN;
    if (!(radiusMi > 0)) fail(`--radius must be a positive number of miles (got "${flags["radius"]}")`);
  }
  if (naics !== undefined) {
    const bad = naics.filter(c => !isNaicsCode(c));
    if (naics.length === 0 || bad.length > 0) {
      fail(`--naics needs valid NAICS codes, comma-separated${bad.length > 0 ? ` (not a code: ${bad.join(", ")})` : ""} — run "codes <words>" to look them up`);
    }
  }
  const direction = flags["direction"];
  if (direction !== undefined && direction !== "buy" && direction !== "sell") {
    fail(`--direction must be buy (find suppliers) or sell (find buyers) (got "${direction}")`);
  }
  const fetchedCounts: string[] = [];

  const nearFlag = flags["near"] !== undefined && flags["near"] !== "true" ? flags["near"] : undefined;
  let mapRegion = "";
  const out = await search(query, {
    // omitting llm entirely puts the engine on its zero-token path
    ...(flags["no-llm"] === "true" ? {} : { llm: { backend: new ClaudeCodeBackend(flags["model"]) } }),
    sources,
    region: flags["region"],
    limit,
    maxLeads: leads,
    naics,
    direction: direction === "buy" || direction === "sell" ? direction : undefined,
    backfillAll: flags["check-all"] === "true",
    near: nearFlag,
    radiusMi,
    ...(flags["no-contacts"] === "true" ? { contacts: null } : {}),
    onEvent: event => {
      switch (event.type) {
        case "map":
          console.log(`map     ${JSON.stringify(event.map.intent)} keywords=[${event.map.keywords.join(",")}] llm=${event.map.usedLlm ? "1 call" : "static"}`);
          console.log(`        via=${event.map.via}${event.map.directionFixed ? " (direction fixed by --direction)" : ""}`);
          console.log(`        lead codes: ${event.map.intent.naics.map(c => `${c} ${naicsLabel(c) ?? ""}`.trim()).join("; ") || "none"}`);
          for (const c of event.map.caveats) console.log(`        ⚠ ${c}`);
          if (event.map.llmError !== undefined) console.log(`        ⚠ AI step failed: ${event.map.llmError} — results use the static table/codes and template briefs`);
          mapRegion = event.map.intent.geo.region;
          break;
        case "origin":
          console.log(event.origin === null
            ? (nearFlag !== undefined
              ? `origin  couldn't find "${nearFlag}" in ${flags["region"] ?? mapRegion} — results not grouped by distance`
              : "origin  none — results not grouped by distance")
            : `origin  ${event.origin.label}`);
          break;
        case "routed":
          console.log(`route   ${event.sources.map(s => `${s.id}(${s.plane})`).join(" + ") || "no sources for this category∩geo"}`);
          break;
        case "fetched":
          fetchedCounts.push(`${event.sourceId} ${event.count}${event.capped ? "+ (capped)" : ""}`);
          console.log(`fetch   ${event.sourceId}: ${event.capped ? `${event.count}+ records (capped)` : `${event.count} records`}`);
          break;
        case "source_error":
          console.error(`fetch   ${event.sourceId} ERROR: ${event.message}`);
          break;
        case "merged":
          console.log(`merge   ${event.count} entities`);
          break;
        case "backfilled":
          console.log(`backfill ${event.sourceId}: ${event.count} matched by name`);
          break;
        case "backfill_progress":
          console.log(`backfill ${event.sourceId}: ${event.checked}/${event.total} names`);
          break;
        case "probed":
          console.log(`probe   ${event.count} entities checked (DNS A+MX)`);
          break;
        case "recent":
          console.log(`recent  ${event.count} registered in the last 90 days nearby`);
          break;
        case "contacts":
          console.log(`contacts ${event.provider}: ${event.looked} looked up, ${event.found} found`);
          break;
        default:
          break;
      }
    },
  });

  // Diagnostics only: the rejected map answer is untrusted model text, shown
  // as-is (control characters already replaced) and never reused.
  if (out.mapRawAnswer !== null) {
    if (flags["verbose"] === "true") {
      console.log(`map raw answer (unusable, ${out.mapRawAnswer.length} chars shown):\n${out.mapRawAnswer.split("\n").map(l => `  | ${l}`).join("\n")}`);
    } else {
      console.log("map     the AI answer couldn't be used; run with --verbose to see it");
    }
  }

  const existenceIds = out.routed.filter(r => r.plane === "existence").map(r => r.id);
  const naicsFields = naicsFieldMap(out.routed);
  const lookup = out.registryLookup;
  const checkedNames = lookup.status === "ran" ? lookup.namesChecked : 0;
  console.log(`\n${"═".repeat(64)}`);
  for (const line of summaryLines(out.ranked, out.map.intent.naics)) console.log(line);
  if (lookup.status === "ran" && lookup.totalNames > 0) {
    const total = lookup.totalNames.toLocaleString("en-US");
    if (lookup.namesChecked < lookup.totalNames) {
      const secs = lookup.totalNames * SECONDS_PER_NAME;
      const estimate = secs < 60 ? "under a minute" : `about ${Math.ceil(secs / 60)} min`;
      console.log(`Checked ${lookup.namesChecked.toLocaleString("en-US")} of ${total} names against the state registry (--check-all checks every name, ${estimate})`);
    } else {
      console.log(`Checked all ${total} names against the state registry`);
    }
  }
  if (out.contactLookups !== null) {
    const c = out.contactLookups;
    console.log(`Contact lookups: ${c.looked} via ${c.provider}, ${c.found} found, ~$${c.costDollars.toFixed(2)}`);
  } else if (flags["no-contacts"] !== "true") {
    console.log("Contact lookups: off — set EXA_API_KEY or PARALLEL_API_KEY to find websites and phones for the top leads.");
  }
  // The web app's split: coded businesses, then individuals' records (shown
  // as filed: no search link, no maps link), then a count of name matches.
  const groups = partitionLeads(out.ranked, out.map.intent.naics);
  const shown = groups.businesses.slice(0, leads ?? DEFAULT_LEADS);
  console.log(`Showing ${shown.length} | fetched: ${fetchedCounts.join(", ") || "no sources"} | LLM calls: ${out.llmCalls}/${MAX_LLM_CALLS_PER_SEARCH}${out.map.llmError !== undefined ? " (the AI step failed; see the warning above)" : ""}${out.llmUsage === null ? "\n" : ""}`);
  if (out.llmUsage !== null) {
    const u = out.llmUsage;
    const byLabel = (label: string) => u.calls.filter(k => k.label === label).reduce((n, k) => n + k.inputTokens + k.outputTokens, 0);
    const cost = u.costUsd !== null ? ` · ~$${u.costUsd.toFixed(4)} at API prices` : "";
    console.log(`AI tokens: ${u.inputTokens.toLocaleString()} in / ${u.outputTokens.toLocaleString()} out (map ${byLabel("map").toLocaleString()}, brief ${byLabel("brief").toLocaleString()})${cost} — billed to your Claude subscription via claude -p\n`);
  }
  let band = "";
  shown.forEach((lead, i) => {
    if (lead.band !== "" && lead.band !== band) {
      band = lead.band;
      console.log(`── ${band} ──\n`);
    }
    printLead(lead, i + 1, existenceIds, naicsFields, flags["verbose"] === "true", checkedNames);
  });

  if (groups.individuals.length > 0) {
    console.log(`── Individuals' records (shown as filed) · ${groups.individuals.length} ──`);
    console.log("   Sole proprietors and others filed under a person's name. No web search, no map link.\n");
    const cap = leads ?? DEFAULT_LEADS;
    for (const lead of groups.individuals.slice(0, cap)) printIndividual(lead, existenceIds, checkedNames);
    if (groups.individuals.length > cap) console.log(`   (${groups.individuals.length - cap} more in the CSV)\n`);
  }
  if (groups.nameOnly.length > 0) {
    console.log(`── Name matches only: ${groups.nameOnly.length} (no industry code for this work; in the CSV) ──\n`);
  }

  if (out.recent.length > 0 && out.recentWindow !== null) {
    console.log(`── Recently registered within ${out.recentWindow.radiusMi} mi (last ${out.recentWindow.days} days; name matches, no industry code) ──`);
    for (const lead of out.recent.slice(0, 10)) {
      const e = lead.entity;
      const place = [e.address.city, e.address.zip].filter(v => v !== undefined && v !== "").join(" ");
      console.log(`  ${e.name} — ${place} · ${lead.distanceMi} mi · registered ${e.formedDate ?? ""}`);
    }
    console.log();
  }

  if (flags["csv"] !== undefined && flags["csv"] !== "true") {
    writeFileSync(flags["csv"], leadsToCsv(out.ranked, existenceIds));
    console.log(`wrote ${out.ranked.length} leads to ${flags["csv"]}`);
  }
}

// Same tri-state wording as the web app's trust pills.
function aliveText(lead: Lead, existenceIds: string[], checkedNames: number): string {
  const e = lead.entity;
  if (existenceIds.length === 0) return "";
  const check = lead.registryCheck ?? (e.source_ids.some(id => existenceIds.includes(id)) ? "matched" : "not_checked");
  if (check === "matched") return `on state registry · ${e.status !== "" ? e.status : "listed"} ✓`;
  if (check === "inactive") {
    const st = lead.registryStanding;
    return `on state registry as ${st?.status ?? "inactive"}${st?.since ? ` (${st.since})` : ""}, not in good standing`;
  }
  if (check === "checked_not_found") {
    return lead.registeredElsewhere === true ? "not on state registry at this address (a same-named record is elsewhere)" : "not on state registry";
  }
  return checkedNames > 0 ? `not checked against registry (beyond the ${checkedNames} names checked this search)` : "not checked against registry";
}

function printLead(lead: Lead, rank: number, existenceIds: string[], naicsFields: Record<string, string>, verbose: boolean, checkedNames: number): void {
  const e = lead.entity;
  const place = [e.address.city, e.address.zip].filter(v => v !== undefined && v !== "").join(" ");
  const head = [place, e.employees !== undefined ? `${e.employees} ${e.employees === 1 ? "job" : "jobs"}` : ""].filter(Boolean).join(" · ");
  console.log(`${String(rank).padStart(2)}. [${String(lead.score).padStart(3)}] ${e.name}${head !== "" ? ` — ${head}` : ""}${lead.distanceMi !== null ? ` · ${lead.distanceMi} mi` : ""}`);

  const codes = e.naics.slice(0, 2).map(c => `${c} ${naicsLabel(c) ?? ""}`.trim()).join(", ");
  const codeSrc = codeSourceIds(e, naicsFields);
  console.log(`      what   ${codes !== ""
    ? `${codes}${codeSrc.length > 0 ? ` per ${codeSrc.join(" + ")}` : ""}`
    : `name match only · ${e.source_ids.join(" + ")}`}`);

  const alive = [
    aliveText(lead, existenceIds, checkedNames),
    e.lastSeen !== undefined ? `last record ${e.lastSeen}` : "no dated record",
  ].filter(Boolean).join(" · ");
  console.log(`      alive  ${alive}`);

  console.log(`      reach  ${e.contacts.length > 0 ? e.contacts.join(" · ") : "no phone/email on record"}`);

  const street = e.address.street !== undefined && e.address.street !== "" ? e.address.street : "";
  const cityLine = [e.address.city, e.address.state, e.address.zip].filter(v => v !== undefined && v !== "").join(" ");
  const address = [street, cityLine].filter(Boolean).join(", ");
  const where = [address, e.officers.length > 0 ? `agent/principals: ${e.officers.join("; ")}` : ""].filter(Boolean).join(" · ");
  if (where !== "") console.log(`      where  ${where}`);

  const web = lead.web === "verified"
    ? `domain ✓${lead.probe?.domain != null ? ` ${lead.probe.domain}` : ""}`
    : lead.web === "unresolved"
      ? `published domain did not resolve → ${lead.searchUrl ?? ""}`
      : lead.searchUrl === null && isLikelyIndividual(e)
        ? "Individual's record — no web search offered"
        : `search → ${lead.searchUrl ?? ""}`;
  console.log(`      web    ${web}`);
  if (lead.found !== undefined) console.log(`      found   ${foundLine(lead.found)}`);
  if (lead.brief !== "") console.log(`      brief  ${lead.brief}`);
  if (lead.opener !== "") console.log(`      say    "${lead.opener}"`);
  if (verbose) printEvidence(e);
  console.log();
}

// An individual's record, shown as filed: what the record says and where it
// was filed, with no web search, no map link and no principal lookup.
function printIndividual(lead: Lead, existenceIds: string[], checkedNames: number): void {
  const e = lead.entity;
  const place = [e.address.city, e.address.zip].filter(v => v !== undefined && v !== "").join(" ");
  console.log(`   ${e.name}${place !== "" ? ` — ${place}` : ""}${lead.distanceMi !== null ? ` · ${lead.distanceMi} mi` : ""}`);
  const codes = e.naics.slice(0, 2).map(c => `${c} ${naicsLabel(c) ?? ""}`.trim()).join(", ");
  if (codes !== "") console.log(`      what   ${codes}`);
  const alive = aliveText(lead, existenceIds, checkedNames);
  if (alive !== "") console.log(`      alive  ${alive}`);
  const address = [e.address.street, e.address.city, e.address.state, e.address.zip].filter(v => v !== undefined && v !== "").join(" ");
  if (address !== "") console.log(`      filed  ${address}`);
  if (e.contacts.length > 0) console.log(`      reach  ${e.contacts.join(" · ")} (as filed)`);
  console.log();
}

// One line for a web-search contact lookup. Always labelled "verify": the
// values come from web pages, not from a registry.
function foundLine(f: FoundContact): string {
  if (f.status === "skipped") return "not searched (individual's record)";
  const parts = [f.phone, f.email, f.website].filter((v): v is string => v !== undefined && v !== "");
  if (parts.length > 0) return `${parts.join(" · ")}  (via ${f.provider}, verify)`;
  if (f.listings.length > 0) return `listed on ${f.listings.join(", ")} (via ${f.provider})`;
  if (f.reason !== undefined) return `${f.reason} (via ${f.provider})`;
  return "web search found nothing — likely no web presence";
}

function printEvidence(e: Entity): void {
  for (const ev of e.evidence) console.log(`      · [${ev.source}] ${ev.field}=${ev.value}${ev.note ? ` (${ev.note})` : ""}`);
}

// Look up NAICS codes by words in the Census index ("codes metal fabrication").
function cmdCodes(positional: string[]): void {
  const words = positional.flatMap(p => p.toLowerCase().split(/\s+/)).filter(Boolean);
  if (words.length === 0) {
    printHelp();
    process.exit(1);
  }
  const lines = lookupCodes(words).map(r => `${r.code}  ${r.title}  — ${r.description}`);
  console.log(lines.length > 0 ? lines.join("\n") : `no NAICS index entry contains all of: ${words.join(" ")}`);
}

function printHelp(): void {
  console.log(`Registry Engine CLI — map → route → fetch → probe → brief

Usage:
  search "someone to sew 500 tote bags near denver" [flags]
  search "who would buy my hot sauce in boulder" [flags]
  codes <words>        look up NAICS codes by words, e.g. codes metal fabrication
                       (use them with --naics=<codes>)

Buyer searches ("who would buy my ...") need the LLM path (drop --no-llm) or
--naics=<buyer industry codes>; without either they return no leads.
--direction=sell sets the direction without relying on wording.

Flags:
  --limit=<n>   per-source fetch cap
  --leads=<n>   max briefed leads (default 12)
  --model=<m>   claude CLI model override for headless calls
  --no-llm      run the zero-token path only (static map + template briefs)
  --region=<US-XX>  region to search (default: first region in the source manifest)
  --naics=<c1,c2>   NAICS codes of the businesses to contact (skips the map LLM call)
  --near=<zip|place>  measure distance from this ZIP or place (default: the city named in the
                      query); the whole region is searched and leads are grouped by distance
  --radius=<miles>    drop leads farther than this from the origin
  --no-contacts       skip the web contact lookup (otherwise on when EXA_API_KEY or
                      PARALLEL_API_KEY is set; at most one web search per briefed lead)
  --direction=buy|sell  buy = find suppliers, sell = find buyers (default: guessed from the request)
  --check-all   check every coded lead's name against the state registry (slower;
                default: at most 80 names per search)
  --csv=<path>  write every ranked lead to a CSV file
  --verbose     print the evidence lines under each lead

LLM calls (max ${MAX_LLM_CALLS_PER_SEARCH}/search) run through the Claude Code CLI
(claude -p) and bill your subscription — no API key needed.
`);
}

async function main(): Promise<void> {
  const { command, positional, flags } = parseArgs(process.argv);
  try {
    if (command === "search") await cmdSearch(positional, flags);
    else if (command === "codes") cmdCodes(positional);
    else if (command === "help") printHelp();
    else {
      printHelp();
      process.exit(2);
    }
  } catch (err) {
    console.error("Error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

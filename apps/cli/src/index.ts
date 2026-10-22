import { writeFileSync } from "node:fs";
import { search, MAX_LLM_CALLS_PER_SEARCH } from "@registry-engine/qualify";
import type { Lead } from "@registry-engine/qualify";
import { SOURCES, knownRegions, naicsIndex, naicsLabel } from "@registry-engine/registry-core";
import type { Entity } from "@registry-engine/registry-core";
import { ClaudeCodeBackend } from "./claudeCodeBackend.js";
import { leadsToCsv } from "./csv.js";
import { summaryLines } from "./summary.js";

const MAX_CODE_RESULTS = 15;

// Validation harness: the full pipeline, with LLM calls through the Claude
// Code CLI (headless) — subscription-billed, no API key.

function parseArgs(argv: string[]): { command: string; positional: string[]; flags: Record<string, string> } {
  const args = argv.slice(2);
  const command = args[0] ?? "help";
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (match !== null) flags[match[1] ?? ""] = match[2] ?? "true";
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
  const fetchedCounts: string[] = [];

  const out = await search(query, {
    // omitting llm entirely puts the engine on its zero-token path
    ...(flags["no-llm"] === "true" ? {} : { llm: { backend: new ClaudeCodeBackend(flags["model"]) } }),
    sources,
    region: flags["region"],
    limit: flags["limit"] !== undefined ? parseInt(flags["limit"], 10) : undefined,
    maxLeads: flags["leads"] !== undefined ? parseInt(flags["leads"], 10) : undefined,
    naics,
    hiddenOnly: flags["hidden"] === "true",
    onEvent: event => {
      switch (event.type) {
        case "map":
          console.log(`map     ${JSON.stringify(event.map.intent)} keywords=[${event.map.keywords.join(",")}] llm=${event.map.usedLlm ? "1 call" : "static"}`);
          console.log(`        via=${event.map.via}`);
          console.log(`        lead codes: ${event.map.intent.naics.map(c => `${c} ${naicsLabel(c) ?? ""}`.trim()).join("; ") || "none"}`);
          for (const c of event.map.caveats) console.log(`        ⚠ ${c}`);
          break;
        case "routed":
          console.log(`route   ${event.sources.map(s => `${s.id}(${s.plane})`).join(" + ") || "no sources for this category∩geo"}`);
          break;
        case "fetched":
          fetchedCounts.push(`${event.sourceId} ${event.count}`);
          console.log(`fetch   ${event.sourceId}: ${event.count} records`);
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
        case "probed":
          console.log(`probe   ${event.count} entities checked (DNS A+MX)`);
          break;
        default:
          break;
      }
    },
  });

  const existenceIds = out.routed.filter(r => r.plane === "existence").map(r => r.id);
  console.log(`\n${"═".repeat(64)}`);
  for (const line of summaryLines(out.ranked, out.map.intent.naics)) console.log(line);
  console.log(`Showing ${out.leads.length} | fetched: ${fetchedCounts.join(", ") || "no sources"} | LLM calls: ${out.llmCalls}/${MAX_LLM_CALLS_PER_SEARCH}\n`);
  out.leads.forEach((lead, i) => printLead(lead, i + 1, existenceIds, flags["verbose"] === "true"));

  if (flags["csv"] !== undefined && flags["csv"] !== "true") {
    writeFileSync(flags["csv"], leadsToCsv(out.ranked, existenceIds));
    console.log(`wrote ${out.ranked.length} leads to ${flags["csv"]}`);
  }
}

function printLead(lead: Lead, rank: number, existenceIds: string[], verbose: boolean): void {
  const e = lead.entity;
  const place = [e.address.city, e.address.zip].filter(v => v !== undefined && v !== "").join(" ");
  const head = [place, e.employees !== undefined ? `${e.employees} jobs` : ""].filter(Boolean).join(" · ");
  console.log(`${String(rank).padStart(2)}. [${String(lead.score).padStart(3)}] ${e.name}${head !== "" ? ` — ${head}` : ""}`);

  const codes = e.naics.slice(0, 2).map(c => `${c} ${naicsLabel(c) ?? ""}`.trim()).join(", ");
  console.log(`      what   ${[codes || "name match only", e.source_ids.join(" + ")].join(" · ")}`);

  const alive = [
    existenceIds.length === 0 ? "" : e.source_ids.some(id => existenceIds.includes(id)) ? "on state registry ✓" : "not matched on state registry",
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
      : `none listed in these records → ${lead.searchUrl ?? ""}`;
  console.log(`      web    ${web}`);
  if (lead.brief !== "") console.log(`      brief  ${lead.brief}`);
  if (lead.opener !== "") console.log(`      say    "${lead.opener}"`);
  if (verbose) printEvidence(e);
  console.log();
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
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const [code, description] of naicsIndex()) {
    if (seen.has(code)) continue;
    const text = description.toLowerCase();
    if (!words.every(w => text.includes(w))) continue;
    seen.add(code);
    lines.push(`${code}  ${naicsLabel(code) ?? ""}  — ${description}`);
    if (lines.length >= MAX_CODE_RESULTS) break;
  }
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

Flags:
  --limit=<n>   per-source fetch cap
  --leads=<n>   max briefed leads (default 12)
  --model=<m>   claude CLI model override for headless calls
  --no-llm      run the zero-token path only (static map + template briefs)
  --region=<US-XX>  region to search (default: first region in the source manifest)
  --naics=<c1,c2>   NAICS codes of the businesses to contact (skips the map LLM call)
  --hidden      only leads with no website on any public record
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
    else printHelp();
  } catch (err) {
    console.error("Error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

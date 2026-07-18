import { search, MAX_LLM_CALLS_PER_SEARCH } from "@registry-engine/qualify";
import { ClaudeCodeBackend } from "./claudeCodeBackend.js";

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
  const sources = flags["shards"] === undefined ? undefined : (await import("@registry-engine/registry-core")).SOURCES.map(s =>
    s.driver === "static_shard" ? { ...s, endpoint: `${flags["shards"]}/${s.id}` } : s);

  const out = await search(query, {
    // omitting llm entirely puts the engine on its zero-token path
    ...(flags["no-llm"] === "true" ? {} : { llm: { backend: new ClaudeCodeBackend(flags["model"]) } }),
    sources,
    limit: flags["limit"] !== undefined ? parseInt(flags["limit"], 10) : undefined,
    maxLeads: flags["leads"] !== undefined ? parseInt(flags["leads"], 10) : undefined,
    onEvent: event => {
      switch (event.type) {
        case "map":
          console.log(`map     ${JSON.stringify(event.map.intent)} keywords=[${event.map.keywords.join(",")}] llm=${event.map.usedLlm ? "1 call" : "static"}`);
          for (const c of event.map.caveats) console.log(`        ⚠ ${c}`);
          break;
        case "routed":
          console.log(`route   ${event.sources.map(s => `${s.id}(${s.plane})`).join(" + ") || "no sources for this category∩geo"}`);
          break;
        case "fetched":
          console.log(`fetch   ${event.sourceId}: ${event.count} records`);
          break;
        case "source_error":
          console.error(`fetch   ${event.sourceId} ERROR: ${event.message}`);
          break;
        case "merged":
          console.log(`merge   ${event.count} entities`);
          break;
        case "probed":
          console.log(`probe   ${event.count} entities checked (DNS A+MX)`);
          break;
        default:
          break;
      }
    },
  });

  console.log(`\n${"═".repeat(64)}`);
  console.log(`${out.leads.length} leads | LLM calls: ${out.llmCalls}/${MAX_LLM_CALLS_PER_SEARCH}\n`);
  for (const lead of out.leads) {
    const e = lead.entity;
    console.log(`[${String(lead.score).padStart(3)}] ${e.name}  (${[e.address.city, e.source_ids.join("+")].filter(Boolean).join(" · ")})`);
    if (e.contacts.length > 0) console.log(`      contact: ${e.contacts.join(" · ")}`);
    console.log(`      ${lead.brief}`);
    for (const ev of e.evidence) console.log(`      · [${ev.source}] ${ev.field}=${ev.value}${ev.note ? ` (${ev.note})` : ""}`);
    console.log();
  }
}

function printHelp(): void {
  console.log(`Registry Engine CLI — map → route → fetch → probe → brief

Usage:
  search "yukon gold potato supplier near me" [--limit=100] [--leads=12] [--model=sonnet] [--no-llm]

Flags:
  --limit=<n>   per-source fetch cap
  --leads=<n>   max briefed leads (default 12)
  --model=<m>   claude CLI model override for headless calls
  --no-llm      run the zero-token path only (static map + template briefs)

LLM calls (max ${MAX_LLM_CALLS_PER_SEARCH}/search) run through the Claude Code CLI
(claude -p) and bill your subscription — no API key needed.
`);
}

async function main(): Promise<void> {
  const { command, positional, flags } = parseArgs(process.argv);
  try {
    if (command === "search") await cmdSearch(positional, flags);
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

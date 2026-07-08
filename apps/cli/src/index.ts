import { ColoradoRegistrySource, resolveAddress, MemoryCache } from "@registry-engine/registry-core";
import type { LocationQuery, EntityFilters } from "@registry-engine/registry-core";
import { TokenBudgeter, runSearch, assembleBrief } from "@registry-engine/qualify";
import { ClaudeCodeBackend } from "./claudeCodeBackend.js";

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
      flags[match[1] ?? ""] = match[2] ?? "true";
    } else {
      positional.push(arg);
    }
  }
  return { command, positional, flags };
}

async function buildLocation(flags: Record<string, string>): Promise<LocationQuery> {
  if (flags["zips"] !== undefined) {
    return { mode: "zip", zips: flags["zips"].split(",").map(z => z.trim()).filter(Boolean) };
  }
  if (flags["city"] !== undefined) {
    const state = flags["state"] ?? "CO";
    const coords = await resolveAddress(`${flags["city"]}, ${state}`);
    if (coords === null) {
      console.error(`Error: could not geocode "${flags["city"]}, ${state}"`);
      process.exit(1);
    }
    const radiusKm = flags["radius"] !== undefined ? parseFloat(flags["radius"]) : 15;
    console.log(`${flags["city"]}, ${state} → ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)} (radius ${radiusKm}km)`);
    return { mode: "radius", lat: coords.lat, lng: coords.lng, radiusMeters: radiusKm * 1000 };
  }
  if (flags["lat"] !== undefined && flags["lng"] !== undefined) {
    const radiusKm = flags["radius"] !== undefined ? parseFloat(flags["radius"]) : 15;
    return {
      mode: "radius",
      lat: parseFloat(flags["lat"]),
      lng: parseFloat(flags["lng"]),
      radiusMeters: radiusKm * 1000,
    };
  }
  console.error("Error: provide --city=<name> (with optional --radius=<km>) or --zips=<z1,z2>");
  process.exit(1);
}

// The validation harness: runs the exact pipeline the artifact runs, printing
// events as they stream. LLM calls go through the Claude Code CLI (headless),
// billing the user's subscription — no API key required.
async function cmdSearch(positional: string[], flags: Record<string, string>): Promise<void> {
  const query = positional[0];
  if (query === undefined || query.trim().length === 0) {
    console.error('Usage: search "<what you are looking for>" --city=Denver [--radius=15] [--verify=10]');
    process.exit(1);
  }

  const location = await buildLocation(flags);
  const source = new ColoradoRegistrySource();
  const backend = new ClaudeCodeBackend(flags["model"] ?? "sonnet");
  // Headless claude -p carries Claude Code's own system prompt (~15k tokens
  // per call), so raw counts run high. This is subscription usage, not API
  // dollars — the cap is a runaway guard, not a cost control.
  const budgeter = new TokenBudgeter(backend, { maxInputTokensPerRun: 2_000_000 });
  const autoVerify = flags["verify"] !== undefined ? parseInt(flags["verify"], 10) : 10;

  console.log(`\nSearching: "${query}"\n`);

  const leads = await runSearch({
    query,
    source,
    location,
    budgeter,
    cache: new MemoryCache(),
    autoVerify,
    onEvent: event => {
      switch (event.type) {
        case "intent":
          console.log(`Keywords: ${event.intent.keywords.join(", ")}${event.intent.exclusions.length > 0 ? ` | excluding: ${event.intent.exclusions.join(", ")}` : ""}`);
          console.log(`Verifying: ${event.intent.requirement}\n`);
          break;
        case "lead":
          console.log(`  • ${event.lead.entity.name} — ${event.lead.entity.city} (pending verification)`);
          break;
        case "update":
          if (event.lead.verified) {
            console.log(`  ✓ ${event.lead.score}/100 ${event.lead.entity.name} [web: ${event.lead.webPresence}] ${event.lead.rationale}`);
          } else {
            console.log(`  ✗ ${event.lead.entity.name} — ${event.lead.rationale}`);
          }
          break;
        case "error":
          console.error(`  ! ${event.message}`);
          break;
        default:
          break;
      }
    },
  });

  const verified = leads.filter(l => l.verified);
  console.log(`\n${"═".repeat(60)}`);
  console.log(`${leads.length} leads (${verified.length} verified) | tokens: ${budgeter.totals.input} in / ${budgeter.totals.output} out\n`);

  for (const lead of verified.filter(l => l.score >= 40)) {
    console.log(assembleBrief(lead).text);
    console.log();
  }
}

async function cmdEntities(flags: Record<string, string>): Promise<void> {
  const location = await buildLocation(flags);
  const filters: EntityFilters = { status: flags["status"] ?? "Good Standing" };
  const source = new ColoradoRegistrySource();
  let count = 0;
  for await (const entity of source.fetchEntities(location, filters)) {
    const tradeNameStr = entity.tradeNames.length > 0
      ? ` [DBA: ${entity.tradeNames.map(t => t.description).join(", ")}]`
      : "";
    console.log(`${entity.name}${tradeNameStr} | ${entity.zipCode} | formed: ${entity.formDate.slice(0, 10)}`);
    count++;
  }
  console.log(`\nTotal: ${count} entities`);
}

function printHelp(): void {
  console.log(`Registry Engine CLI

Usage:
  search "jewelers that use princess cut diamonds" --city=Denver [--radius=15] [--verify=10]
  search "produce wholesalers" --zips=80202,80203
  entities --city=Denver --radius=5          (raw registry dump, no LLM)

Flags:
  --city=<name>     city center (geocoded); --state defaults to CO
  --radius=<km>     radius around the city center (default 15)
  --zips=<z1,z2>    explicit zip list instead of city/radius
  --verify=<n>      how many leads to web-verify (default 10)
  --model=<m>       claude model for headless calls (default sonnet)

LLM calls run through the Claude Code CLI (claude -p) and bill your
subscription — no API key needed.
`);
}

async function main(): Promise<void> {
  const { command, positional, flags } = parseArgs(process.argv);

  try {
    switch (command) {
      case "search":
        await cmdSearch(positional, flags);
        break;
      case "entities":
        await cmdEntities(flags);
        break;
      default:
        printHelp();
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

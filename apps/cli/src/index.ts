import { ColoradoRegistrySource, fetchVitality } from "@registry-engine/registry-core";
import type { LocationQuery, EntityFilters } from "@registry-engine/registry-core";

function parseArgs(argv: string[]): { command: string; flags: Record<string, string> } {
  const args = argv.slice(2);
  const command = args[0] ?? "help";
  const flags: Record<string, string> = {};
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (match !== null) {
      const key = match[1] ?? "";
      const value = match[2] ?? "true";
      flags[key] = value;
    }
  }
  return { command, flags };
}

function buildLocationQuery(flags: Record<string, string>): LocationQuery {
  if (flags["lat"] !== undefined && flags["lng"] !== undefined) {
    const lat = parseFloat(flags["lat"]);
    const lng = parseFloat(flags["lng"]);
    const radiusMeters = flags["radius"] !== undefined ? parseFloat(flags["radius"]) : 8000;
    return { mode: "radius", lat, lng, radiusMeters };
  }
  const zips = flags["zips"] !== undefined ? flags["zips"].split(",").map(z => z.trim()) : [];
  return { mode: "zip", zips };
}

async function cmdEntities(flags: Record<string, string>): Promise<void> {
  const query = buildLocationQuery(flags);
  const filters: EntityFilters = {
    status: flags["status"] ?? "Good Standing",
  };
  const source = new ColoradoRegistrySource();
  let count = 0;
  for await (const entity of source.fetchEntities(query, filters)) {
    const tradeNameStr = entity.tradeNames.length > 0
      ? ` [DBA: ${entity.tradeNames.map(t => t.description).join(", ")}]`
      : "";
    console.log(`${entity.name}${tradeNameStr} | ${entity.zipCode} | ${entity.status} | formed: ${entity.formDate.slice(0, 10)}`);
    count++;
  }
  console.log(`\nTotal: ${count} entities`);
}

async function cmdTriggers(flags: Record<string, string>): Promise<void> {
  const query = buildLocationQuery(flags);
  const windowDays = flags["days"] !== undefined ? parseInt(flags["days"], 10) : 90;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);

  const filters: EntityFilters = {
    status: "Good Standing",
    formDateAfter: cutoff.toISOString(),
  };

  const source = new ColoradoRegistrySource();
  const entityIds: string[] = [];
  const entityMap = new Map<string, string>();

  console.log(`Fetching entities formed in last ${windowDays} days...`);
  for await (const entity of source.fetchEntities(query, filters)) {
    entityIds.push(entity.id);
    entityMap.set(entity.id, entity.name);
    const daysAgo = Math.round((Date.now() - new Date(entity.formDate).getTime()) / 86400000);
    console.log(`NEW_FILING | ${entity.name} | formed ${daysAgo}d ago | ${entity.zipCode}`);
  }

  if (entityIds.length > 0) {
    console.log(`\nFetching status-change signals for ${entityIds.length} entities...`);
    const signals = await source.fetchSignals(entityIds, windowDays);
    for (const signal of signals) {
      console.log(`${signal.type} | ${signal.entityName} | ${signal.date.slice(0, 10)} | ${signal.summary}`);
    }
    if (signals.length === 0) {
      console.log("No additional status-change signals found.");
    }
  }
}

async function cmdVitality(flags: Record<string, string>): Promise<void> {
  const zips = flags["zips"] !== undefined ? flags["zips"].split(",").map(z => z.trim()) : [];
  const keywords = flags["keywords"] !== undefined ? flags["keywords"].split(",").map(k => k.trim()) : ["LLC", "INC"];

  if (zips.length === 0) {
    console.error("Error: --zips is required for vitality command");
    process.exit(1);
  }

  console.log(`Fetching vitality data for ${zips.length} zip(s) x ${keywords.length} keyword(s)...`);
  const rows = await fetchVitality(zips, keywords);

  // Print table header
  console.log("\nzip\t\tkeyword\t\t\tf90d\tdis90d\tf365d\tdis365d");
  console.log("-".repeat(72));
  for (const row of rows) {
    console.log(
      `${row.zipCode}\t\t${row.keyword.padEnd(16)}\t${row.formations90d}\t${row.dissolutions90d}\t${row.formations365d}\t${row.dissolutions365d}`
    );
  }
}

function printHelp(): void {
  console.log(`Registry Engine CLI

Usage:
  node src/index.ts entities --zips=80202,80203 [--status="Good Standing"]
  node src/index.ts entities --lat=39.7392 --lng=-104.9903 --radius=8000
  node src/index.ts triggers --zips=80202,80203 [--days=90]
  node src/index.ts vitality --zips=80202,80203 --keywords=jeweler,jewelry
`);
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv);

  try {
    switch (command) {
      case "entities":
        await cmdEntities(flags);
        break;
      case "triggers":
        await cmdTriggers(flags);
        break;
      case "vitality":
        await cmdVitality(flags);
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

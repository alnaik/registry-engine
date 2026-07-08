// Generates a zip-centroid table for a state from the Census ZCTA gazetteer.
// This is the per-state recipe: every new RegistrySource adapter gets its
// centroid table from this script, never hand-curated.
//
// Usage:
//   node scripts/gen-centroids.mjs --prefixes 80,81 --state CO \
//     --out packages/registry-core/src/location/zipCentroids.ts
//
// ZCTA gazetteer has no state column; states are selected by their 3-digit
// zip prefix ranges (CO = 800-816, i.e. prefixes 80,81).

import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GAZETTEER_URL =
  "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_zcta_national.zip";

function parseArgs(argv) {
  const flags = {};
  for (const arg of argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) flags[m[1]] = m[2];
  }
  return flags;
}

const flags = parseArgs(process.argv);
const prefixes = (flags.prefixes ?? "").split(",").map(p => p.trim()).filter(Boolean);
const state = flags.state ?? "??";
const outPath = flags.out;

if (prefixes.length === 0 || !outPath) {
  console.error("Usage: node scripts/gen-centroids.mjs --prefixes=80,81 --state=CO --out=<path>");
  process.exit(1);
}

const workDir = join(tmpdir(), "registry-engine-gazetteer");
const txtPath = join(workDir, "2023_Gaz_zcta_national.txt");

if (!existsSync(txtPath)) {
  console.log("Downloading Census ZCTA gazetteer...");
  execSync(`mkdir -p "${workDir}" && curl -sL "${GAZETTEER_URL}" -o "${workDir}/gaz.zip" && unzip -o -q "${workDir}/gaz.zip" -d "${workDir}"`);
}

const lines = readFileSync(txtPath, "utf-8").split("\n");
const rows = [];
for (const line of lines.slice(1)) {
  const cols = line.split("\t");
  if (cols.length < 7) continue;
  const zip = cols[0].trim();
  if (!prefixes.some(p => zip.startsWith(p))) continue;
  const lat = parseFloat(cols[5]);
  const lng = parseFloat(cols[6]);
  if (isNaN(lat) || isNaN(lng)) continue;
  rows.push({ zip, lat: lat.toFixed(4), lng: lng.toFixed(4) });
}

rows.sort((a, b) => a.zip.localeCompare(b.zip));

const body = rows.map(r => `  "${r.zip}": [${r.lat}, ${r.lng}],`).join("\n");
const out = `// ${state} ZIP code centroids (lat, lng). GENERATED — do not edit by hand.
// Source: 2023 Census Gazetteer ZCTA file (public domain).
// Regenerate: node scripts/gen-centroids.mjs --prefixes=${prefixes.join(",")} --state=${state} --out=<this file>
// ${rows.length} zips.
export const ZIP_CENTROIDS: Record<string, [number, number]> = {
${body}
};
`;

writeFileSync(outPath, out);
console.log(`Wrote ${rows.length} ${state} zip centroids to ${outPath}`);

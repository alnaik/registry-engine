import data from "./naics/naics2017.json" with { type: "json" };

// NAICS 2017 (Census) lookup. Built by scripts/data/build_naics.py from the
// official 2-6 digit code list and the alphabetical index file. Routing
// compares codes by prefix: "332" covers every 6-digit code under it.

const TITLES: Readonly<Record<string, string>> = data.titles;
const INDEX = data.index as unknown as ReadonlyArray<readonly [string, string]>;

export function naicsTitle(code: string): string | undefined {
  return Object.hasOwn(TITLES, code) ? TITLES[code] : undefined;
}

// A real NAICS 2017 code at any level (2-6 digits), not just digit-shaped.
export function isNaicsCode(code: string): boolean {
  return /^\d{2,6}$/.test(code) && Object.hasOwn(TITLES, code);
}

// (6-digit code, index-entry description) pairs, for text matching.
export function naicsIndex(): ReadonlyArray<readonly [string, string]> {
  return INDEX;
}

// Two codes are related when one is a prefix of the other ("332" ~ "332312").
export function naicsRelated(a: string, b: string): boolean {
  return a.startsWith(b) || b.startsWith(a);
}

import data from "./naics/naics2017.json" with { type: "json" };

// NAICS 2017 (Census) lookup. Built by scripts/data/build_naics.py from the
// official 2-6 digit code list and the alphabetical index file. Routing
// compares codes by prefix: "332" covers every 6-digit code under it.

const TITLES: Readonly<Record<string, string>> = data.titles;
const INDEX = data.index as unknown as ReadonlyArray<readonly [string, string]>;

export function naicsTitle(code: string): string | undefined {
  return Object.hasOwn(TITLES, code) ? TITLES[code] : undefined;
}

// Title of the code, else of its longest prefix (>= 2 digits) that has one.
// PPP uses some 2022 codes absent from the 2017 table ("323110" -> the title
// of "32311"). Display only: routing and isNaicsCode stay strict.
export function naicsLabel(code: string): string | undefined {
  for (let len = code.length; len >= 2; len--) {
    const title = naicsTitle(code.slice(0, len));
    if (title !== undefined) return title;
  }
  return undefined;
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

// Index entries whose description contains every word (case-insensitive
// substring), deduped by code, at most `max`. Backs the "codes" lookups.
export function lookupCodes(words: string[], max = 15): { code: string; title: string; description: string }[] {
  const needles = words.map(w => w.toLowerCase()).filter(w => w.length > 0);
  if (needles.length === 0) return [];
  const seen = new Set<string>();
  const out: { code: string; title: string; description: string }[] = [];
  for (const [code, description] of INDEX) {
    if (seen.has(code)) continue;
    const text = description.toLowerCase();
    if (!needles.every(w => text.includes(w))) continue;
    seen.add(code);
    out.push({ code, title: naicsLabel(code) ?? "", description });
    if (out.length >= max) break;
  }
  return out;
}

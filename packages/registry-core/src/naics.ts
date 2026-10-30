import data from "./naics/naics2017.json" with { type: "json" };
import synonymData from "./naics-synonyms.json" with { type: "json" };

// NAICS 2017 (Census) lookup. Built by scripts/data/build_naics.py from the
// official 2-6 digit code list and the alphabetical index file. Routing
// compares codes by prefix: "332" covers every 6-digit code under it.

const TITLES: Readonly<Record<string, string>> = data.titles;
const INDEX = data.index as unknown as ReadonlyArray<readonly [string, string]>;

// Trade words the official index doesn't carry ("co-packer", "daycare") ->
// the codes they mean, best first. Hyphens and spaces are interchangeable.
const SYNONYMS = Object.entries(synonymData as Readonly<Record<string, readonly string[]>>)
  .map(([phrase, codes]) => ({
    re: new RegExp("(?:^| )" + phrase.toLowerCase().replace(/-/g, " ").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:s|es)?(?: |$)"),
    codes,
  }));

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

// Lowercase a query word and strip a common suffix when >= 4 letters remain,
// so "fabrication" finds "fabricating" and "bags" finds "bag". Otherwise a
// trailing "y" goes when 5+ letters remain ("bakery" -> "baker").
function stem(word: string): string {
  const w = word.toLowerCase();
  const m = /(ication|ation|ing|ers|er|ed|ies|es|s)$/.exec(w);
  if (m !== null && w.length - m[0].length >= 4) return w.slice(0, -m[0].length);
  return w.endsWith("y") && w.length - 1 >= 5 ? w.slice(0, -1) : w;
}

// 6-digit codes ranked by how many distinct query stems their index
// descriptions or title contain (a title hit counts an extra 0.5), best first,
// ties by code. Entries matching all stems therefore sort first. Deduped by
// code, at most `max`. Backs the "codes" lookups. Codes of a synonym phrase
// the words equal or contain (naics-synonyms.json) come first, in table order.
export function lookupCodes(words: string[], max = 15): { code: string; title: string; description: string }[] {
  const stems = [...new Set(words.map(stem).filter(w => w.length > 0))];
  if (stems.length === 0) return [];
  const phrase = words.join(" ").toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ").trim();
  const first = new Set<string>();
  for (const syn of SYNONYMS) if (syn.re.test(phrase)) for (const code of syn.codes) first.add(code);
  // A stem counts only at a word start. Stems of 4+ letters keep the right side
  // open (stems are prefixes); a shorter stem must end the word, allowing only
  // s/es/ed/ing, so "bag" no longer reaches "bagels" or "bagasse".
  // Known trade-off: 'gas' no longer reaches 'gasoline'; type the full word.
  const patterns = stems.map(s => ({ s, re: new RegExp("(^|[^a-z0-9])" + s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + (s.length < 4 ? "(?:s|es|ed|ing)?(?![a-z0-9])" : "")) }));
  const matched = (text: string): string[] => {
    const t = text.toLowerCase();
    return patterns.filter(p => p.re.test(t)).map(p => p.s);
  };

  const best = new Map<string, { description: string; hits: string[] }>();
  for (const [code, description] of INDEX) {
    const hits = matched(description);
    const prev = best.get(code);
    if (prev === undefined || hits.length > prev.hits.length) best.set(code, { description, hits });
  }
  for (const code of Object.keys(TITLES)) {
    if (code.length === 6 && !best.has(code)) best.set(code, { description: TITLES[code]!, hits: [] });
  }

  const scored: { code: string; title: string; description: string; score: number }[] = [];
  for (const [code, { description, hits }] of best) {
    const title = naicsLabel(code) ?? "";
    const titleHits = matched(title);
    const score = new Set([...hits, ...titleHits]).size + titleHits.length * 0.5;
    if (score < 1) continue;
    scored.push({ code, title, description: hits.length > 0 ? description : title, score });
  }
  scored.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
  const found = scored.map(({ code, title, description }) => ({ code, title, description }));
  const lead = [...first].map(code => ({ code, title: naicsLabel(code) ?? "", description: found.find(f => f.code === code)?.description ?? naicsLabel(code) ?? "" }));
  return [...lead, ...found.filter(f => !first.has(f.code))].slice(0, max);
}

// A NAICS title as a plain sentence fragment for a call sheet: "Textile Bag
// and Canvas Mills" -> "Makes textile bag and canvas products", "Full-Service
// Restaurants" -> "Runs a full-service restaurant". Display only; the code
// and its official title stay available alongside it.
export function naicsPhrase(title: string): string {
  let t = title.replace(/\s*\([^)]*\)/g, "").replace(/,?\s*All Other\b/gi, "").replace(/^All Other\s+/i, "")
    .replace(/^Other\s+/i, "").replace(/\s+Other\s+/g, " ").replace(/\s+/g, " ").trim();
  if (t === "") return "";
  const lower = (s: string): string => s.split(" ").map(w => (/^[A-Z]{2,}$/.test(w) ? w : w.toLowerCase())).join(" ");
  const article = (s: string): string => (/^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`);
  const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
  const m = (re: RegExp): string | null => { const r = re.exec(t); return r === null ? null : lower(r[1]!.trim()); };
  let x: string | null;
  if ((x = m(/^(.+) Manufacturing$/)) !== null) return `Makes ${x}`;
  if ((x = m(/^(.+) Mills$/)) !== null) return /products?$/.test(x) ? `Makes ${x.replace(/products?$/, "products")}` : `Makes ${x} products`;
  if ((x = m(/^(.+?) (?:Merchant )?Wholesalers$/)) !== null) return cap(`${x} wholesaler`);
  if ((x = m(/^(.+) Stores$/)) !== null) return `Runs ${x} stores`;
  if ((x = m(/^(.+) Restaurants$/)) !== null) return `Runs ${article(x)} restaurant`;
  if ((x = m(/^(.+) Shops$/)) !== null) return `Runs ${article(x)} shop`;
  if ((x = m(/^(.+) Contractors$/)) !== null) return cap(`${x} contractor`);
  if ((x = m(/^(.+) Dealers$/)) !== null) return cap(`${x} dealer`);
  if (!/ and /i.test(t) && (x = m(/^(.+) Farming$/)) !== null) return `Runs ${article(x)} farm`;
  if ((x = m(/^(.+) Services$/)) !== null) return `Provides ${x} services`;
  t = lower(t);
  return cap(t);
}

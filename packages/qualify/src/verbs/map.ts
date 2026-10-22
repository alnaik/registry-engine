import { isNaicsCode, type Intent } from "@registry-engine/registry-core";
import type { Llm } from "../llm/adapter.js";

// map(query): the only place a search may spend its first LLM call — and
// common queries shouldn't even spend that. A static token table resolves
// category/keywords/geo/direction with zero calls; the cheap tier is the
// fallback for queries the table doesn't understand.

export interface MapResult {
  intent: Intent;
  keywords: string[];   // name fragments for existence-plane LIKE search
  caveats: string[];    // things registries cannot verify — brief() must flag these
  usedLlm: boolean;
}

// token -> NAICS codes + registry-name keywords. Lean on purpose. Extend
// freely; unknown tokens fall through to the LLM.
const STATIC_CATEGORIES: Record<string, { naics: string[]; keywords: string[] }> = {
  jeweler:    { naics: ["339910", "423940", "448310"], keywords: ["jewel", "gem", "diamond", "goldsmith"] },
  jewelry:    { naics: ["339910", "423940", "448310"], keywords: ["jewel", "gem", "diamond", "goldsmith"] },
  diamond:    { naics: ["339910", "423940", "448310"], keywords: ["jewel", "gem", "diamond"] },
  gem:        { naics: ["339910", "423940", "448310"], keywords: ["jewel", "gem"] },
  potato:     { naics: ["4244", "111", "445230"], keywords: ["potato", "produce", "farm"] },
  produce:    { naics: ["4244", "111", "445230"], keywords: ["produce", "farm", "fruit", "vegetable"] },
  grocer:     { naics: ["4244", "111", "445230"], keywords: ["grocer", "market", "food"] },
  grocery:    { naics: ["4244", "111", "445230"], keywords: ["grocer", "market", "food"] },
  fruit:      { naics: ["4244", "111", "445230"], keywords: ["fruit", "produce", "orchard"] },
  vegetable:  { naics: ["4244", "111", "445230"], keywords: ["vegetable", "produce", "farm"] },
  farm:       { naics: ["4244", "111", "445230"], keywords: ["farm", "ranch", "produce"] },
  restaurant: { naics: ["7225"], keywords: ["restaurant", "grill", "kitchen", "cafe", "bistro"] },
  coffee:     { naics: ["311920", "722515"], keywords: ["coffee", "espresso", "roast"] },
  cafe:       { naics: ["311920", "722515"], keywords: ["cafe", "coffee", "espresso"] },
  bakery:     { naics: ["311811", "311812"], keywords: ["bakery", "baking", "bread", "pastry"] },
  baker:      { naics: ["311811", "311812"], keywords: ["bakery", "baking", "bread"] },
  brewery:    { naics: ["312120"], keywords: ["brew", "beer", "ale"] },
  brewer:     { naics: ["312120"], keywords: ["brew", "beer", "ale"] },
  florist:    { naics: ["453110", "424930"], keywords: ["florist", "flower", "floral"] },
  flower:     { naics: ["453110", "424930"], keywords: ["florist", "flower", "floral"] },
  salon:      { naics: ["812111", "812112"], keywords: ["salon", "hair", "beauty", "spa"] },
  barber:     { naics: ["812111", "812112"], keywords: ["barber", "hair"] },
  plumber:    { naics: ["238220"], keywords: ["plumb"] },
  plumbing:   { naics: ["238220"], keywords: ["plumb"] },
  roofer:     { naics: ["238160"], keywords: ["roof"] },
  roofing:    { naics: ["238160"], keywords: ["roof"] },
  landscaper: { naics: ["561730"], keywords: ["landscap", "lawn", "garden"] },
  landscaping:{ naics: ["561730"], keywords: ["landscap", "lawn", "garden"] },
  contractor: { naics: ["236", "238"], keywords: ["construction", "builder", "contracting"] },
  construction:{ naics: ["236", "238"], keywords: ["construction", "builder", "contracting"] },
  dentist:    { naics: ["621210"], keywords: ["dental", "dentistry", "orthodont"] },
  dental:     { naics: ["621210"], keywords: ["dental", "dentistry", "orthodont"] },
  veterinary: { naics: ["541940"], keywords: ["veterinar", "animal", "pet"] },
  vet:        { naics: ["541940"], keywords: ["veterinar", "animal", "pet"] },
};

const BUY_WORDS = new Set(["supplier", "suppliers", "wholesaler", "wholesalers", "distributor", "distributors", "vendor", "vendors", "source", "sourcing"]);
const DEMAND_WORDS = new Set(["need", "needs", "use", "uses", "using", "want", "wants", "buy", "buys"]);
const STOPWORDS = new Set([
  "find", "me", "near", "nearby", "local", "that", "who", "which", "the", "a", "an", "in", "of",
  "to", "for", "with", "and", "or", "i", "am", "looking", "search", "show", "list", "any",
  "businesses", "business", "companies", "company", "shops", "shop", "stores", "store",
]);

export async function mapQuery(
  query: string,
  llm: Llm | null,
  opts: { region: string; cities?: string[] | undefined }
): Promise<MapResult> {
  const region = opts.region;
  const q = query.toLowerCase();

  // Cities come from the manifest's per-source quirks (via the engine), not
  // a hardcoded table. Sort longest-first so "colorado springs" wins over
  // a stray "springs" match.
  const cityTable = (opts.cities ?? []).map(c => c.toLowerCase()).sort((a, b) => b.length - a.length);
  const cities: string[] = cityTable.filter(c => q.includes(c));
  const tokens = q.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

  const naics: string[] = [];
  const keywords: string[] = [];
  const matchedTokens = new Set<string>();
  for (const t of tokens) {
    const entry = STATIC_CATEGORIES[t]
      ?? STATIC_CATEGORIES[t.replace(/ies$/, "y")]
      ?? STATIC_CATEGORIES[t.replace(/es$/, "")]
      ?? STATIC_CATEGORIES[t.replace(/s$/, "")];
    if (entry === undefined) continue;
    matchedTokens.add(t);
    for (const code of entry.naics) if (!naics.includes(code)) naics.push(code);
    for (const kw of entry.keywords) if (!keywords.includes(kw)) keywords.push(kw);
  }

  const direction: Intent["direction"] = tokens.some(t => BUY_WORDS.has(t)) ? "buy" : "sell";

  const caveats: string[] = [];
  if (tokens.some(t => DEMAND_WORDS.has(t))) {
    caveats.push('demand words like "need"/"use" are proxy-inferred — registries record what a business IS, never what it currently buys');
  }
  const cityWords = new Set(cities.flatMap(c => c.split(" ")));
  const residue = tokens.filter(t =>
    !matchedTokens.has(t) && !STOPWORDS.has(t) && !BUY_WORDS.has(t) &&
    !DEMAND_WORDS.has(t) && !cityWords.has(t) && t.length >= 3
  );
  if (residue.length > 0 && naics.length > 0) {
    caveats.push(`"${residue.join(" ")}" is not verifiable from registry data — leads match the category, not this specific detail`);
  }

  if (naics.length > 0) {
    return {
      intent: { naics, geo: { region, cities: cities.map(titleCase) }, direction },
      keywords: keywords.slice(0, 8),
      caveats,
      usedLlm: false,
    };
  }

  if (llm !== null) {
    try {
      const raw = await llm.call(query, { tier: "cheap", maxTokens: 300, system: MAP_SYSTEM });
      const parsed = parseMapResponse(raw, region, direction, caveats);
      if (parsed !== null) return parsed;
    } catch {
      // fall through to the naive extraction
    }
  }

  // Last resort: content words become keywords; no NAICS codes, so route()
  // will only pick existence-plane sources.
  return {
    intent: { naics: [], geo: { region, cities: cities.map(titleCase) }, direction },
    keywords: residue.slice(0, 8),
    caveats,
    usedLlm: false,
  };
}

export const MAP_SYSTEM = `You turn a plain-English business search into a routing decision over government registries. Registries only contain business names, trade-name descriptions, and license categories.

Output ONLY a JSON object:
{"naics":["424480"],"keywords":["potato","farm"],"cities":["Denver"],"direction":"buy","caveats":["..."]}

naics: 1-3 NAICS 2017 codes (2-6 digits) of the businesses the user should contact.
keywords: 3-8 lowercase fragments likely to appear in business NAMES.
cities: city names mentioned in the query, else [].
direction: "buy" if the user wants to buy FROM the leads, "sell" if the user wants to sell TO them.
caveats: each query detail no registry can verify (demand, stock, specific products), phrased as a warning.
No explanation. JSON only.`;

// Model output is data to be validated, never obeyed: known keys, length
// caps, or the whole response is discarded.
export function parseMapResponse(
  raw: string,
  region: string,
  fallbackDirection: Intent["direction"],
  staticCaveats: string[]
): MapResult | null {
  const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim();
  const candidate = cleaned.startsWith("{") ? cleaned : (cleaned.match(/\{[\s\S]*\}/)?.[0] ?? cleaned);
  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    const naics = strings(parsed["naics"], 6, 6).filter(isNaicsCode);
    const keywords = strings(parsed["keywords"], 8);
    if (keywords.length === 0) return null;
    const direction = parsed["direction"] === "buy" || parsed["direction"] === "sell"
      ? parsed["direction"] : fallbackDirection;
    return {
      intent: { naics, geo: { region, cities: strings(parsed["cities"], 5).map(titleCase) }, direction },
      keywords,
      caveats: [...staticCaveats, ...strings(parsed["caveats"], 4, 200)],
      usedLlm: true,
    };
  } catch {
    return null;
  }
}

function strings(v: unknown, max: number, maxLen = 40): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string")
    .map(x => x.trim().slice(0, maxLen))
    .filter(x => x.length >= 2)
    .slice(0, max);
}

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, c => c.toUpperCase());
}

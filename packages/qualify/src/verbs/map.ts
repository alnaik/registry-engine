import type { Intent } from "@registry-engine/registry-core";
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

// token -> category + registry-name keywords. Lean on purpose. Extend
// freely; unknown tokens fall through to the LLM.
const STATIC_CATEGORIES: Record<string, { category: string; keywords: string[] }> = {
  jeweler:    { category: "jewelry", keywords: ["jewel", "gem", "diamond", "goldsmith"] },
  jewelry:    { category: "jewelry", keywords: ["jewel", "gem", "diamond", "goldsmith"] },
  diamond:    { category: "jewelry", keywords: ["jewel", "gem", "diamond"] },
  gem:        { category: "jewelry", keywords: ["jewel", "gem"] },
  potato:     { category: "produce", keywords: ["potato", "produce", "farm"] },
  produce:    { category: "produce", keywords: ["produce", "farm", "fruit", "vegetable"] },
  grocer:     { category: "produce", keywords: ["grocer", "market", "food"] },
  grocery:    { category: "produce", keywords: ["grocer", "market", "food"] },
  fruit:      { category: "produce", keywords: ["fruit", "produce", "orchard"] },
  vegetable:  { category: "produce", keywords: ["vegetable", "produce", "farm"] },
  farm:       { category: "produce", keywords: ["farm", "ranch", "produce"] },
  restaurant: { category: "restaurant", keywords: ["restaurant", "grill", "kitchen", "cafe", "bistro"] },
  coffee:     { category: "coffee", keywords: ["coffee", "espresso", "roast"] },
  cafe:       { category: "coffee", keywords: ["cafe", "coffee", "espresso"] },
  bakery:     { category: "bakery", keywords: ["bakery", "baking", "bread", "pastry"] },
  baker:      { category: "bakery", keywords: ["bakery", "baking", "bread"] },
  brewery:    { category: "brewery", keywords: ["brew", "beer", "ale"] },
  brewer:     { category: "brewery", keywords: ["brew", "beer", "ale"] },
  florist:    { category: "florist", keywords: ["florist", "flower", "floral"] },
  flower:     { category: "florist", keywords: ["florist", "flower", "floral"] },
  salon:      { category: "beauty", keywords: ["salon", "hair", "beauty", "spa"] },
  barber:     { category: "beauty", keywords: ["barber", "hair"] },
  plumber:    { category: "plumbing", keywords: ["plumb"] },
  plumbing:   { category: "plumbing", keywords: ["plumb"] },
  roofer:     { category: "roofing", keywords: ["roof"] },
  roofing:    { category: "roofing", keywords: ["roof"] },
  landscaper: { category: "landscaping", keywords: ["landscap", "lawn", "garden"] },
  landscaping:{ category: "landscaping", keywords: ["landscap", "lawn", "garden"] },
  contractor: { category: "construction", keywords: ["construction", "builder", "contracting"] },
  construction:{ category: "construction", keywords: ["construction", "builder", "contracting"] },
  dentist:    { category: "dental", keywords: ["dental", "dentistry", "orthodont"] },
  dental:     { category: "dental", keywords: ["dental", "dentistry", "orthodont"] },
  veterinary: { category: "veterinary", keywords: ["veterinar", "animal", "pet"] },
  vet:        { category: "veterinary", keywords: ["veterinar", "animal", "pet"] },
};

// Multi-word names first so "colorado springs" wins over stray "springs".
const CO_CITIES = [
  "colorado springs", "fort collins", "castle rock", "monte vista", "grand junction",
  "denver", "boulder", "aurora", "lakewood", "littleton", "arvada", "westminster",
  "thornton", "centennial", "pueblo", "greeley", "longmont", "loveland",
  "broomfield", "parker", "golden", "alamosa", "durango",
];

const BUY_WORDS = new Set(["supplier", "suppliers", "wholesaler", "wholesalers", "distributor", "distributors", "vendor", "vendors", "source", "sourcing"]);
const DEMAND_WORDS = new Set(["need", "needs", "use", "uses", "using", "want", "wants", "buy", "buys"]);
const STOPWORDS = new Set([
  "find", "me", "near", "nearby", "local", "that", "who", "which", "the", "a", "an", "in", "of",
  "to", "for", "with", "and", "or", "i", "am", "looking", "search", "show", "list", "any",
  "businesses", "business", "companies", "company", "shops", "shop", "stores", "store",
]);

const DEFAULT_REGION = "US-CO";

export async function mapQuery(
  query: string,
  llm: Llm | null,
  opts: { region?: string | undefined } = {}
): Promise<MapResult> {
  const region = opts.region ?? DEFAULT_REGION;
  const q = query.toLowerCase();

  const cities: string[] = CO_CITIES.filter(c => q.includes(c));
  const tokens = q.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

  const categories: string[] = [];
  const keywords: string[] = [];
  const matchedTokens = new Set<string>();
  for (const t of tokens) {
    const entry = STATIC_CATEGORIES[t]
      ?? STATIC_CATEGORIES[t.replace(/ies$/, "y")]
      ?? STATIC_CATEGORIES[t.replace(/es$/, "")]
      ?? STATIC_CATEGORIES[t.replace(/s$/, "")];
    if (entry === undefined) continue;
    matchedTokens.add(t);
    if (!categories.includes(entry.category)) categories.push(entry.category);
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
  if (residue.length > 0 && categories.length > 0) {
    caveats.push(`"${residue.join(" ")}" is not verifiable from registry data — leads match the category, not this specific detail`);
  }

  if (categories.length > 0) {
    return {
      intent: { categories, geo: { region, cities: cities.map(titleCase) }, direction },
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

  // Last resort: content words become keywords; no category, so route()
  // will only pick existence-plane sources.
  return {
    intent: { categories: [], geo: { region, cities: cities.map(titleCase) }, direction },
    keywords: residue.slice(0, 8),
    caveats,
    usedLlm: false,
  };
}

export const MAP_SYSTEM = `You turn a plain-English business search into a routing decision over government registries. Registries only contain business names, trade-name descriptions, and license categories.

Output ONLY a JSON object:
{"categories":["produce"],"keywords":["potato","farm"],"cities":["Denver"],"direction":"buy","caveats":["..."]}

categories: 1-3 lowercase category slugs for what kind of business is sought.
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
    const categories = strings(parsed["categories"], 3);
    const keywords = strings(parsed["keywords"], 8);
    if (keywords.length === 0) return null;
    const direction = parsed["direction"] === "buy" || parsed["direction"] === "sell"
      ? parsed["direction"] : fallbackDirection;
    return {
      intent: { categories, geo: { region, cities: strings(parsed["cities"], 5).map(titleCase) }, direction },
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

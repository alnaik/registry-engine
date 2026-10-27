// A fictional search outcome that exercises every part of the field sheet:
// two distance bands, all trust states, an individual's record, a name-only
// match, a recent filing, About-this-search rows. Every name, address and
// phone number is made up. Used by tests/web/sheet-fixture.test.ts and by
// the hermetic accessibility check (scripts/a11y/axe.ts).
import { SOURCES } from "../../../packages/registry-core/src/index.js";
import type { Entity } from "../../../packages/registry-core/src/index.js";
import type { Lead, SearchConfig, SearchOutcome, search } from "../../../packages/qualify/src/index.js";

interface Spec {
  id: string;
  name: string;
  naics: string[];
  street: string;
  city: string;
  zip: string;
  miles: number;
  band: string;
  check: Lead["registryCheck"];
  elsewhere?: boolean;
  phone?: string;
  officer?: string;
  business_type?: string;
  lastSeen?: string;
  formedDate?: string;
  sources?: string[];
}

function lead(s: Spec, rank: number): Lead {
  const sources = s.sources ?? ["ppp", ...(s.check === "matched" ? ["co_sos"] : [])];
  const evidence: Entity["evidence"] = s.naics.map(code => ({ source: "ppp", field: "naics", value: code, note: "matched" }));
  if (s.business_type) evidence.push({ source: "ppp", field: "business_type", value: s.business_type });
  const entity: Entity = {
    id: `ppp:${s.id}`,
    name: s.name,
    names: [],
    status: s.check === "matched" ? "Good Standing" : "",
    address: { street: s.street, city: s.city, state: "CO", zip: s.zip },
    officers: s.officer ? [s.officer] : [],
    naics: s.naics,
    contacts: s.phone ? [s.phone] : [],
    source_ids: sources,
    evidence,
    employees: 6,
    lastSeen: s.lastSeen ?? "2021-03-01",
    ...(s.formedDate ? { formedDate: s.formedDate } : {}),
  };
  return {
    entity,
    registryCheck: s.check,
    registeredElsewhere: s.elsewhere ?? false,
    score: 90 - rank,
    probe: undefined,
    web: "none",
    brief: `${s.name} is coded for canvas and textile bag work in ${s.city}. Industry code shows what it makes, not whether it can take this order.`,
    opener: "Hi, I'm looking for a local shop to sew 500 custom tote bags. Is that work you take on, and what's your lead time?",
    searchUrl: "https://duckduckgo.com/?q=example",
    distanceMi: s.miles,
    band: s.band,
  };
}

const NEAR = "within 10 mi";
const MID = "10–25 mi";

const CODED: Spec[] = [
  { id: "1", name: "Juniper Canvas Works LLC", naics: ["314910"], street: "100 Example St", city: "Denver", zip: "80216", miles: 3.1, band: NEAR, check: "matched", phone: "(303) 555-0101", officer: "Example Agent Services" },
  { id: "2", name: "Larkspur Bag Company", naics: ["314910"], street: "200 Sample Ave", city: "Denver", zip: "80205", miles: 4.4, band: NEAR, check: "checked_not_found", lastSeen: "2020-06-01" },
  { id: "3", name: "Bluebell Sewn Goods Inc", naics: ["315210"], street: "300 Placeholder Rd", city: "Englewood", zip: "80110", miles: 8.2, band: NEAR, check: "checked_not_found", elsewhere: true },
  { id: "4", name: "Columbine Textile Studio", naics: ["314910"], street: "400 Fictional Way", city: "Aurora", zip: "80010", miles: 9.6, band: NEAR, check: "not_checked" },
  { id: "5", name: "Aspen Cut and Sew LLC", naics: ["315210"], street: "500 Example St", city: "Arvada", zip: "80002", miles: 12.5, band: MID, check: "matched", phone: "(303) 555-0105" },
  { id: "6", name: "Spruce Awning and Canvas", naics: ["314910"], street: "600 Sample Ave", city: "Westminster", zip: "80030", miles: 14.0, band: MID, check: "matched" },
  { id: "7", name: "Yarrow Bag Makers", naics: ["314910"], street: "700 Placeholder Rd", city: "Littleton", zip: "80120", miles: 16.8, band: MID, check: "not_checked" },
  { id: "8", name: "Sage Stitch Co", naics: ["315210"], street: "800 Fictional Way", city: "Golden", zip: "80401", miles: 19.3, band: MID, check: "checked_not_found" },
];

const INDIVIDUAL: Spec = { id: "9", name: "SAMPLE, PAT", naics: ["314910"], street: "900 Example St", city: "Denver", zip: "80211", miles: 5.0, band: NEAR, check: "matched", business_type: "Sole Proprietorship" };
const NAME_ONLY: Spec = { id: "10", name: "Tote Example Rentals LLC", naics: ["532490"], street: "1000 Sample Ave", city: "Denver", zip: "80204", miles: 2.2, band: NEAR, check: "matched" };
const RECENT: Spec = { id: "11", name: "New Tote Example LLC", naics: [], street: "1100 Placeholder Rd", city: "Denver", zip: "80203", miles: 1.8, band: NEAR, check: "matched", formedDate: "2026-10-01", sources: ["co_sos"] };

export function sheetOutcome(): SearchOutcome {
  const coded = CODED.map((s, i) => lead(s, i));
  const ranked = [...coded, lead(INDIVIDUAL, 8), lead(NAME_ONLY, 9)];
  return {
    map: {
      intent: { naics: ["314910", "315210"], geo: { region: "US-CO", cities: [] }, direction: "buy" },
      keywords: ["tote", "bag", "canvas"],
      caveats: ["Order size and lead time aren't in any record; ask."],
      usedLlm: false,
      via: "override",
      directionFixed: false,
    },
    routed: SOURCES.filter(s => ["co_sos", "ppp", "epa_echo"].includes(s.id)),
    entities: ranked.map(l => l.entity),
    leads: coded.slice(0, 5),
    ranked,
    llmCalls: 0,
    llmUsage: null,
    origin: { label: "Denver, CO", lat: 39.74, lon: -104.99 },
    contactLookups: null,
    recent: [lead(RECENT, 0)],
    recentWindow: { days: 90, radiusMi: 25 },
    registryLookup: { status: "ran", namesChecked: 6, nameCap: 80, candidates: 6 },
    mapRawAnswer: null,
  };
}

// Drop-in for AppDeps.search: replays a short event stream, then the outcome.
export const sheetSearch = (async (_query: string, cfg: SearchConfig = {}) => {
  const outcome = sheetOutcome();
  const emit = cfg.onEvent ?? (() => undefined);
  emit({ type: "map", map: outcome.map });
  emit({ type: "origin", origin: outcome.origin });
  emit({ type: "routed", sources: outcome.routed });
  emit({ type: "fetched", sourceId: "co_sos", count: 500, capped: true });
  emit({ type: "fetched", sourceId: "ppp", count: 10, capped: false });
  emit({ type: "source_error", sourceId: "epa_echo", message: "ECHO unavailable (fixture)" });
  emit({ type: "merged", count: outcome.entities.length });
  emit({ type: "backfilled", sourceId: "co_sos", count: 3 });
  emit({ type: "probed", count: 0 });
  emit({ type: "recent", count: outcome.recent.length });
  emit({ type: "done", leads: outcome.leads });
  return outcome;
}) as typeof search;

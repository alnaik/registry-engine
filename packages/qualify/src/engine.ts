import type { Entity, SourceSpec, DriverRegistry, FetchRetryOptions, LatLon } from "@registry-engine/registry-core";
import { SOURCES, defaultDrivers, route, mergeEntities, defaultRegion, regionCities, regionPlaces, resolveLocation, normalizeName, localityCompatible, naicsRelated } from "@registry-engine/registry-core";
import { createLlm, type Llm, type LlmConfig } from "./llm/adapter.js";
import { mapQuery, type MapResult } from "./verbs/map.js";
import { probeEntities, type ProbeResult } from "./verbs/probe.js";
import { briefLeads, rankEntities, naicsFieldMap, type Lead, type RankContext } from "./verbs/brief.js";
import { findContacts, fileContactCache, providerFromEnv, type ContactCache, type WebSearchProvider } from "./verbs/contacts.js";

// The whole product: map -> route -> fetch -> probe -> brief.
// Hard budget: at most 2 LLM calls per search (map may be 0), enforced by
// the adapter's call counter — a per-candidate call anywhere throws.

export interface Origin { label: string; lat: number; lon: number }

export type EngineEvent =
  | { type: "map"; map: MapResult }
  | { type: "origin"; origin: Origin | null }
  | { type: "routed"; sources: SourceSpec[] }
  | { type: "fetched"; sourceId: string; count: number }
  | { type: "source_error"; sourceId: string; message: string }
  | { type: "merged"; count: number }
  | { type: "backfilled"; sourceId: string; count: number }
  | { type: "probed"; count: number }
  | { type: "recent"; count: number }
  | { type: "contacts"; provider: string; looked: number; found: number; costDollars: number }
  | { type: "done"; leads: Lead[] };

export interface SearchConfig {
  llm?: LlmConfig | undefined;
  sources?: SourceSpec[] | undefined;
  drivers?: DriverRegistry | undefined;
  region?: string | undefined;
  limit?: number | undefined;       // per-source fetch cap
  probeLimit?: number | undefined;
  maxLeads?: number | undefined;
  naics?: string[] | undefined;     // user-supplied lead codes; skips the map LLM call
  direction?: "buy" | "sell" | undefined;   // fixed search direction; undefined = guess from the request
  hiddenOnly?: boolean | undefined; // keep only leads with no website on any public record
  near?: string | undefined;        // ZIP or place name the leads are measured from
  radiusMi?: number | undefined;    // drop leads farther than this from the origin
  contacts?: WebSearchProvider | null | undefined;  // web contact lookup; undefined -> from env keys, null -> off
  contactCache?: ContactCache | undefined;          // default: ~/.cache/registry-engine/contacts.json
  fetchOpts?: FetchRetryOptions | undefined;
  now?: Date | undefined;           // clock for the recent-filings window (tests)
  onEvent?: ((e: EngineEvent) => void) | undefined;
}

export interface SearchOutcome {
  map: MapResult;
  routed: SourceSpec[];
  entities: Entity[];
  leads: Lead[];     // the top-N briefed slice of `ranked`
  ranked: Lead[];    // every ranked lead (template briefs beyond the top N)
  llmCalls: number;
  origin: Origin | null;   // where distances are measured from, if anywhere
  contactLookups: { provider: string; looked: number; found: number; costDollars: number } | null;
  recent: Lead[];    // state-registry entities formed in the last RECENT_DAYS near the origin, name matches only
  recentWindow: { days: number; radiusMi: number } | null;   // null = the recent-filings query did not run
}

export const MAX_LLM_CALLS_PER_SEARCH = 2;

const DEFAULT_MAX_LEADS = 12;
const BACKFILL_ENTITIES = 150;   // names sent to the existence registry per search
const RECENT_DAYS = 90;                 // formation-date window for "recently registered"
const RECENT_DEFAULT_RADIUS_MI = 25;
const RECENT_MAX = 25;

// A keyword counts in a name only as a whole word, optionally with a
// common English ending: "tote" matches "Totes", "sew" matches "Sewing",
// "bag" does not match "Bagel".
export function nameHasWord(name: string, keyword: string): boolean {
  const kw = keyword.trim().split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  if (kw.length === 0) return false;
  return new RegExp(`(^|[^a-z0-9])${kw}(s|es|e|ed|er|ers|ery|ry|ries|ing|ings|y|ies)?([^a-z0-9]|$)`, "i").test(name);
}

export async function search(query: string, cfg: SearchConfig = {}): Promise<SearchOutcome> {
  const emit = (e: EngineEvent) => cfg.onEvent?.(e);
  const sources = cfg.sources ?? SOURCES;
  const drivers = cfg.drivers ?? defaultDrivers;

  // No backend at all is fine: map falls back to its static tables and
  // leads get template briefs. The budget travels with the instance.
  let llm: Llm | null = null;
  try {
    llm = createLlm({ ...(cfg.llm ?? {}), maxCalls: MAX_LLM_CALLS_PER_SEARCH });
  } catch {
    llm = null;
  }

  const region = cfg.region ?? defaultRegion(sources);
  const map = await mapQuery(query, llm, { region, cities: regionCities(sources, region), places: regionPlaces(region), naics: cfg.naics, locationHint: cfg.near, direction: cfg.direction });
  emit({ type: "map", map });

  // The origin is the user's location: --near, else the first city named in
  // the request. With an origin the whole region is fetched and the city
  // only centers the distance bands; without one, city filtering stays.
  const originInput = cfg.near ?? map.intent.geo.cities[0];
  const resolved = originInput === undefined ? undefined : resolveLocation(region, originInput);
  const originPoint: LatLon | undefined = resolved?.point;
  const origin: Origin | null = resolved === undefined
    ? null
    : { label: resolved.label, lat: resolved.point.lat, lon: resolved.point.lon };
  emit({ type: "origin", origin });

  const routed = route(map.intent, sources);
  emit({ type: "routed", sources: routed });

  // Existence-plane sources fetch (and merge) first so legal names and
  // statuses win the merged record.
  const ordered = [...routed].sort((a, b) => planeRank(a) - planeRank(b));
  const existenceSpec = ordered.find(s => s.plane === "existence");
  const existenceDriver = existenceSpec === undefined ? undefined : drivers[existenceSpec.driver];

  // Recent filings run in parallel with the main fetch: existence entities
  // formed in the last RECENT_DAYS whose names match a keyword. Awaited below.
  const recentRuns = origin !== null && map.keywords.length > 0
    && existenceSpec?.fields["formedDate"] !== undefined && existenceDriver?.fetchRecent !== undefined;
  let recentPromise: Promise<Entity[]> = Promise.resolve([]);
  if (recentRuns && existenceSpec !== undefined && existenceDriver?.fetchRecent !== undefined) {
    const since = new Date((cfg.now ?? new Date()).getTime() - RECENT_DAYS * 86_400_000).toISOString().slice(0, 10);
    const spec = existenceSpec;
    recentPromise = existenceDriver.fetchRecent(spec, { keywords: map.keywords, since }, cfg.fetchOpts).catch(err => {
      emit({ type: "source_error", sourceId: spec.id, message: `recent filings: ${err instanceof Error ? err.message : String(err)}` });
      return [] as Entity[];
    });
  }

  const fetched: Entity[] = [];
  await Promise.all(ordered.map(async spec => {
    const driver = drivers[spec.driver];
    if (driver === undefined) {
      emit({ type: "source_error", sourceId: spec.id, message: `no ${spec.driver} driver` });
      return;
    }
    try {
      const entities = await driver.fetch(spec, {
        keywords: map.keywords,
        region: map.intent.geo.region,
        cities: origin === null ? map.intent.geo.cities : [],
        naics: map.intent.naics,
        limit: cfg.limit,
      }, cfg.fetchOpts);
      emit({ type: "fetched", sourceId: spec.id, count: entities.length });
      // Stable insert by plane rank regardless of completion order.
      fetched.push(...entities.map(e => Object.assign(e, { __rank: planeRank(spec) })));
    } catch (err) {
      emit({ type: "source_error", sourceId: spec.id, message: err instanceof Error ? err.message : String(err) });
    }
  }));
  fetched.sort((a, b) => ((a as { __rank?: number }).__rank ?? 9) - ((b as { __rank?: number }).__rank ?? 9));
  for (const e of fetched) delete (e as { __rank?: number }).__rank;

  // Preliminary rank (no probes yet): decides whose names are worth an
  // existence lookup, and later who gets the probe budget.
  const existenceIds = routed.filter(s => s.plane === "existence").map(s => s.id);
  const ctx: RankContext = { naics: map.intent.naics, existenceIds, origin: originPoint, region };
  let entities = mergeEntities(fetched);
  const preliminary = rankEntities(entities, new Map(), ctx).map(l => l.entity);

  // Existence backfill: category-plane entities whose names carry no search
  // keyword were never fetched from the existence registry, so the merge had
  // nothing to join. Look the strongest candidates' names up directly and
  // re-merge.
  if (existenceSpec !== undefined && existenceDriver?.fetchByNames !== undefined) {
    const unmatched = preliminary.filter(e => !e.source_ids.includes(existenceSpec.id));
    if (unmatched.length > 0) {
      try {
        const found = await existenceDriver.fetchByNames(
          existenceSpec,
          unmatched.slice(0, BACKFILL_ENTITIES).flatMap(e => [e.name, ...e.names]),
          cfg.fetchOpts
        );
        // Keep only rows that actually join an unmatched entity — same
        // normalized name AND a compatible locality. A LIKE pattern can
        // overmatch, and a non-joining row would surface as a phantom lead
        // the query never asked for.
        const byKey = new Map<string, Entity[]>();
        for (const u of unmatched) {
          for (const k of [u.name, ...u.names].map(normalizeName).filter(k => k.length > 0)) {
            byKey.set(k, [...(byKey.get(k) ?? []), u]);
          }
        }
        const joined = found.filter(row =>
          [row.name, ...row.names].map(normalizeName).some(k =>
            (byKey.get(k) ?? []).some(u => localityCompatible(row, u))));
        emit({ type: "backfilled", sourceId: existenceSpec.id, count: joined.length });
        if (joined.length > 0) {
          // Backfilled rows are existence-plane: merge them first so the
          // legal name and status win the merged record.
          entities = mergeEntities([...joined, ...fetched]);
        }
      } catch (err) {
        emit({ type: "source_error", sourceId: existenceSpec.id, message: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  // Name-only noise: an existence-registry record with no related industry
  // code whose only keyword hits fall inside a word ("BAGELS" for "bag").
  entities = entities.filter(e => !isInsideWordNoise(e, map.intent.naics, existenceIds));
  emit({ type: "merged", count: entities.length });

  // Probe in rank order so the request budget goes to the strongest
  // candidates; the final rank below carries the probe results as labels.
  const maxLeads = cfg.maxLeads ?? DEFAULT_MAX_LEADS;
  const radius = cfg.radiusMi ?? RECENT_DEFAULT_RADIUS_MI;
  const recent = rankEntities(await recentPromise, new Map(), ctx)
    .filter(l => !isInsideWordNoise(l.entity, map.intent.naics, existenceIds))
    .filter(l => [l.entity.name, ...l.entity.names].some(n => map.keywords.some(k => nameHasWord(n, k))))
    .filter(l => l.distanceMi !== null && l.distanceMi <= radius)
    .sort((a, b) => (b.entity.formedDate ?? "").localeCompare(a.entity.formedDate ?? "")
      || (a.distanceMi ?? Infinity) - (b.distanceMi ?? Infinity))
    .slice(0, RECENT_MAX);
  if (recentRuns) emit({ type: "recent", count: recent.length });
  const toProbe = rankEntities(entities, new Map(), ctx).map(l => l.entity);
  const probes: Map<string, ProbeResult> = await probeEntities(toProbe, {
    limit: cfg.probeLimit ?? Math.max(25, maxLeads),
    existenceSourceId: existenceSpec?.id,
  });
  emit({ type: "probed", count: probes.size });

  let ranked = rankEntities(entities, probes, ctx);
  if (cfg.hiddenOnly === true) ranked = ranked.filter(l => l.web === "none");
  if (cfg.radiusMi !== undefined && origin !== null) {
    const radius = cfg.radiusMi;
    ranked = ranked.filter(l => l.distanceMi !== null && l.distanceMi <= radius);
  }

  // Web contact lookup for the top leads: not an LLM call, capped by
  // maxLeads and cached. Ranking above never saw it.
  const provider = cfg.contacts === undefined ? providerFromEnv() : cfg.contacts;
  let contactLookups: SearchOutcome["contactLookups"] = null;
  if (provider !== null) {
    const stats = await findContacts(ranked, provider, { limit: maxLeads, cache: cfg.contactCache ?? fileContactCache() });
    contactLookups = { provider: provider.name, ...stats };
    emit({ type: "contacts", ...contactLookups });
  }

  const sourceNames = Object.fromEntries(routed.map(s => [s.id, s.name]));
  await briefLeads(ranked, map, map.llmError !== undefined ? null : llm, { maxLeads, sourceNames, naicsFields: naicsFieldMap(routed), existenceIds, query });
  const leads = ranked.slice(0, maxLeads);
  emit({ type: "done", leads });

  return { map, routed, entities, leads, ranked, llmCalls: llm?.calls ?? 0, origin, contactLookups,
    recent, recentWindow: recentRuns ? { days: RECENT_DAYS, radiusMi: radius } : null };
}

function isInsideWordNoise(e: Entity, codes: string[], existenceIds: string[]): boolean {
  if (e.naics.some(c => codes.some(q => naicsRelated(c, q)))) return false;
  if (!e.source_ids.every(id => existenceIds.includes(id))) return false;
  const matches = e.evidence.filter(ev => ev.note?.startsWith("matched") === true);
  return matches.length > 0 && matches.every(ev => ev.note!.includes("inside a word"));
}

function planeRank(s: SourceSpec): number {
  return s.plane === "existence" ? 0 : s.plane === "category" ? 1 : 2;
}

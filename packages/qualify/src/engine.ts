import type { Entity, SourceSpec, DriverRegistry, FetchRetryOptions, LatLon } from "@registry-engine/registry-core";
import { SOURCES, defaultDrivers, route, mergeEntities, defaultRegion, regionCities, regionPlaces, resolveLocation, normalizeName, localityCompatible, naicsRelated, splitStatusSuffix } from "@registry-engine/registry-core";
import { createLlm, type Llm, type LlmConfig } from "./llm/adapter.js";
import { mapQuery, type MapResult } from "./verbs/map.js";
import { probeEntities, type ProbeResult } from "./verbs/probe.js";
import { briefLeads, rankEntities, naicsFieldMap, type Lead, type RankContext, type RegistryCheck, type RegistryStanding } from "./verbs/brief.js";
import { findContacts, fileContactCache, providerFromEnv, type ContactCache, type WebSearchProvider } from "./verbs/contacts.js";

// The whole product: map -> route -> fetch -> probe -> brief.
// Hard budget: at most 2 LLM calls per search (map may be 0), enforced by
// the adapter's call counter — a per-candidate call anywhere throws.

export interface Origin { label: string; lat: number; lon: number }

export type EngineEvent =
  | { type: "map"; map: MapResult }
  | { type: "origin"; origin: Origin | null }
  | { type: "routed"; sources: SourceSpec[] }
  | { type: "fetched"; sourceId: string; count: number; capped: boolean }
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
  llmUsage: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number | null;
    calls: { label: string; model: string; inputTokens: number; outputTokens: number; costUsd: number | null }[];
  } | null;   // null when no call reported usage (Skip AI, or a backend without usage)
  origin: Origin | null;   // where distances are measured from, if anywhere
  contactLookups: { provider: string; looked: number; found: number; costDollars: number } | null;
  recent: Lead[];    // state-registry entities formed in the last RECENT_DAYS near the origin, name matches only
  recentWindow: { days: number; radiusMi: number } | null;   // null = the recent-filings query did not run
  registryLookup: RegistryLookup;
}

// What the existence-registry backfill actually did this search. Leads carry
// the per-lead result as Lead.registryCheck.
export interface RegistryLookup {
  status: "ran" | "failed" | "none";   // none = no existence registry with a name lookup for this search
  namesChecked: number;                // distinct names sent (after the driver's dedupe key)
  nameCap: number | null;              // the driver's per-search cap on names, if any
  candidates: number;                  // leads considered (top BACKFILL_ENTITIES not already matched)
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

// Words a short keyword's allowed endings turn into an unrelated common
// word ("sew" + "ers" = "Sewers"). A recent filing whose only hits are these
// words is dropped. No LLM involved: the list is static and small on purpose;
// add a pair when a live run shows a new collision. ("bag"/"Bagel" and
// "deli"/"Delivery" never match: the ending isn't an allowed one.)
export const RECENT_COLLISIONS: Readonly<Record<string, readonly string[]>> = {
  sew: ["sewer", "sewers", "sewery", "sewage", "sewerage"],
  car: ["care", "cares", "cared", "carer", "carers", "carry", "caries"],
  pet: ["peter", "peters"],
  bar: ["bare", "bares", "bared", "barry", "baries"],
};

// The recent-filings name test: a whole-word hit (nameHasWord) that isn't
// only a known collision.
export function recentNameMatch(name: string, keyword: string): boolean {
  if (!nameHasWord(name, keyword)) return false;
  const kw = keyword.trim().toLowerCase();
  const collisions = RECENT_COLLISIONS[kw];
  if (collisions === undefined) return true;
  const words = name.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 0);
  return words.some(w => nameHasWord(w, kw) && !collisions.includes(w));
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
      const cap = cfg.limit ?? driver.defaultLimit;
      const capped = cap !== undefined && Number.isFinite(cap) && entities.length >= cap;
      emit({ type: "fetched", sourceId: spec.id, count: entities.length, capped });
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
  // checkedKeys: normalized names that were really sent; elsewhereKeys: names
  // the registry has, but only at an incompatible locality (not joined).
  const checkedKeys = new Set<string>();
  const elsewhereKeys = new Set<string>();
  // Registry rows for a checked name whose status isn't the active one
  // (quirks.backfillInactive): not merged, but they give the lead its real
  // standing ("Dissolved Oct 2026") instead of "not found".
  const inactiveRows: { keys: string[]; row: Entity; standing: RegistryStanding }[] = [];
  let registryLookup: RegistryLookup = { status: "none", namesChecked: 0, nameCap: null, candidates: 0 };
  if (existenceSpec !== undefined && existenceDriver?.fetchByNames !== undefined) {
    const unmatched = preliminary.filter(e => !e.source_ids.includes(existenceSpec.id));
    const plan = planBackfill(unmatched.slice(0, BACKFILL_ENTITIES), existenceDriver);
    registryLookup = { status: "ran", namesChecked: plan.keyCount, nameCap: existenceDriver.maxBackfillNames ?? null, candidates: Math.min(unmatched.length, BACKFILL_ENTITIES) };
    if (plan.names.length > 0) {
      try {
        const found = await existenceDriver.fetchByNames(existenceSpec, plan.names, cfg.fetchOpts);
        for (const e of plan.checked) {
          for (const k of [e.name, ...e.names].map(normalizeName)) if (k.length > 0) checkedKeys.add(k);
        }
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
        const inactive = found.filter(row => !isActiveRow(row, existenceSpec));
        const active = found.filter(row => isActiveRow(row, existenceSpec));
        const joined = active.filter(row =>
          [row.name, ...row.names].map(normalizeName).some(k =>
            (byKey.get(k) ?? []).some(u => localityCompatible(row, u))));
        for (const row of inactive) {
          // An inactive name carries its standing as a suffix: "ACME TENT &
          // CANVAS CO., Dissolved October 23, 2026". Match on the bare name.
          const suffix = splitStatusSuffix(row.name);
          const keys = [suffix?.name ?? row.name, ...row.names].map(normalizeName).filter(k => k.length > 0);
          inactiveRows.push({ keys, row, standing: { status: row.status !== "" ? row.status : (suffix?.status ?? ""), since: suffix?.date ?? null, filedName: row.name } });
        }
        const rowKeys = [...active.map(row => ({ row, keys: [row.name, ...row.names].map(normalizeName) })), ...inactiveRows];
        for (const { row, keys } of rowKeys) {
          for (const k of keys) {
            if ((byKey.get(k) ?? []).some(u => !localityCompatible(row, u))) elsewhereKeys.add(k);
          }
        }
        emit({ type: "backfilled", sourceId: existenceSpec.id, count: joined.length });
        if (joined.length > 0) {
          // Backfilled rows are existence-plane: merge them first so the
          // legal name and status win the merged record.
          entities = mergeEntities([...joined, ...fetched]);
        }
      } catch (err) {
        checkedKeys.clear();
        elsewhereKeys.clear();
        inactiveRows.length = 0;
        registryLookup = { ...registryLookup, status: "failed", namesChecked: 0 };
        emit({ type: "source_error", sourceId: existenceSpec.id, message: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  const keysOf = (e: Entity): string[] => [e.name, ...e.names].map(normalizeName).filter(k => k.length > 0);
  // The locality guard applies here too: a dissolved namesake in another
  // town says nothing about this business (it counts as "elsewhere" above).
  const standingOf = (e: Entity): RegistryStanding | undefined => {
    const keys = keysOf(e);
    return inactiveRows.find(r => r.keys.some(k => keys.includes(k)) && localityCompatible(r.row, e))?.standing;
  };
  const registryCheck = (e: Entity): RegistryCheck => {
    if (e.source_ids.some(id => existenceIds.includes(id))) return "matched";
    if (!keysOf(e).some(k => checkedKeys.has(k))) return "not_checked";
    return standingOf(e) !== undefined ? "inactive" : "checked_not_found";
  };
  const annotate = (lead: Lead): Lead => {
    lead.registryCheck = registryCheck(lead.entity);
    if (lead.registryCheck === "inactive") lead.registryStanding = standingOf(lead.entity);
    if (lead.registryCheck === "checked_not_found" && keysOf(lead.entity).some(k => elsewhereKeys.has(k))) lead.registeredElsewhere = true;
    return lead;
  };
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
    .filter(l => [l.entity.name, ...l.entity.names].some(n => map.keywords.some(k => recentNameMatch(n, k))))
    .filter(l => l.distanceMi !== null && l.distanceMi <= radius)
    .sort((a, b) => (b.entity.formedDate ?? "").localeCompare(a.entity.formedDate ?? "")
      || (a.distanceMi ?? Infinity) - (b.distanceMi ?? Infinity))
    .slice(0, RECENT_MAX)
    .map(annotate);
  if (recentRuns) emit({ type: "recent", count: recent.length });
  const toProbe = rankEntities(entities, new Map(), ctx).map(l => l.entity);
  const probes: Map<string, ProbeResult> = await probeEntities(toProbe, {
    limit: cfg.probeLimit ?? Math.max(25, maxLeads),
    existenceSourceId: existenceSpec?.id,
    wasChecked: e => registryCheck(e) !== "not_checked",
    inactiveStatus: e => (registryCheck(e) === "inactive" ? (standingOf(e)?.status ?? null) : null),
  });
  emit({ type: "probed", count: probes.size });

  let ranked = rankEntities(entities, probes, ctx).map(annotate);
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

  const u = llm?.usage ?? null;
  const llmUsage = u === null || llm === null ? null : {
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    costUsd: u.costUsd,
    calls: llm.usageLog.map(e => ({ ...e })),
  };

  return { map, routed, entities, leads, ranked, llmCalls: llm?.calls ?? 0, llmUsage, origin, contactLookups,
    recent, recentWindow: recentRuns ? { days: RECENT_DAYS, radiusMi: radius } : null, registryLookup };
}

// Which names go to the registry's name lookup, replicating the driver's own
// dedupe-and-cap so the engine knows exactly who was checked. Walks the
// candidates best-first; an entity counts as checked when its legal name's
// key was sent. Names with no usable key (too short) can't be looked up.
export function planBackfill(candidates: Entity[], driver: { maxBackfillNames?: number | undefined; backfillKey?(name: string): string | null }): { names: string[]; checked: Entity[]; keyCount: number } {
  const cap = driver.maxBackfillNames ?? Infinity;
  const keyOf = (n: string): string | null => (driver.backfillKey !== undefined ? driver.backfillKey(n) : (normalizeName(n) || null));
  const keys = new Set<string>();
  const names: string[] = [];
  const checked: Entity[] = [];
  const take = (n: string): boolean => {
    const k = keyOf(n);
    if (k === null || (!keys.has(k) && keys.size >= cap)) return false;
    keys.add(k);
    names.push(n);
    return true;
  };
  for (const e of candidates) {
    if (!take(e.name)) continue;
    checked.push(e);
    for (const n of e.names) take(n);
  }
  return { names, checked, keyCount: keys.size };
}

// A backfilled row is active when the source has no status filter, or its
// status is the filter's value. Only sources that opt into inactive rows
// (quirks.backfillInactive) ever return anything else.
function isActiveRow(row: Entity, spec: SourceSpec): boolean {
  const q = spec.quirks ?? {};
  if (q["backfillInactive"] !== true || typeof q["statusValue"] !== "string") return true;
  return row.status === q["statusValue"] || (typeof q["statusDisplay"] === "string" && row.status === q["statusDisplay"]);
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

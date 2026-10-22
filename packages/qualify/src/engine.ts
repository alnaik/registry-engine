import type { Entity, SourceSpec, DriverRegistry, FetchRetryOptions } from "@registry-engine/registry-core";
import { SOURCES, defaultDrivers, route, mergeEntities, defaultRegion, regionCities, normalizeName, localityCompatible } from "@registry-engine/registry-core";
import { createLlm, type Llm, type LlmConfig } from "./llm/adapter.js";
import { mapQuery, type MapResult } from "./verbs/map.js";
import { probeEntities, type ProbeResult } from "./verbs/probe.js";
import { briefLeads, rankEntities, type Lead, type RankContext } from "./verbs/brief.js";

// The whole product: map -> route -> fetch -> probe -> brief.
// Hard budget: at most 2 LLM calls per search (map may be 0), enforced by
// the adapter's call counter — a per-candidate call anywhere throws.

export type EngineEvent =
  | { type: "map"; map: MapResult }
  | { type: "routed"; sources: SourceSpec[] }
  | { type: "fetched"; sourceId: string; count: number }
  | { type: "source_error"; sourceId: string; message: string }
  | { type: "merged"; count: number }
  | { type: "backfilled"; sourceId: string; count: number }
  | { type: "probed"; count: number }
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
  hiddenOnly?: boolean | undefined; // keep only leads with no website on any public record
  fetchOpts?: FetchRetryOptions | undefined;
  onEvent?: ((e: EngineEvent) => void) | undefined;
}

export interface SearchOutcome {
  map: MapResult;
  routed: SourceSpec[];
  entities: Entity[];
  leads: Lead[];     // the top-N briefed slice of `ranked`
  ranked: Lead[];    // every ranked lead (template briefs beyond the top N)
  llmCalls: number;
}

export const MAX_LLM_CALLS_PER_SEARCH = 2;

const DEFAULT_MAX_LEADS = 12;
const BACKFILL_ENTITIES = 150;   // names sent to the existence registry per search

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
  const map = await mapQuery(query, llm, { region, cities: regionCities(sources, region), naics: cfg.naics });
  emit({ type: "map", map });

  const routed = route(map.intent, sources);
  emit({ type: "routed", sources: routed });

  // Existence-plane sources fetch (and merge) first so legal names and
  // statuses win the merged record.
  const ordered = [...routed].sort((a, b) => planeRank(a) - planeRank(b));
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
        cities: map.intent.geo.cities,
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
  const ctx: RankContext = { naics: map.intent.naics, existenceIds };
  let entities = mergeEntities(fetched);
  const preliminary = rankEntities(entities, new Map(), ctx).map(l => l.entity);

  // Existence backfill: category-plane entities whose names carry no search
  // keyword were never fetched from the existence registry, so the merge had
  // nothing to join. Look the strongest candidates' names up directly and
  // re-merge.
  const existenceSpec = ordered.find(s => s.plane === "existence");
  const existenceDriver = existenceSpec === undefined ? undefined : drivers[existenceSpec.driver];
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
  emit({ type: "merged", count: entities.length });

  // Probe in rank order so the request budget goes to the strongest
  // candidates; the final rank below carries the probe results as labels.
  const maxLeads = cfg.maxLeads ?? DEFAULT_MAX_LEADS;
  const toProbe = rankEntities(entities, new Map(), ctx).map(l => l.entity);
  const probes: Map<string, ProbeResult> = await probeEntities(toProbe, {
    limit: cfg.probeLimit ?? Math.max(25, maxLeads),
    existenceSourceId: existenceSpec?.id,
  });
  emit({ type: "probed", count: probes.size });

  let ranked = rankEntities(entities, probes, ctx);
  if (cfg.hiddenOnly === true) ranked = ranked.filter(l => l.web === "none");

  const sourceNames = Object.fromEntries(routed.map(s => [s.id, s.name]));
  await briefLeads(ranked, map, llm, { maxLeads, sourceNames, existenceIds, query });
  const leads = ranked.slice(0, maxLeads);
  emit({ type: "done", leads });

  return { map, routed, entities, leads, ranked, llmCalls: llm?.calls ?? 0 };
}

function planeRank(s: SourceSpec): number {
  return s.plane === "existence" ? 0 : s.plane === "category" ? 1 : 2;
}

import type { Entity, SourceSpec, DriverRegistry, FetchRetryOptions } from "@registry-engine/registry-core";
import { SOURCES, defaultDrivers, route, mergeEntities, defaultRegion, regionCities } from "@registry-engine/registry-core";
import { createLlm, type Llm, type LlmConfig } from "./llm/adapter.js";
import { mapQuery, type MapResult } from "./verbs/map.js";
import { probeEntities, type ProbeResult } from "./verbs/probe.js";
import { briefLeads, rankEntities, type Lead } from "./verbs/brief.js";

// The whole product: map -> route -> fetch -> probe -> brief.
// Hard budget: at most 2 LLM calls per search (map may be 0), enforced by
// the adapter's call counter — a per-candidate call anywhere throws.

export type EngineEvent =
  | { type: "map"; map: MapResult }
  | { type: "routed"; sources: SourceSpec[] }
  | { type: "fetched"; sourceId: string; count: number }
  | { type: "source_error"; sourceId: string; message: string }
  | { type: "merged"; count: number }
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
  fetchOpts?: FetchRetryOptions | undefined;
  onEvent?: ((e: EngineEvent) => void) | undefined;
}

export interface SearchOutcome {
  map: MapResult;
  routed: SourceSpec[];
  entities: Entity[];
  leads: Lead[];
  llmCalls: number;
}

export const MAX_LLM_CALLS_PER_SEARCH = 2;

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
  const map = await mapQuery(query, llm, { region, cities: regionCities(sources, region) });
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
        categories: map.intent.categories,
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

  const entities = mergeEntities(fetched);
  emit({ type: "merged", count: entities.length });

  // Probe in preliminary-rank order so the request budget goes to the
  // strongest candidates; briefLeads re-ranks with probe results included.
  const preliminary = rankEntities(entities, new Map()).map(l => l.entity);
  const existenceId = ordered.find(s => s.plane === "existence")?.id;
  const probes: Map<string, ProbeResult> = await probeEntities(preliminary, {
    limit: cfg.probeLimit,
    existenceSourceId: existenceId,
  });
  emit({ type: "probed", count: probes.size });

  const leads = await briefLeads(preliminary, probes, map, llm, { maxLeads: cfg.maxLeads });
  emit({ type: "done", leads });

  return { map, routed, entities, leads, llmCalls: llm?.calls ?? 0 };
}

function planeRank(s: SourceSpec): number {
  return s.plane === "existence" ? 0 : s.plane === "category" ? 1 : 2;
}

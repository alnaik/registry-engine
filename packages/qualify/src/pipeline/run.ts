import type { NormalizedEntity, Signal, KVCache } from "@registry-engine/registry-core";
import type { QualificationProfile } from "../profiles/schema.js";
import type { TokenBudgeter } from "../llm/budgeter.js";
import type { QualifiedLead } from "./qualifyLead.js";
import { runPrefilter } from "./prefilter.js";
import { runClassify } from "./classify.js";
import { qualifyLead } from "./qualifyLead.js";
import { Limiter } from "@registry-engine/registry-core";

const QUALIFY_CONCURRENCY = 3;

export type ProgressEvent =
  | { type: "stage"; stage: "prefilter" | "classify" | "qualify" | "done" }
  | { type: "count"; stage: string; count: number }
  | { type: "lead"; lead: QualifiedLead }
  | { type: "budget"; input: number; output: number }
  | { type: "error"; message: string };

export type ProgressCallback = (event: ProgressEvent) => void;

export interface RunOptions {
  profile: QualificationProfile;
  entities: NormalizedEntity[];
  signalsByEntityId: Map<string, Signal[]>;
  budgeter: TokenBudgeter;
  cache: KVCache;
  onProgress?: ProgressCallback | undefined;
  qualifyIds?: string[] | undefined;
}

function cacheKey(entityId: string, profileId: string, profileVersion: string, stage: string): string {
  const str = `${entityId}|${profileId}|${profileVersion}|${stage}`;
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ (str.charCodeAt(i) ?? 0);
    hash = hash >>> 0;
  }
  return `re:${stage}:${hash.toString(36)}`;
}

export async function runFunnel(opts: RunOptions): Promise<QualifiedLead[]> {
  const { profile, entities, signalsByEntityId, budgeter, cache, onProgress, qualifyIds } = opts;
  const emit = onProgress ?? (() => undefined);

  emit({ type: "stage", stage: "prefilter" });
  const { included, ambiguous } = await runPrefilter(entities, profile, budgeter);
  const toClassify = [...included, ...ambiguous];
  emit({ type: "count", stage: "prefilter", count: toClassify.length });
  emit({ type: "budget", ...budgeter.totals });

  emit({ type: "stage", stage: "classify" });

  const uncached: NormalizedEntity[] = [];
  const classifyResults = new Map<string, "Y" | "N" | "U">();

  for (const entity of toClassify) {
    const key = cacheKey(entity.id, profile.id, profile.version, "classify");
    const cached = cache.get(key);
    if (cached !== undefined && (cached === "Y" || cached === "N" || cached === "U")) {
      classifyResults.set(entity.id, cached);
    } else {
      uncached.push(entity);
    }
  }

  if (uncached.length > 0) {
    const fresh = await runClassify(uncached, profile, budgeter);
    for (const [id, verdict] of fresh) {
      classifyResults.set(id, verdict);
      const key = cacheKey(id, profile.id, profile.version, "classify");
      cache.set(key, verdict);
    }
  }

  const yesEntities = toClassify.filter(e => classifyResults.get(e.id) === "Y");
  emit({ type: "count", stage: "classify", count: yesEntities.length });
  emit({ type: "budget", ...budgeter.totals });

  emit({ type: "stage", stage: "qualify" });
  const toQualify = qualifyIds !== undefined
    ? yesEntities.filter(e => qualifyIds.includes(e.id))
    : [];

  const limiter = new Limiter(QUALIFY_CONCURRENCY);
  const qualifyPromises = toQualify.map(entity =>
    limiter.run(async () => {
      const key = cacheKey(entity.id, profile.id, profile.version, "qualify");
      const cached = cache.get(key);
      if (cached !== undefined) {
        emit({ type: "lead", lead: cached as QualifiedLead });
        return cached as QualifiedLead;
      }

      const signals = signalsByEntityId.get(entity.id) ?? [];
      const lead = await qualifyLead(entity, profile, signals, budgeter);
      cache.set(key, lead);
      emit({ type: "lead", lead });
      emit({ type: "budget", ...budgeter.totals });
      return lead;
    })
  );

  const leads = await Promise.all(qualifyPromises);
  emit({ type: "stage", stage: "done" });

  return leads;
}

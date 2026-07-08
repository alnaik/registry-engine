import type { NormalizedEntity, RegistrySource, LocationQuery, KVCache } from "@registry-engine/registry-core";
import { Limiter, MemoryCache } from "@registry-engine/registry-core";
import type { TokenBudgeter } from "../llm/budgeter.js";
import { BudgetExceededError } from "../llm/budgeter.js";
import { deriveIntent, type SearchIntent } from "./intent.js";
import { buildClassifyBatch, parseClassifyResponse, type ClassifyVerdict, type ClassifyInput } from "./classify.js";
import { verifyLead, pendingLead, type VerifiedLead } from "./verify.js";

const CLASSIFY_BATCH_SIZE = 30;
const CLASSIFY_CONCURRENCY = 2;
const VERIFY_CONCURRENCY = 3;
const DEFAULT_AUTO_VERIFY = 10;

export type SearchEvent =
  | { type: "intent"; intent: SearchIntent }
  | { type: "candidates"; count: number }
  | { type: "lead"; lead: VerifiedLead }
  | { type: "update"; lead: VerifiedLead }
  | { type: "budget"; input: number; output: number }
  | { type: "error"; message: string }
  | { type: "done"; leads: VerifiedLead[] };

export interface SearchOptions {
  query: string;
  source: RegistrySource;
  location: LocationQuery;
  budgeter: TokenBudgeter;
  cache?: KVCache | undefined;
  autoVerify?: number | undefined;   // verify the first N classified leads automatically
  onEvent?: ((event: SearchEvent) => void) | undefined;
}

// The whole product in one function: derive intent from the raw query,
// stream server-side keyword matches from the registry, classify batches
// while later pages are still landing, and verify leads top-down as they
// appear. Results upgrade live; nothing waits for a full phase to finish.
export async function runSearch(opts: SearchOptions): Promise<VerifiedLead[]> {
  const cache = opts.cache ?? new MemoryCache();
  const autoVerify = opts.autoVerify ?? DEFAULT_AUTO_VERIFY;
  const emit = (event: SearchEvent) => opts.onEvent?.(event);
  const emitBudget = () => emit({ type: "budget", ...opts.budgeter.totals });

  const leads: VerifiedLead[] = [];
  const classifyLimiter = new Limiter(CLASSIFY_CONCURRENCY);
  const verifyLimiter = new Limiter(VERIFY_CONCURRENCY);
  const classifyJobs: Promise<void>[] = [];
  const verifyJobs: Promise<void>[] = [];
  let verifiesStarted = 0;
  let candidateCount = 0;

  const intent = await deriveIntent(opts.query, opts.budgeter);
  emit({ type: "intent", intent });
  emitBudget();

  const startVerify = (lead: VerifiedLead) => {
    if (verifiesStarted >= autoVerify) return;
    verifiesStarted++;
    verifyJobs.push(verifyLimiter.run(async () => {
      try {
        const result = await cached(cache, "verify", `${lead.entity.id}|${intent.query}|${intent.requirement}`,
          () => verifyLead(lead.entity, intent, opts.budgeter));
        Object.assign(lead, result, { entity: lead.entity });
        emit({ type: "update", lead });
      } catch (err) {
        if (err instanceof BudgetExceededError) {
          emit({ type: "error", message: err.message });
        } else {
          lead.rationale = "Verification failed — try again";
          emit({ type: "update", lead });
        }
      }
      emitBudget();
    }));
  };

  const classifyBatch = (entities: NormalizedEntity[]) => {
    classifyJobs.push(classifyLimiter.run(async () => {
      const verdicts = new Map<string, ClassifyVerdict>();
      const uncached: NormalizedEntity[] = [];

      for (const e of entities) {
        const hit = await cache.get(cacheKey("classify", `${e.id}|${intent.query}`));
        if (hit === "Y" || hit === "N" || hit === "U") {
          verdicts.set(e.id, hit);
        } else {
          uncached.push(e);
        }
      }

      if (uncached.length > 0) {
        const items: ClassifyInput[] = uncached.map(e => ({
          id: e.id,
          name: e.name,
          tradeDesc: e.tradeNames[0]?.description ?? "",
        }));
        try {
          const { system, user } = buildClassifyBatch(items, intent);
          const response = await opts.budgeter.call({
            system,
            messages: [{ role: "user", content: user }],
            maxTokens: 200,
          });
          for (const [id, v] of parseClassifyResponse(response.content, items)) {
            verdicts.set(id, v);
            await cache.set(cacheKey("classify", `${id}|${intent.query}`), v);
          }
        } catch (err) {
          if (err instanceof BudgetExceededError) {
            emit({ type: "error", message: err.message });
            return;
          }
          throw err;
        }
      }

      for (const e of entities) {
        if (verdicts.get(e.id) === "Y") {
          const lead = pendingLead(e);
          leads.push(lead);
          emit({ type: "lead", lead });
          startVerify(lead);
        }
      }
      emitBudget();
    }));
  };

  const excluded = (e: NormalizedEntity): boolean => {
    if (intent.exclusions.length === 0) return false;
    const text = `${e.name} ${e.tradeNames.map(t => t.description).join(" ")}`.toLowerCase();
    return intent.exclusions.some(x => text.includes(x));
  };

  try {
    let batch: NormalizedEntity[] = [];
    for await (const entity of opts.source.searchEntities(opts.location, intent.keywords)) {
      if (excluded(entity)) continue;
      candidateCount++;
      emit({ type: "candidates", count: candidateCount });
      batch.push(entity);
      if (batch.length >= CLASSIFY_BATCH_SIZE) {
        classifyBatch(batch);
        batch = [];
      }
    }
    if (batch.length > 0) classifyBatch(batch);
  } catch (err) {
    emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }

  await Promise.all(classifyJobs);
  await Promise.all(verifyJobs);

  leads.sort((a, b) => (b.verified ? b.score : -1) - (a.verified ? a.score : -1) || a.entity.name.localeCompare(b.entity.name));
  emit({ type: "done", leads });
  return leads;
}

async function cached<T>(cache: KVCache, stage: string, key: string, fn: () => Promise<T>): Promise<T> {
  const k = cacheKey(stage, key);
  const hit = await cache.get(k);
  if (typeof hit === "string") {
    try {
      return JSON.parse(hit) as T;
    } catch {
      // fall through to recompute
    }
  }
  const value = await fn();
  await cache.set(k, JSON.stringify(value));
  return value;
}

// djb2 — deterministic, tiny, works identically in Node and browser.
function cacheKey(stage: string, input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return `re:${stage}:${(hash >>> 0).toString(36)}`;
}

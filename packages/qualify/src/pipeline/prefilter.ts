import type { NormalizedEntity } from "@registry-engine/registry-core";
import type { QualificationProfile } from "../profiles/schema.js";
import type { TokenBudgeter } from "../llm/budgeter.js";
import { PREFILTER_SYSTEM } from "../prompts/index.js";

export interface PrefilterPatterns {
  includePatterns: string[];
  excludePatterns: string[];
  ambiguousOk: boolean;
}

export interface PrefilterResult {
  included: NormalizedEntity[];
  excluded: NormalizedEntity[];
  ambiguous: NormalizedEntity[];
  patterns: PrefilterPatterns;
}

export async function runPrefilter(
  entities: NormalizedEntity[],
  profile: QualificationProfile,
  budgeter: TokenBudgeter
): Promise<PrefilterResult> {
  const patterns = await fetchPatterns(profile, budgeter);
  return applyPatterns(entities, patterns);
}

export async function fetchPatterns(
  profile: QualificationProfile,
  budgeter: TokenBudgeter
): Promise<PrefilterPatterns> {
  const userMsg = `Profile: ${profile.description}
Must have any of: ${profile.mustHave.join(", ")}
Exclude: ${profile.exclude.join(", ")}`;

  const response = await budgeter.call({
    system: PREFILTER_SYSTEM,
    messages: [{ role: "user", content: userMsg }],
    maxTokens: 300,
  });

  try {
    const parsed = JSON.parse(response.content) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      const obj = parsed as Record<string, unknown>;
      return {
        includePatterns: Array.isArray(obj["includePatterns"]) ? obj["includePatterns"] as string[] : [],
        excludePatterns: Array.isArray(obj["excludePatterns"]) ? obj["excludePatterns"] as string[] : [],
        ambiguousOk: obj["ambiguousOk"] === true,
      };
    }
  } catch {
    // Fall back to profile keywords if LLM output is unparseable
  }

  return {
    includePatterns: profile.mustHave.map(k => k.toLowerCase()),
    excludePatterns: profile.exclude.map(k => k.toLowerCase()),
    ambiguousOk: true,
  };
}

export function applyPatterns(
  entities: NormalizedEntity[],
  patterns: PrefilterPatterns
): PrefilterResult {
  const included: NormalizedEntity[] = [];
  const excluded: NormalizedEntity[] = [];
  const ambiguous: NormalizedEntity[] = [];

  for (const entity of entities) {
    const searchText = [
      entity.name,
      ...entity.tradeNames.map(t => t.description),
    ].join(" ").toLowerCase();

    const isExcluded = patterns.excludePatterns.some(p => searchText.includes(p.toLowerCase()));
    if (isExcluded) {
      excluded.push(entity);
      continue;
    }

    const isIncluded = patterns.includePatterns.some(p => searchText.includes(p.toLowerCase()));
    if (isIncluded) {
      included.push(entity);
      continue;
    }

    if (patterns.ambiguousOk) {
      ambiguous.push(entity);
    } else {
      excluded.push(entity);
    }
  }

  return { included, excluded, ambiguous, patterns };
}

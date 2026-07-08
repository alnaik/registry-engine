import type { TokenBudgeter } from "../llm/budgeter.js";
import { INTENT_SYSTEM } from "../prompts/index.js";

// The user's raw query IS the profile. One small LLM call turns it into
// registry-level keywords + the specific requirement web verification must
// confirm. Ephemeral — derived fresh per search, nothing stored.
export interface SearchIntent {
  query: string;
  keywords: string[];
  exclusions: string[];
  requirement: string;
}

const STOPWORDS = new Set([
  "i", "want", "need", "find", "looking", "for", "shops", "businesses", "that",
  "use", "uses", "sell", "sells", "buy", "buys", "with", "and", "or", "the", "a", "an", "in", "of", "to",
]);

export async function deriveIntent(query: string, budgeter: TokenBudgeter): Promise<SearchIntent> {
  const response = await budgeter.call({
    system: INTENT_SYSTEM,
    messages: [{ role: "user", content: query }],
    maxTokens: 300,
  });
  return parseIntentResponse(response.content, query);
}

export function parseIntentResponse(content: string, query: string): SearchIntent {
  const cleaned = content.replace(/```json\n?|\n?```/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const keywords = sanitizeList(parsed["keywords"]);
    const exclusions = sanitizeList(parsed["exclusions"]);
    const requirement = typeof parsed["requirement"] === "string"
      ? parsed["requirement"].slice(0, 300)
      : query;
    if (keywords.length > 0) {
      return { query, keywords, exclusions, requirement };
    }
  } catch {
    // fall through to naive extraction
  }
  return fallbackIntent(query);
}

// If the model output is unusable, extract content words from the query
// itself so the search still runs.
export function fallbackIntent(query: string): SearchIntent {
  const keywords = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOPWORDS.has(w))
    .slice(0, 8);
  return { query, keywords, exclusions: [], requirement: query };
}

function sanitizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map(v => v.toLowerCase().trim().slice(0, 40))
    .filter(v => v.length >= 2)
    .slice(0, 8);
}

import type { NormalizedEntity } from "@registry-engine/registry-core";
import type { SearchIntent } from "./intent.js";
import type { TokenBudgeter } from "../llm/budgeter.js";
import { VERIFY_SYSTEM } from "../prompts/index.js";

export interface VerifiedLead {
  entity: NormalizedEntity;
  score: number;
  rationale: string;
  webPresence: "found" | "none";
  contact: string | null;
  sells: string;
  buys: string;
  verified: boolean;   // false = classified only, verify not yet run
}

const WEB_SEARCH_TOOL = {
  type: "web_search_20250305",
  name: "web_search",
};

export function pendingLead(entity: NormalizedEntity): VerifiedLead {
  return {
    entity,
    score: 0,
    rationale: "",
    webPresence: "none",
    contact: null,
    sells: "",
    buys: "",
    verified: false,
  };
}

export async function verifyLead(
  entity: NormalizedEntity,
  intent: SearchIntent,
  budgeter: TokenBudgeter
): Promise<VerifiedLead> {
  const response = await budgeter.call({
    system: VERIFY_SYSTEM,
    messages: [{ role: "user", content: buildVerifyMessage(entity, intent) }],
    maxTokens: 300,
    tools: [WEB_SEARCH_TOOL],
  });

  return parseVerifyResponse(response.content, entity);
}

export function buildVerifyMessage(entity: NormalizedEntity, intent: SearchIntent): string {
  const tradeNames = entity.tradeNames.length > 0
    ? ` (also known as: ${entity.tradeNames.map(t => t.description).join(", ")})`
    : "";
  return `Business: ${entity.name}${tradeNames}
Location: ${entity.city}, ${entity.state} ${entity.zipCode}
Registered: ${entity.formDate.slice(0, 10)}

Requirement: ${intent.requirement}`;
}

// Model output is data to be validated, never commands to be obeyed:
// known keys only, score clamped in code, strings length-capped.
export function parseVerifyResponse(content: string, entity: NormalizedEntity): VerifiedLead {
  const cleaned = content.replace(/```json\n?|\n?```/g, "").trim();
  // Models sometimes wrap the JSON in prose — fall back to the first
  // object-shaped span in the output.
  const candidate = cleaned.startsWith("{") ? cleaned : (cleaned.match(/\{[\s\S]*\}/)?.[0] ?? cleaned);

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    return {
      entity,
      score: 0,
      rationale: "Could not parse verification response",
      webPresence: "none",
      contact: null,
      sells: "",
      buys: "",
      verified: true,
    };
  }

  const rawScore = typeof parsed["score"] === "number" ? parsed["score"] : 0;
  const score = Math.max(0, Math.min(100, rawScore));

  return {
    entity,
    score,
    rationale: typeof parsed["rationale"] === "string" ? parsed["rationale"].slice(0, 200) : "",
    webPresence: parsed["webPresence"] === "found" ? "found" : "none",
    contact: typeof parsed["contact"] === "string" ? parsed["contact"].slice(0, 200) : null,
    sells: typeof parsed["sells"] === "string" ? parsed["sells"].slice(0, 200) : "",
    buys: typeof parsed["buys"] === "string" ? parsed["buys"].slice(0, 200) : "",
    verified: true,
  };
}

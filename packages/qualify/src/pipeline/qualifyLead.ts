import type { NormalizedEntity, Signal } from "@registry-engine/registry-core";
import type { QualificationProfile } from "../profiles/schema.js";
import type { TokenBudgeter } from "../llm/budgeter.js";
import { QUALIFY_SYSTEM } from "../prompts/index.js";
import { feedbackLine } from "../profiles/feedback.js";

export interface QualifiedLead {
  entity: NormalizedEntity;
  score: number;
  rationale: string;
  webPresence: "found" | "none";
  contact: string | null;
  sells: string;
  buys: string;
  signals: Signal[];
  profileId: string;
}

const WEB_SEARCH_TOOL = {
  type: "web_search_20250305",
  name: "web_search",
};

export async function qualifyLead(
  entity: NormalizedEntity,
  profile: QualificationProfile,
  signals: Signal[],
  budgeter: TokenBudgeter
): Promise<QualifiedLead> {
  const fb = feedbackLine(profile);
  const systemWithFeedback = `${QUALIFY_SYSTEM}${fb ? `\n${fb}` : ""}`;

  const userMsg = buildQualifyMessage(entity, profile);

  const response = await budgeter.call({
    system: systemWithFeedback,
    messages: [{ role: "user", content: userMsg }],
    maxTokens: 300,
    tools: [WEB_SEARCH_TOOL],
  });

  return parseQualifyResponse(response.content, entity, profile.id, signals);
}

export function buildQualifyMessage(entity: NormalizedEntity, profile: QualificationProfile): string {
  const tradeNames = entity.tradeNames.length > 0
    ? ` (also known as: ${entity.tradeNames.map(t => t.description).join(", ")})`
    : "";
  return `Business: ${entity.name}${tradeNames}
Location: ${entity.city}, CO ${entity.zipCode}
Entity type: ${entity.type}
Formed: ${entity.formDate.slice(0, 10)}

Profile direction: ${profile.direction}
Must have: ${profile.mustHave.join(", ")}
Exclude if: ${profile.exclude.join(", ")}`;
}

function parseQualifyResponse(
  content: string,
  entity: NormalizedEntity,
  profileId: string,
  signals: Signal[]
): QualifiedLead {
  const cleaned = content.replace(/```json\n?|\n?```/g, "").trim();

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return {
      entity,
      score: 0,
      rationale: "Could not parse qualification response",
      webPresence: "none",
      contact: null,
      sells: "",
      buys: "",
      signals,
      profileId,
    };
  }

  const rawScore = typeof parsed["score"] === "number" ? parsed["score"] : 0;
  const score = Math.max(0, Math.min(100, rawScore));

  const rationale = typeof parsed["rationale"] === "string"
    ? parsed["rationale"].slice(0, 200)
    : "";

  return {
    entity,
    score,
    rationale,
    webPresence: parsed["webPresence"] === "found" ? "found" : "none",
    contact: typeof parsed["contact"] === "string" ? parsed["contact"].slice(0, 200) : null,
    sells: typeof parsed["sells"] === "string" ? parsed["sells"].slice(0, 200) : "",
    buys: typeof parsed["buys"] === "string" ? parsed["buys"].slice(0, 200) : "",
    signals,
    profileId,
  };
}

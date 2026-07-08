import type { VerifiedLead } from "./verify.js";
import type { TokenBudgeter } from "../llm/budgeter.js";
import { OUTREACH_SYSTEM } from "../prompts/index.js";

export interface Brief {
  entityId: string;
  entityName: string;
  text: string;
  outreachDraft: string | null;
}

// Pure template — zero tokens. Everything in the brief was already computed.
export function assembleBrief(lead: VerifiedLead): Brief {
  const e = lead.entity;
  const agentName = (e.agent.orgName ?? `${e.agent.firstName ?? ""} ${e.agent.lastName ?? ""}`.trim()) || "Unknown";
  const ageDays = e.formDate ? Math.round((Date.now() - new Date(e.formDate).getTime()) / 86400000) : null;
  const freshness = ageDays !== null && ageDays <= 90
    ? `\nRegistered ${ageDays} days ago — likely has few vendor relationships yet.`
    : "";

  const text = `
═══ ${e.name} ═══
Status: ${e.status} | Type: ${e.type} | Formed: ${e.formDate.slice(0, 10)}
Location: ${e.address}, ${e.city}, ${e.state} ${e.zipCode}
Registered agent: ${agentName}
${e.tradeNames.length > 0 ? `Trade names: ${e.tradeNames.map(t => t.description).join(", ")}` : ""}
${lead.verified ? `
Fit score: ${lead.score}/100
Rationale: ${lead.rationale}
Web presence: ${lead.webPresence}${lead.contact ? `\nContact: ${lead.contact}` : ""}
${lead.sells ? `Sells: ${lead.sells}` : ""}${lead.buys ? `\nBuys: ${lead.buys}` : ""}` : `
(Not yet verified — name-level match only.)`}${freshness}

Note: the registry address may be a registered agent, not the business location.
`.trim().replace(/\n{3,}/g, "\n\n");

  return { entityId: e.id, entityName: e.name, text, outreachDraft: null };
}

// One optional per-lead call, user-triggered, never automatic.
export async function draftOutreach(
  lead: VerifiedLead,
  budgeter: TokenBudgeter
): Promise<string> {
  const userMsg = `Business: ${lead.entity.name}
City: ${lead.entity.city}, ${lead.entity.state}
Registered: ${lead.entity.formDate.slice(0, 10)}
Fit score: ${lead.score}/100${lead.sells ? `\nSells: ${lead.sells}` : ""}`;

  const response = await budgeter.call({
    system: OUTREACH_SYSTEM,
    messages: [{ role: "user", content: userMsg }],
    maxTokens: 150,
  });

  return response.content.trim();
}

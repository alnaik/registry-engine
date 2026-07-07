import type { QualifiedLead } from "./qualifyLead.js";
import type { TokenBudgeter } from "../llm/budgeter.js";
import { OUTREACH_SYSTEM } from "../prompts/index.js";

export interface Dossier {
  entityId: string;
  entityName: string;
  brief: string;
  outreachDraft: string | null;
}

export function assembleDossier(lead: QualifiedLead): Dossier {
  const e = lead.entity;
  const signalLines = lead.signals.length > 0
    ? lead.signals.map(s => `  • ${s.summary}`).join("\n")
    : "  (none)";

  const agentName = (e.agent.orgName ?? `${e.agent.firstName ?? ""} ${e.agent.lastName ?? ""}`.trim()) || "Unknown";

  const brief = `
═══ ${e.name} ═══
Status: ${e.status} | Type: ${e.type} | Formed: ${e.formDate.slice(0, 10)}
Location: ${e.address}, ${e.city}, CO ${e.zipCode}
Registered agent: ${agentName}
${e.tradeNames.length > 0 ? `Trade names: ${e.tradeNames.map(t => t.description).join(", ")}` : ""}

Fit score: ${lead.score}/100
Rationale: ${lead.rationale}
Web presence: ${lead.webPresence}${lead.contact ? `\nContact: ${lead.contact}` : ""}
${lead.sells ? `Sells: ${lead.sells}` : ""}${lead.buys ? `\nBuys: ${lead.buys}` : ""}

Timing signals:
${signalLines}
`.trim();

  return { entityId: e.id, entityName: e.name, brief, outreachDraft: null };
}

export async function draftOutreach(
  lead: QualifiedLead,
  budgeter: TokenBudgeter
): Promise<string> {
  const triggerLine = lead.signals.length > 0
    ? `Trigger: ${lead.signals[0]?.summary ?? ""}`
    : "";

  const userMsg = `Business: ${lead.entity.name}
City: ${lead.entity.city}, CO
Fit score: ${lead.score}/100
${triggerLine}
Profile direction: ${lead.profileId}`;

  const response = await budgeter.call({
    system: OUTREACH_SYSTEM,
    messages: [{ role: "user", content: userMsg }],
    maxTokens: 150,
  });

  return response.content.trim();
}

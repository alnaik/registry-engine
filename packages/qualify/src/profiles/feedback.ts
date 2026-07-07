import type { QualificationProfile } from "./schema.js";

export type Verdict = "approved" | "rejected";

export interface FeedbackEntry {
  entityId: string;
  entityName: string;
  verdict: Verdict;
  rationale: string;
}

const MAX_TRAITS = 10;

export function applyFeedback(
  profile: QualificationProfile,
  entry: FeedbackEntry
): QualificationProfile {
  const feedback = { ...profile.feedback };

  if (entry.verdict === "approved") {
    const traits = [...feedback.approvedTraits, entry.rationale].slice(-MAX_TRAITS);
    feedback.approvedTraits = traits;
  } else {
    const traits = [...feedback.rejectedTraits, entry.rationale].slice(-MAX_TRAITS);
    feedback.rejectedTraits = traits;
  }

  return {
    ...profile,
    feedback,
    version: String(parseInt(profile.version, 10) + 1),
  };
}

export function feedbackLine(profile: QualificationProfile): string {
  const parts: string[] = [];
  if (profile.feedback.approvedTraits.length > 0) {
    parts.push(`User approved: ${profile.feedback.approvedTraits.slice(-5).join("; ")}`);
  }
  if (profile.feedback.rejectedTraits.length > 0) {
    parts.push(`User rejected: ${profile.feedback.rejectedTraits.slice(-5).join("; ")}`);
  }
  return parts.join(". ");
}

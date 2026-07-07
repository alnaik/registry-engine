export interface QualificationProfile {
  id: string;
  name: string;
  direction: "find_customers" | "find_suppliers";
  description: string;
  mustHave: string[];
  niceToHave: string[];
  exclude: string[];
  feedback: {
    approvedTraits: string[];
    rejectedTraits: string[];
  };
  version: string;
}

export function validateProfile(p: unknown): QualificationProfile {
  if (typeof p !== "object" || p === null) throw new Error("Profile must be an object");
  const obj = p as Record<string, unknown>;

  const required: Array<keyof QualificationProfile> = ["id", "name", "direction", "description", "mustHave", "niceToHave", "exclude", "feedback", "version"];
  for (const key of required) {
    if (obj[key] === undefined) throw new Error(`Profile missing required field: ${key}`);
  }

  if (obj["direction"] !== "find_customers" && obj["direction"] !== "find_suppliers") {
    throw new Error(`Profile direction must be "find_customers" or "find_suppliers"`);
  }

  return obj as unknown as QualificationProfile;
}

export function profileCacheKey(profile: QualificationProfile): string {
  return `${profile.id}:${profile.version}`;
}

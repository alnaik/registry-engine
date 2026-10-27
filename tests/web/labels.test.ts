import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { trustLabel, webTag, hasSite, fetchedText, whatLine } from "../../apps/web/public/labels.js";
import type { LabelLead } from "../../apps/web/public/labels.js";

// Label-to-predicate pins (v6 Phase A): every trust pill and tag the web app
// can show, with the LeadView predicate that must produce it. The last tests
// fail if a label string is added to labels.js without a pin here, or if a
// label is hard-coded in app.js instead of coming from labels.js.

const base: LabelLead = { registryCheck: "not_checked", status: "", lastSeen: null, web: "none", found: null, coded: true, what: "Makes things", employees: null };
const ran = { status: "ran", namesChecked: 80 };

const PINS: { label: string; kind: "pill" | "tag" | "web"; lead: LabelLead; lookup?: { status: string; namesChecked: number } }[] = [
  // matched: joined a registry record
  { label: "On state registry · Good Standing", kind: "pill", lead: { ...base, registryCheck: "matched", status: "Good Standing" } },
  { label: "On state registry · listed", kind: "pill", lead: { ...base, registryCheck: "matched", status: "" } },
  // checked_not_found: name sent, nothing joined
  { label: "Not on state registry", kind: "pill", lead: { ...base, registryCheck: "checked_not_found", lastSeen: "2020-04-27" } },
  { label: "Last record 2020. Confirm it still operates.", kind: "tag", lead: { ...base, registryCheck: "checked_not_found", lastSeen: "2020-04-27" } },
  { label: "No dated record. Confirm it still operates.", kind: "tag", lead: { ...base, registryCheck: "checked_not_found", lastSeen: null } },
  { label: "Not on state registry at this address", kind: "pill", lead: { ...base, registryCheck: "checked_not_found", registeredElsewhere: true } },
  { label: "A business with this name is registered elsewhere. Confirm it's the same one.", kind: "tag", lead: { ...base, registryCheck: "checked_not_found", registeredElsewhere: true } },
  // not_checked: never looked up
  { label: "Not checked against registry", kind: "pill", lead: { ...base, registryCheck: "not_checked" }, lookup: ran },
  { label: "Beyond the 80 names checked this search", kind: "tag", lead: { ...base, registryCheck: "not_checked" }, lookup: ran },
  { label: "The registry lookup failed this search", kind: "tag", lead: { ...base, registryCheck: "not_checked" }, lookup: { status: "failed", namesChecked: 0 } },
  { label: "No state registry lookup for this search", kind: "tag", lead: { ...base, registryCheck: "not_checked" }, lookup: { status: "none", namesChecked: 0 } },
  // web presence
  { label: "Website responds", kind: "web", lead: { ...base, web: "verified" } },
  { label: "Found online, verify", kind: "web", lead: { ...base, found: { status: "found", website: "https://x.example" } } },
  { label: "Listed on Yelp, BBB", kind: "web", lead: { ...base, found: { status: "directory", listings: ["yelp.com", "bbb.org"] } } },
  { label: "Listed in directories", kind: "web", lead: { ...base, found: { status: "directory", listings: [] } } },
  { label: "No web presence found", kind: "web", lead: { ...base, found: { status: "not-found" } } },
  { label: "Listed website didn't respond", kind: "web", lead: { ...base, web: "unresolved" } },
  { label: "No website on record", kind: "web", lead: { ...base, web: "none" } },
];

describe("trust labels follow LeadView predicates", () => {
  for (const pin of PINS) {
    it(`"${pin.label}"`, () => {
      if (pin.kind === "web") {
        expect(webTag(pin.lead)).toBe(pin.label);
        return;
      }
      const t = trustLabel(pin.lead, pin.lookup);
      expect(pin.kind === "pill" ? t.pill : t.tag).toBe(pin.label);
      // the tone is fixed by the registry check alone
      const tone = { matched: "ok", checked_not_found: "no", not_checked: "unk" }[pin.lead.registryCheck as string];
      expect(t.tone).toBe(tone);
    });
  }

  it("green only for a real join; amber only after a real lookup; grey never claims 'not found'", () => {
    for (const check of ["matched", "checked_not_found", "not_checked", undefined]) {
      for (const lookup of [ran, { status: "failed", namesChecked: 0 }, { status: "none", namesChecked: 0 }, null]) {
        const t = trustLabel({ ...base, registryCheck: check, lastSeen: "2021-01-01" }, lookup);
        if (t.tone === "ok") expect(check).toBe("matched");
        if (t.tone === "no") expect(check).toBe("checked_not_found");
        if (t.tone === "unk") expect(`${t.pill} ${t.tag}`).not.toMatch(/not on state registry|not found/i);
      }
    }
  });

  it("the 'No web presence' filter predicate is exactly 'no website from any record or lookup'", () => {
    expect(hasSite({ ...base, web: "verified" })).toBe(true);
    expect(hasSite({ ...base, found: { status: "found", website: "https://x.example" } })).toBe(true);
    expect(hasSite({ ...base, found: { status: "found" } })).toBe(false);
    expect(hasSite({ ...base, web: "unresolved" })).toBe(false);
  });

  it("capped counts never read as a full count", () => {
    expect(fetchedText(500, true)).toBe("500+ (capped)");
    expect(fetchedText(1234, false)).toBe("1,234");
  });

  it("the what line is the plain phrase plus jobs; name matches say so", () => {
    expect(whatLine({ ...base, what: "Makes textile bag and canvas products", employees: 10 })).toBe("Makes textile bag and canvas products · about 10 jobs");
    expect(whatLine({ ...base, employees: 1 })).toBe("Makes things · about 1 job");
    expect(whatLine({ ...base, coded: false, what: "" })).toBe("Name match only, no industry code for this work");
  });
});

describe("label sources", () => {
  const PUBLIC = join(import.meta.dirname, "../../apps/web/public");
  const labelsSrc = readFileSync(join(PUBLIC, "labels.js"), "utf8");
  const fnBody = (name: string): string => {
    const start = labelsSrc.indexOf(`export function ${name}(`);
    const end = labelsSrc.indexOf("\nexport function", start + 1);
    return labelsSrc.slice(start, end === -1 ? undefined : end);
  };

  it("every literal label in trustLabel and webTag is pinned above", () => {
    const pinned = PINS.map(p => p.label).join("\n");
    const src = `${fnBody("trustLabel")}${fnBody("webTag")}`;
    const literals = [...src.matchAll(/`([^`\n]*)`/g), ...src.replace(/`[^`\n]*`/g, "").matchAll(/"([^"\n]*)"/g)]
      .map(m => m[1]!)
      .filter(s => /^[A-Z]/.test(s));
    expect(literals.length).toBeGreaterThan(10);
    for (const lit of literals) {
      // template literals: their fixed text must appear in some pinned label
      const fixed = lit.split(/\$\{[^}]*\}/).filter(Boolean);
      for (const part of fixed) expect(pinned, `unpinned label text: ${part}`).toContain(part);
    }
  });

  it("app.js renders trust labels only through labels.js", () => {
    const app = readFileSync(join(PUBLIC, "app.js"), "utf8");
    for (const pin of PINS.filter(p => p.kind !== "web")) {
      expect(app, pin.label).not.toContain(pin.label.split(" · ")[0]!.replace(/ 2020| 80 /, ""));
    }
  });
});

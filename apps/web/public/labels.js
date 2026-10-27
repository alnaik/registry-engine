// Every user-facing trust and status label, as pure functions of a LeadView
// (see LeadView in apps/web/src/server.ts). No DOM here: app.js renders these
// strings, and tests/web/labels.test.ts pins each label to the predicate that
// produces it, so a label can't drift from its meaning.

// ---- trust: standing against the state registry ----------------------------

// tone maps to the three trust tokens: ok = confirmed (green), unk = unchecked
// (grey), no = not found (amber).
export function trustLabel(lead, lookup) {
  if (lead.registryCheck === "matched") {
    return { tone: "ok", pill: `On state registry · ${lead.status || "listed"}`, tag: null };
  }
  if (lead.registryCheck === "checked_not_found") {
    if (lead.registeredElsewhere) {
      return { tone: "no", pill: "Not on state registry at this address", tag: "A business with this name is registered elsewhere. Confirm it's the same one." };
    }
    const year = recordYear(lead.lastSeen);
    return { tone: "no", pill: "Not on state registry", tag: year ? `Last record ${year}. Confirm it still operates.` : "No dated record. Confirm it still operates." };
  }
  // not_checked (or anything unknown): never claim a lookup that didn't happen.
  const l = lookup || { status: "none", namesChecked: 0 };
  let tag = "No state registry lookup for this search";
  if (l.status === "ran" && l.namesChecked > 0) tag = `Beyond the ${l.namesChecked} names checked this search`;
  else if (l.status === "failed") tag = "The registry lookup failed this search";
  return { tone: "unk", pill: "Not checked against registry", tag };
}

export function recordYear(iso) {
  const m = /^(\d{4})/.exec(String(iso || ""));
  return m ? m[1] : "";
}

// ---- web presence --------------------------------------------------------------

// Whether any record or the web lookup gave this business a website.
export function hasSite(lead) {
  return lead.web === "verified" || Boolean(lead.found && lead.found.website);
}

export function webTag(lead) {
  const f = lead.found;
  if (lead.web === "verified") return "Website responds";
  if (f && f.status === "found") return "Found online, verify";
  if (f && f.status === "directory") {
    const names = (f.listings || []).map(prettyHost);
    return names.length > 0 ? `Listed on ${names.join(", ")}` : "Listed in directories";
  }
  if (f && f.status === "not-found") return "No web presence found";
  if (lead.web === "unresolved") return "Listed website didn't respond";
  return "No website on record";
}

export function prettyHost(host) {
  const first = String(host).replace(/^www\./, "").split(".")[0] || String(host);
  return first.length <= 3 ? first.toUpperCase() : first.charAt(0).toUpperCase() + first.slice(1);
}

// ---- counts -------------------------------------------------------------------

// A source that returned exactly its row cap was cut short: never "500 found".
export function fetchedText(count, capped) {
  const n = Number(count).toLocaleString("en-US");
  return capped ? `${n}+ (capped)` : n;
}

export function jobsText(employees) {
  if (typeof employees !== "number") return "";
  return `about ${employees.toLocaleString("en-US")} ${employees === 1 ? "job" : "jobs"}`;
}

// "Makes textile bag and canvas products · about 10 jobs"
export function whatLine(lead) {
  const what = lead.coded ? lead.what : "Name match only, no industry code for this work";
  return [what, jobsText(lead.employees)].filter(Boolean).join(" · ");
}

// ---- call outcomes (the "Your call" tracker) ----------------------------------

export const OUTCOMES = [
  ["notcalled", "Not called"],
  ["reached", "Reached"],
  ["noanswer", "No answer"],
  ["notfit", "Not a fit"],
];
export const OUTCOME_LABEL = Object.fromEntries(OUTCOMES);

// Tracker entries saved before v6 used New / Called / Interested / Not a fit.
// Returns the entry in the current shape and whether anything changed.
export function migrateTracker(raw) {
  if (!raw || typeof raw !== "object") return { entry: null, changed: false };
  const entry = { ...raw };
  let changed = false;
  const note = typeof entry.note === "string" ? entry.note : "";
  switch (entry.status) {
    case "new": case undefined: case null: case "":
      if (entry.status !== "notcalled") { entry.status = "notcalled"; changed = true; }
      break;
    case "called": entry.status = "reached"; changed = true; break;
    case "interested":
      entry.status = "reached";
      entry.note = note.startsWith("Interested. ") ? note : `Interested. ${note}`.trim();
      changed = true;
      break;
    default:
      if (!Object.hasOwn(OUTCOME_LABEL, entry.status)) { entry.status = "notcalled"; changed = true; }
  }
  return { entry, changed };
}

// An entry worth keeping: a call outcome or a note.
export function isTracked(entry) {
  return Boolean(entry) && ((entry.status && entry.status !== "notcalled") || Boolean(entry.note));
}

export function shortDate(iso) {
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  const d = bare ? new Date(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3])) : new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getMonth() + 1}/${d.getDate()}`;
}

// "Reached 10/24" on a lead row; "" while not called.
export function callStatusText(entry) {
  if (!entry || !entry.status || entry.status === "notcalled") return "";
  return [OUTCOME_LABEL[entry.status] || "", shortDate(entry.updatedAt)].filter(Boolean).join(" ");
}

// ---- filters ------------------------------------------------------------------

// [id, label, predicate(lead, outcome)] — outcome is the lead's tracker status.
export const FILTERS = [
  ["all", "All", () => true],
  ["confirmed", "Confirmed", lead => lead.registryCheck === "matched"],
  ["notcalled", "Not yet called", (lead, outcome) => !outcome || outcome === "notcalled"],
  ["noweb", "No web presence", lead => !hasSite(lead)],
];

// ---- bands --------------------------------------------------------------------

const BAND_TITLES = {
  "within 10 mi": "Within 10 miles",
  "10–25 mi": "10 to 25 miles",
  "25–50 mi": "25 to 50 miles",
  "50–100 mi": "50 to 100 miles",
  "100+ mi": "More than 100 miles",
  "distance unknown": "Distance unknown",
};
export function bandTitle(band) {
  if (!band) return "Coded for this work";
  return BAND_TITLES[band] || band.charAt(0).toUpperCase() + band.slice(1);
}

// ---- reach line ---------------------------------------------------------------

const PHONE_RE = /^\+?[\d\s().-]{7,}(?:\s*(?:x|ext\.?)\s*\d+)?$/i;
export function phoneDigits(value) {
  const v = String(value || "").trim();
  const digits = v.replace(/\D/g, "");
  return PHONE_RE.test(v) && digits.length >= 10 && digits.length <= 11 ? digits : null;
}

// The collapsed row's reach line: a phone when any record or the web lookup
// has one, else the street and town, plus the first agent/principal.
export function reachSummary(lead) {
  const recorded = (lead.contacts || []).find(c => phoneDigits(c) !== null);
  const found = lead.found && lead.found.status !== "skipped" && phoneDigits(lead.found.phone) !== null ? lead.found.phone : null;
  if (recorded) return { phone: recorded, source: "on public record", place: "", principal: "" };
  if (found) return { phone: found, source: "found on the web, verify", place: "", principal: "" };
  const a = lead.address || {};
  const place = [a.street, a.city].filter(Boolean).join(", ");
  const principal = !lead.individual && Array.isArray(lead.officers) && lead.officers.length > 0 ? lead.officers[0] : "";
  return { phone: "", source: "", place: lead.individual ? `Address as filed: ${place}` : place, principal };
}

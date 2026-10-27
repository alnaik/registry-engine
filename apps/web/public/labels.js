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

// Registry Engine field sheet. Vanilla ES module, no build step.
//
// Safety rule: data from the server (business names, registry text, web
// results) is only ever put on the page with textContent / text nodes, never
// as HTML. Links are built only from validated URLs. Every trust and status
// label comes from labels.js, where tests pin it to its predicate.

import {
  trustLabel, trustAtCall, webTag, fetchedText, whatLine,
  OUTCOMES, OUTCOME_LABEL, migrateTracker, isTracked, shortDate, callStatusText,
  FILTERS, bandTitle, phoneDigits, reachSummary, prettyHost, summaryParts, aboutRows,
  registryLine, registryProgressText, llmFailedHint, coverageLine, displayName, displayCity,
} from "/labels.js";

const $ = id => document.getElementById(id);

// ---- DOM helper ----------------------------------------------------------------

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === "class") el.className = value;
      else if (key === "text") el.textContent = value;
      else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
      else if (value === true) el.setAttribute(key, "");
      else el.setAttribute(key, String(value));
    }
  }
  for (const kid of kids.flat()) {
    if (kid === undefined || kid === null || kid === false || kid === "") continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

// ---- link / contact safety -------------------------------------------------------

function safeHttpUrl(raw) {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (text === "" || /\s/.test(text)) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[A-Za-z]{2,}$/;
const HOST_RE = /^(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:[/?#]\S*)?$/i;

function classifyContact(raw) {
  const value = String(raw).trim();
  if (EMAIL_RE.test(value)) return { kind: "email", value };
  const digits = phoneDigits(value);
  if (digits !== null) return { kind: "phone", value, digits };
  if (HOST_RE.test(value) && safeHttpUrl(value) !== null) return { kind: "web", value };
  return { kind: "text", value };
}

function extLink(text, url) {
  const safe = safeHttpUrl(url);
  if (safe === null) return null;
  return h("a", { href: safe, target: "_blank", rel: "noopener noreferrer", text });
}

function mapsLink(url) {
  return typeof url === "string" && url.startsWith("https://www.google.com/maps/") ? extLink("Map", url) : null;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function bareSite(url) {
  return String(url).replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
}

// ---- storage (every access guarded: it can be blocked or full) ----------------------

const TRACKER_PREFIX = "re:tracker:";

function readTracker(id) {
  try {
    const raw = localStorage.getItem(TRACKER_PREFIX + id);
    if (raw === null) return null;
    const { entry, changed } = migrateTracker(JSON.parse(raw));
    if (entry && changed) writeTracker(id, entry);
    return entry;
  } catch {
    return null;
  }
}

function writeTracker(id, entry) {
  try {
    if (!isTracked(entry)) localStorage.removeItem(TRACKER_PREFIX + id);
    else localStorage.setItem(TRACKER_PREFIX + id, JSON.stringify(entry));
    return true;
  } catch {
    return false;
  }
}

// Trackers are keyed by the stable lead key (name + ZIP5). Entries saved under
// the old source-dependent id move to the key the first time they are read.
function leadTracker(lead) {
  const current = readTracker(lead.key);
  if (current) return current;
  const legacy = readTracker(lead.id);
  if (!legacy) return null;
  try {
    localStorage.setItem(TRACKER_PREFIX + lead.key, JSON.stringify(legacy));
    localStorage.removeItem(TRACKER_PREFIX + lead.id);
  } catch {
    // storage unavailable: keep using the legacy entry as read
  }
  return legacy;
}

function outcomeOf(lead) {
  const t = leadTracker(lead);
  return t && t.status ? t.status : "notcalled";
}

function allTracked() {
  const out = [];
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== null && key.startsWith(TRACKER_PREFIX)) keys.push(key);
    }
    for (const key of keys) {
      const entry = readTracker(key.slice(TRACKER_PREFIX.length));
      if (entry && isTracked(entry)) out.push(entry);
    }
  } catch {
    // storage unavailable: nothing tracked
  }
  return out.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

const SAVED_KEY = "re:saved";
const SAVED_MAX = 20;
const SEEN_MAX = 500;

function normCodes(text) {
  return String(text || "").split(/[\s,]+/).filter(Boolean).sort().join(",");
}

function searchId(p) {
  return JSON.stringify([
    String(p.query || "").trim().toLowerCase(),
    String(p.near || "").trim().toLowerCase(),
    normCodes(p.naics),
    p.direction || "auto",
  ]);
}

function loadSaved() {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (raw === null) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter(e => e && typeof e === "object" && typeof e.query === "string") : [];
  } catch {
    return [];
  }
}

function storeSaved(list) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

function findSaved(params) {
  if (!params) return null;
  const id = searchId(params);
  return loadSaved().find(e => searchId(e) === id) || null;
}

function fmtDate(iso) {
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  const d = bare ? new Date(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3])) : new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

function loadPref(key) {
  try { return localStorage.getItem(`re:pref:${key}`) || ""; } catch { return ""; }
}
function savePref(key, value) {
  try { localStorage.setItem(`re:pref:${key}`, value); } catch { /* ignore */ }
}

// ---- CSV (same rules as the server's writer) -------------------------------------------

function csvCell(value) {
  let text = value === undefined || value === null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function trackedCsv(rows) {
  const header = ["name", "outcome", "trust_at_call", "trust_tone_at_call", "note", "phone", "email", "website", "address", "search_query", "search_near", "updated_at"];
  const lines = rows.map(r => [
    r.name, OUTCOME_LABEL[r.status] || r.status, r.trust ? r.trust.pill : "", r.trust ? r.trust.tone : "", r.note, r.phone, r.email, r.website, r.address,
    r.search ? r.search.query : "", r.search ? r.search.near : "", r.updatedAt,
  ].map(csvCell).join(","));
  return [header.map(csvCell).join(","), ...lines].join("\n") + "\n";
}

function download(name, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---- state ----------------------------------------------------------------------------

const app = {
  status: null,
  running: false,
  lastParams: null,
  direction: "auto",
  map: null,
  origin: undefined,        // undefined until the origin event arrives
  result: null,
  filter: "all",
  items: [],                // main list: { lead, el, band, collapsed }
  bands: new Map(),
  rows: new Map(),          // lead key -> row controllers (a business can appear in more than one list)
  openRow: null,
  steps: {},
  sources: new Map(),       // source id -> { name, text } while fetching
  startedAt: 0,
  contactsEnabled: false,
  newKeys: new Set(),
  newSince: null,
  codeBoxReason: "",
  skipBuyerCaveat: false,
};

let toastTimer = 0;
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { el.textContent = ""; }, 4000);
}

function scrollTo(el) {
  const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
}

// ---- tabs -------------------------------------------------------------------------------

function selectTab(which, focus) {
  const find = which === "find";
  $("tab-find").setAttribute("aria-selected", String(find));
  $("tab-calls").setAttribute("aria-selected", String(!find));
  $("tab-find").tabIndex = find ? 0 : -1;
  $("tab-calls").tabIndex = find ? -1 : 0;
  $("panel-find").hidden = !find;
  $("panel-calls").hidden = find;
  if (!find) renderCalls();
  if (focus) $(find ? "tab-find" : "tab-calls").focus();
}

function setupTabs() {
  $("tab-find").addEventListener("click", () => selectTab("find"));
  $("tab-calls").addEventListener("click", () => selectTab("calls"));
  for (const id of ["tab-find", "tab-calls"]) {
    $(id).addEventListener("keydown", event => {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const next = event.key === "Home" ? "find" : event.key === "End" ? "calls" : id === "tab-find" ? "calls" : "find";
        selectTab(next, true);
      }
    });
  }
}

function updateCallsCount() {
  $("calls-count").textContent = String(allTracked().length);
}

// ---- status & form -----------------------------------------------------------------------

async function loadStatus() {
  let status = { llm: true, contactsProvider: null, regions: [], defaultRegion: "" };
  try {
    const resp = await fetch("/api/status");
    if (resp.ok) status = await resp.json();
  } catch {
    // keep defaults: the search itself will surface a connection problem
  }
  app.status = status;

  const contacts = $("find-contacts");
  if (!status.contactsProvider) {
    contacts.checked = false;
    contacts.disabled = true;
    $("contacts-hint").hidden = false;
  }
  const noLlm = $("no-llm");
  if (!status.llm) {
    noLlm.checked = true;
    noLlm.disabled = true;
    $("llm-hint").hidden = false;
  }
  const coverage = coverageLine(status.regions);
  const fine = document.querySelector(".ask-actions .quiet.fine");
  if (coverage !== "" && fine) fine.textContent += ` ${coverage}`;
  if (Array.isArray(status.regions) && status.regions.length > 1) {
    const select = $("region");
    for (const code of status.regions) select.append(h("option", { value: code, text: code.replace(/^US-/, "") }));
    select.value = status.defaultRegion;
    $("region-field").hidden = false;
  }
  updateCodeBox();
}

function setDirection(value) {
  app.direction = value;
  for (const b of $("direction").querySelectorAll("button")) {
    b.setAttribute("aria-pressed", b.dataset.direction === value ? "true" : "false");
  }
  updateCodeBox();
}

function setOptionsOpen(open) {
  $("options").hidden = !open;
  $("more-toggle").setAttribute("aria-expanded", String(open));
  updateCodeBox();
}

// The code finder shows itself inline, not buried in More options, when the
// search can't work without codes: Skip AI + finding buyers, or the map step
// found no industry for the request.
function updateCodeBox() {
  const skipSell = $("no-llm").checked && app.direction === "sell";
  const why = skipSell
    ? "Finding buyers without the AI step needs industry codes. Look them up here and add them."
    : app.codeBoxReason;
  $("code-why").textContent = why;
  $("code-why").hidden = why === "";
  $("code-box").hidden = !(why !== "" || !$("options").hidden || $("naics").value.trim() !== "");
}

// Skip AI + finding buyers + no codes: the search is known to come back empty.
function sellNeedsCodes(params) {
  return Boolean(params.noLlm && params.direction === "sell" && !params.naics);
}

// Instead of running that search, point at the code finder. Results on screen stay.
function blockForCodes() {
  updateCodeBox();
  scrollTo($("code-box"));
  $("code-q").focus();
}

// Puts a stored search's params back into the form.
function fillForm(params) {
  $("query").value = params.query || "";
  $("near").value = params.near || "";
  $("naics").value = Array.isArray(params.naics) ? params.naics.join(", ") : params.naics || "";
  setDirection(params.direction || "auto");
  $("radius").value = params.radiusMi ? String(params.radiusMi) : "";
  // The server may have forced Skip AI on; never undo that.
  if (!$("no-llm").disabled) $("no-llm").checked = params.noLlm === true;
  if (!$("region-field").hidden && params.region) $("region").value = params.region;
  updateCodeBox();
}

function readParams() {
  const query = $("query").value.trim();
  const params = { query };
  const near = $("near").value.trim();
  if (near) params.near = near;
  const radius = $("radius").value;
  if (radius) params.radiusMi = Number(radius);
  const naics = $("naics").value.trim();
  if (naics) params.naics = naics;
  params.findContacts = $("find-contacts").checked && !$("find-contacts").disabled;
  params.noLlm = $("no-llm").checked;
  params.leads = Number($("leads").value);
  if (app.direction !== "auto") params.direction = app.direction;
  if (!$("region-field").hidden && $("region").value) params.region = $("region").value;
  return params;
}

function showQueryError(message) {
  const box = $("query-error");
  box.textContent = message;
  box.hidden = message === "";
  $("query").setAttribute("aria-invalid", message === "" ? "false" : "true");
}

function setupForm() {
  $("search-form").addEventListener("submit", event => {
    event.preventDefault();
    if (app.running) return;
    const params = readParams();
    if (params.query.length < 3) {
      showQueryError("Tell us what you need or sell (at least a few words).");
      $("query").focus();
      return;
    }
    showQueryError("");
    if (sellNeedsCodes(params)) {
      blockForCodes();
      return;
    }
    savePref("near", params.near || "");
    runSearch(params);
  });
  $("query").addEventListener("input", () => showQueryError(""));
  for (const b of document.querySelectorAll(".example")) {
    b.addEventListener("click", () => {
      $("query").value = b.textContent;
      // The example names its own town (or none): it is the centre, not a stale Near.
      $("near").value = "";
      showQueryError("");
      $("query").focus();
    });
  }
  $("more-toggle").addEventListener("click", () => setOptionsOpen($("options").hidden));
  for (const b of $("direction").querySelectorAll("button")) {
    b.addEventListener("click", () => setDirection(b.dataset.direction));
  }
  $("no-llm").addEventListener("change", updateCodeBox);
  $("retry").addEventListener("click", () => {
    if (app.lastParams && !app.running) runSearch(app.lastParams);
  });
  $("print").addEventListener("click", () => window.print());
  $("save").addEventListener("click", () => saveCurrentSearch());
  $("calls-csv").addEventListener("click", downloadCalls);

  const lookup = async () => {
    const q = $("code-q").value.trim();
    const list = $("code-results");
    const status = $("code-status");
    clear(list);
    if (q === "") {
      status.textContent = "Type a few words, like \"metal fabrication\".";
      return;
    }
    status.textContent = "Searching…";
    try {
      const resp = await fetch(`/api/codes?q=${encodeURIComponent(q)}`);
      if (!resp.ok) throw new Error("lookup failed");
      const codes = await resp.json();
      if (codes.length === 0) {
        status.textContent = "No matches. Try fewer or different words.";
        return;
      }
      status.textContent = `${codes.length} match${codes.length === 1 ? "" : "es"}. Choose one to add it.`;
      for (const entry of codes) {
        list.append(h("li", null, h("button", { type: "button", class: "code-hit", onclick: () => addCode(entry.code) },
          h("span", { class: "code", text: entry.code }), entry.title, h("span", { class: "desc", text: entry.description }))));
      }
    } catch {
      status.textContent = "Couldn't look up codes just now. Try again.";
    }
  };
  $("code-search").addEventListener("click", lookup);
  $("code-q").addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      lookup();
    }
  });
}

function addCode(code) {
  const input = $("naics");
  const existing = input.value.split(/[\s,]+/).filter(Boolean);
  if (!existing.includes(code)) existing.push(code);
  input.value = existing.join(", ");
  $("code-status").textContent = `Added ${code}. Press "Find businesses" to search with it.`;
}

// ---- progress ------------------------------------------------------------------------------

const STEP_DEFS = [
  ["map", "Reading your request"],
  ["records", "Searching public records"],
  ["confirm", "Checking names against the state registry"],
  ["contacts", "Looking up contacts on the web"],
  ["notes", "Writing call notes"],
];

function buildSteps() {
  const list = $("steps");
  clear(list);
  app.steps = {};
  for (const [id, label] of STEP_DEFS) {
    if (id === "contacts" && !app.contactsEnabled) continue;
    const detail = h("span", { class: "step-detail" });
    const li = h("li", { "data-state": "pending" }, h("span", { text: label }), detail);
    li.hidden = true;
    list.append(li);
    app.steps[id] = { li, detail };
  }
  list.hidden = false;
}

function setStep(id, state, detail) {
  const step = app.steps[id];
  if (!step) return;
  step.li.hidden = false;
  step.li.setAttribute("data-state", state);
  if (detail !== undefined) step.detail.textContent = detail;
}

function addNote(message) {
  $("notes").append(h("li", { text: message }));
}

const VIA_TEXT = {
  table: "recognized from common requests",
  llm: "read with AI",
  override: "using the industry codes you entered",
  none: "no industry matched",
};

function handleEvent(event) {
  switch (event.type) {
    case "map": {
      app.map = event;
      if (event.llmError) {
        addNote(`The AI step failed (${event.llmError}). ${llmFailedHint(app.status && app.status.llmBilling)}`);
      }
      setStep("map", "done", VIA_TEXT[event.via] || "");
      setStep("records", "active", "");
      app.codeBoxReason = event.naics.length === 0
        ? "We couldn't match your request to an industry. Find codes by words, add them, and search again."
        : "";
      updateCodeBox();
      renderReading();
      scrollTo($("reading"));
      break;
    }
    case "origin":
      app.origin = event.origin;
      renderReading();
      break;
    case "routed":
      if (event.sources.length === 0) setStep("records", "active", "no public records cover this request in this state");
      for (const s of event.sources) app.sources.set(s.id, { name: s.name, text: "searching" });
      break;
    case "fetched": {
      const s = app.sources.get(event.sourceId) || { name: event.sourceId };
      s.text = fetchedText(event.count, event.capped);
      app.sources.set(event.sourceId, s);
      setStep("records", "active", [...app.sources.values()].map(v => `${v.name.replace(/\s*\(.*\)$/, "")}: ${v.text}`).join(" · "));
      break;
    }
    case "source_error": {
      const s = app.sources.get(event.sourceId);
      addNote(`${s ? s.name : event.sourceId} didn't respond, so its results are missing. ${String(event.message).slice(0, 160)}`);
      break;
    }
    case "backfill_progress":
      setStep("records", "done");
      setStep("confirm", "active", registryProgressText(event.checked, event.total));
      break;
    case "backfilled":
      setStep("records", "done");
      setStep("confirm", "active", `${event.count} matched`);
      break;
    case "merged":
      setStep("records", "done");
      setStep("confirm", "done");
      break;
    case "probed":
      setStep(app.contactsEnabled ? "contacts" : "notes", "active", "");
      break;
    case "contacts":
      setStep("contacts", "done", `${event.found} of ${event.looked} found via ${event.provider}`);
      setStep("notes", "active", "");
      break;
    default:
      break;
  }
}

function failSteps() {
  for (const id of Object.keys(app.steps)) {
    if (app.steps[id].li.getAttribute("data-state") === "active") setStep(id, "error");
  }
}

// ---- reading line ---------------------------------------------------------------------------

function renderReading() {
  const box = $("reading-lines");
  clear(box);
  const map = app.map;
  if (!map) return;
  $("reading").hidden = false;

  const side = map.direction === "sell" ? "buyers" : "suppliers";
  const line = h("div", { class: "line" }, h("span", { class: "label", text: "We read this as" }));
  const dir = h("span", null, "looking for ", h("strong", { text: side }));
  if (!map.directionFixed) {
    const other = map.direction === "sell" ? "buy" : "sell";
    dir.append(" ", h("span", { class: "quiet", text: "(guessed)" }), " · ", h("button", {
      type: "button",
      class: "btn sm",
      onclick: () => {
        setDirection(other);
        if (app.running || !app.lastParams) return;
        // A direction switch is a new search: it never inherits "check all".
        const next = { ...app.lastParams, direction: other };
        delete next.checkAll;
        if (sellNeedsCodes(next)) {
          blockForCodes();
          return;
        }
        runSearch(next);
      },
    }, other === "sell" ? "find buyers instead" : "find suppliers instead"));
  }
  line.append(dir);
  if (app.origin !== undefined) {
    line.append(h("span", { class: "quiet", "aria-hidden": "true", text: "·" }));
    if (app.origin === null) {
      if (app.lastParams && app.lastParams.near) {
        const region = String(app.lastParams.region || (app.status && app.status.defaultRegion) || "this state").replace(/^US-/, "");
        line.append(h("span", null, h("strong", { text: `couldn't find "${app.lastParams.near}" in ${region}` }), ", so results aren't sorted by distance"));
      } else {
        line.append(h("span", { text: "whole state, no distance (add a ZIP or town to sort by distance)" }));
      }
    } else {
      line.append(h("span", null, "whole state, sorted from ", h("strong", { text: app.origin.label })));
    }
  }
  box.append(line);

  const codes = h("div", { class: "line fine quiet" },
    h("span", { text: map.naics.length > 0 ? `Industries: ${map.naics.map(n => n.title || n.code).join(" · ")}` : "Industries: none matched yet" }),
    h("button", {
      type: "button",
      class: "btn sm",
      onclick: () => {
        if (map.naics.length > 0) $("naics").value = map.naics.map(n => n.code).join(", ");
        setOptionsOpen(true);
        $("naics").focus();
        scrollTo($("code-box"));
      },
    }, "Change codes"));
  box.append(codes);
  // The AI's caveats get a label so they don't float; they print with the sheet.
  // On the empty page the buyer tip already says the map.ts "finding buyers needs the AI step" caveat.
  const caveats = app.skipBuyerCaveat ? map.caveats.filter(c => !c.startsWith("finding buyers needs the AI step")) : map.caveats;
  if (caveats.length > 0) {
    box.append(h("div", { class: "caveats" },
      h("h2", { class: "label", text: "Before you call" }),
      caveats.map(c => h("p", { class: "caveat", text: c }))));
  }
}

// ---- running a search -----------------------------------------------------------------------

function resetForRun(params) {
  app.map = null;
  app.origin = undefined;
  app.result = null;
  app.items = [];
  app.bands = new Map();
  app.rows = new Map();
  app.openRow = null;
  app.newKeys = new Set();
  app.newSince = null;
  app.filter = "all";
  app.codeBoxReason = "";
  app.skipBuyerCaveat = false;
  app.contactsEnabled = params.findContacts === true;
  app.sources = new Map();
  app.startedAt = Date.now();

  $("how").hidden = true;
  $("error-box").hidden = true;
  $("empty").hidden = true;
  $("results-area").hidden = true;
  $("csv").href = "/api/csv";
  for (const id of ["reading-lines", "notes", "bands", "groups", "filters", "about-rows"]) clear($(id));
  $("reading").hidden = false;
  buildSteps();
  setStep("map", "active", "");
  updateCodeBox();
}

function showError(message) {
  failSteps();
  $("error-text").textContent = message;
  $("error-box").hidden = false;
  scrollTo($("error-box"));
}

async function runSearch(params) {
  app.running = true;
  app.lastParams = params;
  const go = $("go");
  go.disabled = true;
  go.textContent = "Searching…";
  resetForRun(params);

  let finished = false;
  try {
    const resp = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!resp.ok) {
      let message = `The server answered with an error (${resp.status}).`;
      try {
        const body = await resp.json();
        if (resp.status === 429) message = "Another search is still running. Wait for it to finish, then try again.";
        else if (body && body.error) message = String(body.error);
      } catch {
        // keep the generic message
      }
      showError(message);
      return;
    }
    if (!resp.body) throw new Error("This browser can't stream results.");

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const consume = line => {
      if (line.trim() === "") return;
      let event;
      try { event = JSON.parse(line); } catch { return; }
      if (event.type === "result") {
        finished = true;
        $("steps").hidden = true;
        showResult(event);
        loadRecent();
      } else if (event.type === "error") {
        finished = true;
        showError(String(event.message || "The search failed."));
      } else {
        handleEvent(event);
      }
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        consume(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    }
    consume(buffer + decoder.decode());
    if (!finished) showError("The connection closed before the search finished.");
  } catch (err) {
    if (!finished) {
      showError(err instanceof TypeError
        ? "Couldn't reach the Registry Engine server. Is it still running? Start it again with npm start."
        : String(err && err.message ? err.message : err));
    }
  } finally {
    app.running = false;
    go.disabled = false;
    go.textContent = "Find businesses";
  }
}

// ---- results ----------------------------------------------------------------------------------

function mainLeads(result) {
  return [...result.leads, ...result.more];
}

// opts.stored: the ISO date of a sheet opened from Recent searches (not a run).
function showResult(result, opts = {}) {
  const stored = opts.stored || null;
  app.result = result;
  app.skipBuyerCaveat = false;
  if (result.origin !== undefined) app.origin = result.origin;
  renderReading();

  const main = mainLeads(result);
  const any = main.length + result.individuals.length + result.nameOnly.length + (result.recent || []).length;
  if (main.length === 0) renderEmpty();
  if (any === 0) return;

  const keys = main.map(l => l.key);
  const saved = stored ? null : findSaved(app.lastParams);
  if (saved) {
    const prior = new Set(Array.isArray(saved.seen) ? saved.seen : []);
    app.newKeys = new Set(keys.filter(k => !prior.has(k)));
    app.newSince = saved.lastRunAt;
    const id = searchId(saved);
    storeSaved(loadSaved().map(e => (searchId(e) === id ? { ...e, seen: keys.slice(0, SEEN_MAX), lastRunAt: new Date().toISOString() } : e)));
    renderSaved();
  }

  $("results-area").hidden = false;
  renderSummary(result, stored);
  renderTools(stored);
  renderBands(result);
  renderGroups(result);
  renderAbout(result, stored);
  applyFilter();
}

function renderEmpty() {
  $("announce").textContent = "Search done. No businesses found.";
  const tips = $("empty-tips");
  clear(tips);
  const p = app.lastParams || {};
  const items = [];
  const needsCodes = Boolean(app.map && app.map.direction === "sell" && app.map.naics.length === 0);
  if (needsCodes) {
    items.push("Finding buyers needs industry codes: turn on the AI step, or add codes with the code finder under More options.");
    // The tip says it; the reading line's "Before you call" doesn't repeat it.
    app.skipBuyerCaveat = true;
    renderReading();
  }
  if (p.radiusMi) items.push("Remove the distance limit, or choose a larger radius under More options.");
  if (!app.map || app.map.direction !== "sell") items.push("Try different words, like \"metal fabrication shop\".");
  if (!needsCodes) items.push("Add industry codes with the code finder under More options.");
  for (const text of items.slice(0, 3)) tips.append(h("li", { text }));
  $("empty").hidden = false;
  scrollTo($("empty"));
}

// One plain sentence instead of stat tiles.
function renderSummary(result, stored) {
  const box = $("sum");
  clear(box);
  const parts = summaryParts(result, { radiusSet: Boolean(app.lastParams && app.lastParams.radiusMi) });
  for (const [text, strong] of parts) box.append(strong ? h("strong", { text }) : text);
  // Screen readers: the results arrive without a page change, so say so.
  $("announce").textContent = `Search done. ${box.textContent}`;
  const p = app.lastParams || {};
  $("print-head").textContent = `Call sheet · ${p.query || ""}${app.origin ? ` · from ${app.origin.label}` : ""} · ${stored ? fmtDate(stored) : new Date().toLocaleDateString()}`;
}

function renderTools(stored) {
  const already = findSaved(app.lastParams) !== null;
  $("save").textContent = already ? "Saved" : "Save search";
  $("save").disabled = already;
  const ns = $("new-since");
  if (stored) {
    ns.textContent = `Results from ${fmtDate(stored)}. Run again to refresh.`;
    ns.hidden = false;
  } else if (app.newSince !== null) {
    const n = app.newKeys.size;
    const date = fmtDate(app.newSince);
    const tail = "New businesses can only come from live records (state registry, EPA, farm products); the PPP loan data is a fixed 2020–21 snapshot.";
    ns.textContent = n > 0 ? `${n} new since ${date}. ${tail}` : `Nothing new since ${date}. ${tail}`;
    ns.hidden = false;
  } else {
    ns.hidden = true;
  }
  renderRegistryLine();
  const seg = $("filters");
  clear(seg);
  // "No web presence" means something only when a web lookup ran this search.
  const lookupRan = Boolean(app.result && app.result.contactLookups);
  for (const [id, label] of FILTERS) {
    if (id === "noweb" && !lookupRan) continue;
    seg.append(h("button", {
      type: "button",
      "data-filter": id,
      "aria-pressed": id === app.filter ? "true" : "false",
      onclick: () => {
        app.filter = id;
        applyFilter();
      },
    }, label, h("span", { class: "n", text: "0" })));
  }
}

// "Checked 80 of 384 names against the state registry." plus the button that
// re-runs the search with every name checked. A stored result shows its own line.
function renderRegistryLine() {
  const box = $("registry-line");
  clear(box);
  const line = registryLine(app.result ? app.result.registryLookup : null);
  if (!line) {
    box.hidden = true;
    return;
  }
  box.append(line.text);
  if (line.button) {
    box.append(" ", h("button", {
      type: "button",
      class: "btn sm",
      text: line.button,
      onclick: () => {
        if (app.running || !app.lastParams) return;
        const next = { ...app.lastParams, checkAll: true };
        if (sellNeedsCodes(next)) {
          blockForCodes();
          return;
        }
        runSearch(next);
      },
    }));
  }
  box.hidden = false;
}

function saveCurrentSearch() {
  const result = app.result;
  if (!result) return;
  const p = app.lastParams || {};
  const now = new Date().toISOString();
  const entry = {
    query: String(p.query || ""),
    near: p.near || "",
    naics: p.naics || "",
    direction: p.direction || "auto",
    savedAt: now,
    lastRunAt: now,
    seen: mainLeads(result).map(l => l.key).slice(0, SEEN_MAX),
  };
  const id = searchId(entry);
  const list = loadSaved().filter(e => searchId(e) !== id);
  list.push(entry);
  if (!storeSaved(list.slice(-SAVED_MAX))) {
    toast("Couldn't save. Browser storage is blocked.");
    return;
  }
  $("save").textContent = "Saved";
  $("save").disabled = true;
  renderSaved();
  toast("Saved. Run it again later to see what's new.");
}

function renderSaved() {
  const list = loadSaved();
  const ul = $("saved-list");
  clear(ul);
  $("saved").hidden = list.length === 0;
  for (const entry of list) {
    const info = [
      entry.near ? `near ${entry.near}` : "",
      entry.naics ? `codes ${entry.naics}` : "",
      entry.direction === "buy" ? "suppliers" : entry.direction === "sell" ? "buyers" : "",
      fmtDate(entry.lastRunAt) ? `last run ${fmtDate(entry.lastRunAt)}` : "",
    ].filter(Boolean);
    ul.append(h("li", { class: "saved-item" },
      h("div", { class: "saved-info" }, h("strong", { text: entry.query }), info.map(t => h("span", { class: "fine quiet", text: t }))),
      h("div", { class: "saved-buttons" },
        h("button", {
          type: "button", class: "btn sm", text: "Run", "aria-label": `Run saved search: ${entry.query}`,
          onclick: () => {
            $("query").value = entry.query;
            $("near").value = entry.near || "";
            $("naics").value = entry.naics || "";
            setDirection(entry.direction || "auto");
            showQueryError("");
            const params = readParams();
            if (sellNeedsCodes(params)) {
              blockForCodes();
              return;
            }
            if (!app.running) runSearch(params);
          },
        }),
        h("button", {
          type: "button", class: "btn sm", text: "Remove", "aria-label": `Remove saved search: ${entry.query}`,
          onclick: () => {
            const id = searchId(entry);
            storeSaved(loadSaved().filter(e => searchId(e) !== id));
            renderSaved();
          },
        }))));
  }
}

// ---- recent searches (kept on disk by the server) --------------------------------------------

async function loadRecent() {
  let list;
  try {
    const resp = await fetch("/api/history");
    if (!resp.ok) throw new Error(String(resp.status));
    list = await resp.json();
  } catch {
    toast("Couldn't load recent searches.");
    return;
  }
  const ul = $("recent-list");
  clear(ul);
  const entries = Array.isArray(list) ? list.filter(e => e && typeof e.id === "string" && typeof e.query === "string") : [];
  $("recent").hidden = entries.length === 0;
  for (const entry of entries) {
    const n = typeof entry.businesses === "number" ? entry.businesses : null;
    const info = [
      entry.near ? `near ${entry.near}` : "",
      Array.isArray(entry.naics) && entry.naics.length > 0 ? `codes ${entry.naics.join(", ")}` : "",
      entry.direction === "buy" ? "suppliers" : entry.direction === "sell" ? "buyers" : "",
      fmtDate(entry.ranAt) ? `ran ${fmtDate(entry.ranAt)}` : "",
      n === null ? "" : `${n.toLocaleString()} ${n === 1 ? "business" : "businesses"}`,
    ].filter(Boolean);
    ul.append(h("li", { class: "saved-item" },
      h("div", { class: "saved-info" }, h("strong", { text: entry.query }), info.map(t => h("span", { class: "fine quiet", text: t }))),
      h("div", { class: "saved-buttons" },
        h("button", {
          type: "button", class: "btn sm", text: "Open", "aria-label": `Open recent search: ${entry.query}`,
          onclick: () => openRecent(entry.id),
        }),
        h("button", {
          type: "button", class: "btn sm", text: "Run again", "aria-label": `Run again: ${entry.query} (recent search)`,
          onclick: () => runRecentAgain(entry.id),
        }))));
  }
}

async function fetchRecent(id) {
  try {
    const resp = await fetch(`/api/history/${encodeURIComponent(id)}`);
    if (resp.status === 404) {
      toast("That search is no longer stored.");
      return null;
    }
    if (!resp.ok) {
      toast("Couldn't open that search.");
      return null;
    }
    return await resp.json();
  } catch {
    toast("Couldn't reach the Registry Engine server. Is it still running? Start it again with npm start.");
    return null;
  }
}

// Opening is not a run: no search, no AI calls, no saved-search update.
async function openRecent(id) {
  if (app.running) return;
  const stored = await fetchRecent(id);
  if (!stored || app.running) return;
  fillForm(stored.params || {});
  app.lastParams = readParams();
  resetForRun(app.lastParams);
  $("steps").hidden = true;
  app.map = stored.map || null;
  $("csv").href = `/api/csv?id=${encodeURIComponent(id)}`;
  showResult(stored.result, { stored: stored.ranAt });
}

// Run again goes through the submit path, so its checks apply.
async function runRecentAgain(id) {
  if (app.running) return;
  const stored = await fetchRecent(id);
  if (!stored || app.running) return;
  fillForm(stored.params || {});
  $("search-form").requestSubmit();
}

// ---- filters ----------------------------------------------------------------------------------

function filterPred() {
  return (FILTERS.find(f => f[0] === app.filter) || FILTERS[0])[2];
}

function applyFilter() {
  const pred = filterPred();
  const all = app.filter === "all";
  const matchCount = new Map();
  for (const item of app.items) {
    const match = pred(item.lead, outcomeOf(item.lead));
    item.el.hidden = !(match && (!all || !item.collapsed));
    if (match) matchCount.set(item.band, (matchCount.get(item.band) || 0) + 1);
  }
  let any = false;
  for (const band of app.bands.values()) {
    const matches = matchCount.get(band) || 0;
    band.section.hidden = matches === 0;
    band.countEl.textContent = all ? `${band.items.length} ${band.items.length === 1 ? "business" : "businesses"}` : `${matches} of ${band.items.length}`;
    const collapsed = band.items.filter(i => i.collapsed).length;
    band.moreEl.hidden = !all || collapsed === 0;
    band.moreCount.textContent = `${collapsed} more in this band`;
    if (matches > 0) any = true;
  }
  $("filter-empty").hidden = any || app.items.length === 0;
  updateFilterCounts();
}

// Counts follow tracker changes at once; rows move only on the next filter
// click, so a row doesn't vanish while you are typing a note in it.
function updateFilterCounts() {
  for (const button of $("filters").children) {
    const id = button.getAttribute("data-filter");
    const f = FILTERS.find(x => x[0] === id);
    button.setAttribute("aria-pressed", id === app.filter ? "true" : "false");
    button.lastChild.textContent = String(app.items.filter(item => f[2](item.lead, outcomeOf(item.lead))).length);
  }
}

// ---- bands --------------------------------------------------------------------------------------

const BAND_PREVIEW = 5;   // rows shown in a band that has none of the top results

function renderBands(result) {
  const container = $("bands");
  const top = new Set(result.leads.map(l => l.id));
  for (const lead of mainLeads(result)) {
    const key = lead.band || "";
    let band = app.bands.get(key);
    if (!band) {
      const countEl = h("span", { class: "fine quiet num" });
      const list = h("div", { class: "band-list" });
      const moreCount = h("span");
      const created = { key, items: [] };
      const moreEl = h("p", { class: "band-more" }, moreCount, " · ", h("button", {
        type: "button",
        class: "linkish",
        onclick: () => {
          for (const item of created.items) item.collapsed = false;
          applyFilter();
        },
      }, "Show them"));
      const headingId = `band-${app.bands.size}`;
      const section = h("section", { class: "band", "aria-labelledby": headingId },
        h("h2", { class: "band-head" }, h("span", { class: "eyebrow", id: headingId, text: bandTitle(key) }), countEl),
        list, moreEl);
      container.append(section);
      band = Object.assign(created, { section, list, countEl, moreEl, moreCount });
      app.bands.set(key, band);
    }
    const el = leadRow(lead);
    band.list.append(el);
    const item = { lead, el, band, collapsed: !top.has(lead.id) };
    band.items.push(item);
    app.items.push(item);
  }
  // A band with none of the top results previews its first rows.
  for (const band of app.bands.values()) {
    if (band.items.every(i => i.collapsed)) band.items.slice(0, BAND_PREVIEW).forEach(i => { i.collapsed = false; });
  }
}

// ---- collapsed groups: individuals, name-only, recent filings ------------------------------------

function renderGroups(result) {
  const box = $("groups");
  const group = (title, count, why, leads, note, rowOpts, minor = false) => {
    if (count === 0) return;
    // Collapsed by default (no "open"); a minor group reads quieter than the bands.
    box.append(h("details", { class: minor ? "group minor" : "group" },
      h("summary", null, h("span", { class: "label", text: `${title} · ${count.toLocaleString()}` }), h("span", { class: "why", text: why })),
      h("div", { class: "inner" },
        note ? h("p", { class: "group-note", text: note }) : null,
        leads.map(l => leadRow(l, rowOpts)))));
  };
  const s = result.sheet;
  group("Individuals' records", s.individuals,
    "Sole proprietors and others filed under a person's name. Shown as filed, with no map link and no web search.",
    result.individuals, s.individuals > result.individuals.length ? `Showing ${result.individuals.length}. The CSV has all of them.` : "", {});
  group("Name matches only", s.nameOnly,
    "Records whose names contain your words but carry no industry code for this work. Most are unrelated.",
    result.nameOnly,
    `Open this only if the coded list runs dry.${s.nameOnly > result.nameOnly.length ? ` Showing ${result.nameOnly.length}; the CSV has all ${s.nameOnly.toLocaleString()}.` : ""}`, {});
  const w = result.recentWindow;
  if (w && Array.isArray(result.recent)) {
    group(`Registered in the last ${w.days} days`, result.recent.length,
      `New state filings within ${w.radiusMi} miles whose names match your words. The registry records no industry code, so these are name matches. Addresses are the filing address.`,
      result.recent, "", { registered: true }, true);
  }
}

// ---- about this search ----------------------------------------------------------------------------

function renderAbout(result, stored) {
  const rows = $("about-rows");
  clear(rows);
  // An opened sheet has no run time.
  const seconds = stored ? null : Math.max(1, Math.round((Date.now() - app.startedAt) / 1000));
  for (const [k, v] of aboutRows(result, app.status || {}, seconds)) {
    rows.append(h("tr", null, h("th", { scope: "row", text: k }), h("td", { text: v })));
  }
}

// ---- lead rows ------------------------------------------------------------------------------------

// The name as shown on the sheet: display case for businesses, as filed for
// individuals' records (ADR 0017). CSV, history and clipboard keep lead.name.
function shownName(lead) {
  return lead.individual === true ? lead.name : displayName(lead.name);
}

function distanceCell(lead) {
  const a = lead.address;
  const place = [displayCity(a.city), a.zip].filter(Boolean).join(" ");
  return h("span", { class: "lr-dist" },
    typeof lead.distanceMi === "number" ? h("b", { text: `${lead.distanceMi} mi` }) : null,
    place);
}

function trustLine(lead, tracker, opts) {
  const t = trustLabel(lead, app.result ? app.result.registryLookup : null);
  const call = callStatusText(tracker);
  const tag = opts.registered ? null : t.tag || (lead.individual ? null : webTag(lead));
  return h("span", { class: "lr-trust" },
    h("span", { class: `pill ${t.tone}`, text: t.pill }),
    tag ? h("span", { class: "trust-tag", text: tag }) : null,
    call ? h("span", { class: "lr-call", text: call }) : null,
    app.newKeys.has(lead.key) ? h("span", { class: "lr-new", text: `New since ${shortDate(app.newSince)}` }) : null);
}

function reachLine(lead) {
  const r = reachSummary(lead);
  if (r.phone) return h("span", { class: "lr-reach" }, h("b", { text: r.phone }), ` · ${r.source}`);
  if (!r.place && !r.principal) return null;
  return h("span", { class: "lr-reach" }, r.place, r.principal ? [r.place ? " · " : "", "agent/principal ", h("b", { text: r.principal })] : null);
}

let rowSeq = 0;

function leadRow(lead, opts = {}) {
  const detailId = `detail-${++rowSeq}`;
  const article = h("article", { class: "lead-row" });
  const head = h("button", { type: "button", class: "lr-head", "aria-expanded": "false", "aria-controls": detailId });
  const detail = h("div", { class: "detail", id: detailId });
  detail.hidden = true;

  const paintHead = () => {
    clear(head);
    const what = opts.registered
      ? `Name match · registered ${fmtDate(lead.formedDate) || "recently"}`
      : whatLine(lead);
    head.append(
      h("span", { class: "lr-name", text: shownName(lead) }),
      distanceCell(lead),
      h("span", { class: "lr-what", text: what }),
      trustLine(lead, leadTracker(lead), opts),
      reachLine(lead));
  };
  paintHead();

  const ctrl = { lead, article, head, detail, paintHead, built: false };
  const list = app.rows.get(lead.key) || [];
  list.push(ctrl);
  app.rows.set(lead.key, list);

  head.addEventListener("click", () => toggleRow(ctrl));
  article.addEventListener("keydown", event => {
    if (event.key === "Escape" && head.getAttribute("aria-expanded") === "true") toggleRow(ctrl);
  });
  article.append(head, detail, h("div", { class: "notes-line", "aria-hidden": "true" }));
  return article;
}

function toggleRow(ctrl) {
  const open = ctrl.head.getAttribute("aria-expanded") !== "true";
  if (open && app.openRow && app.openRow !== ctrl) toggleRow(app.openRow);
  if (open && !ctrl.built) {
    buildDetail(ctrl);
    ctrl.built = true;
  }
  ctrl.head.setAttribute("aria-expanded", String(open));
  ctrl.detail.hidden = !open;
  ctrl.article.classList.toggle("open", open);
  app.openRow = open ? ctrl : null;
  if (!open && ctrl.article.contains(document.activeElement)) ctrl.head.focus();
}

// Repaint every row of a business after its tracker changes.
function repaintRows(key) {
  for (const ctrl of app.rows.get(key) || []) ctrl.paintHead();
}

// ---- expanded detail --------------------------------------------------------------------------------

function buildDetail(ctrl) {
  const lead = ctrl.lead;
  const left = h("section", null, h("h3", { class: "label", text: "Why it fits" }));
  if (lead.brief) left.append(h("p", { text: lead.brief }));
  if (lead.naics.length > 0) {
    const per = (lead.codeSources || []).map(s => s.name).join(", ");
    left.append(h("p", { class: "fine quiet", text: `Industry code${lead.naics.length === 1 ? "" : "s"}: ${lead.naics.slice(0, 3).map(n => `${n.code} ${n.title}`.trim()).join("; ")}${per ? `, per ${per}` : ""}` }));
  }
  if (lead.opener) {
    const quote = h("blockquote", { class: "opener-quote", text: lead.opener });
    const status = h("span", { class: "copied", "aria-live": "polite" });
    const copy = h("button", { type: "button", class: "btn sm", text: "Copy", "aria-label": `Copy what to say to ${shownName(lead)}` });
    copy.addEventListener("click", () => copyText(lead.opener, quote, status));
    left.append(h("h3", { class: "label", text: "What to say" }), quote, h("div", null, copy, " ", status));
  }

  const right = h("section", null, h("h3", { class: "label", text: "Reach" }), reachList(lead), callBox(ctrl));
  const evidence = Array.isArray(lead.evidence) && lead.evidence.length > 0
    ? lead.evidence.map(ev => `[${ev.source}] ${ev.field}=${ev.value}${ev.note ? ` (${ev.note})` : ""}`)
    : lead.sources.map(s => `[${s.id}] ${s.name}`);
  const where = h("section", { class: "span" },
    h("details", { class: "evid" },
      h("summary", { text: `Where this comes from (${evidence.length} ${evidence.length === 1 ? "record" : "records"})` }),
      h("ul", { class: "evid-list" }, evidence.map(t => h("li", { text: t })))));
  ctrl.detail.append(left, right, where);
}

function reachList(lead) {
  const dl = h("dl", { class: "reach-dl" });
  const row = (k, ...v) => dl.append(h("dt", { text: k }), h("dd", null, ...v));
  const f = lead.found && lead.found.status !== "skipped" ? lead.found : null;
  const verify = () => h("span", { class: "verify", text: ` · found via ${(f && f.provider) || "web search"}, verify` });
  if (shownName(lead) !== lead.name) row("Filed as", lead.name);
  const phones = new Set();
  const other = [];
  for (const raw of lead.contacts) {
    const c = classifyContact(raw);
    if (c.kind === "phone") {
      if (!phones.has(c.digits)) row("Phone", h("a", { href: `tel:${c.digits}`, text: c.value }));
      phones.add(c.digits);
    } else if (c.kind === "email") row("Email", h("a", { href: `mailto:${c.value}`, text: c.value }));
    else if (c.kind === "web") row("Website", extLink(bareSite(c.value), c.value));
    else other.push(c.value);
  }
  if (f && f.phone) {
    const d = phoneDigits(f.phone);
    if (d && !phones.has(d)) {
      phones.add(d);
      row("Phone", h("a", { href: `tel:${d}`, text: f.phone }), verify());
    }
  }
  if (f && f.email && EMAIL_RE.test(f.email)) row("Email", h("a", { href: `mailto:${f.email}`, text: f.email }), verify());
  if (f && f.website && safeHttpUrl(f.website)) row("Website", extLink(bareSite(f.website), f.website), verify());
  if (phones.size === 0) row("Phone", h("span", { class: "quiet", text: "Not on any public record" }));
  for (const t of other) row("Contact", t);

  const a = lead.address;
  const cityLine = [a.city, [a.state, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const address = [a.street, cityLine].filter(Boolean).join(", ");
  if (address) {
    const map = lead.individual ? null : mapsLink(lead.mapsUrl);
    row(lead.individual ? "Address as filed" : "Address", address, map ? [" · ", map] : null);
  }
  if (lead.officers.length > 0) row("Agent/principals", lead.officers.join("; "));
  if (lead.aka.length > 0) row("Also known as", lead.aka.slice(0, 3).join("; "));

  if (lead.individual) {
    row("Web", h("span", { class: "quiet", text: "Individual's record: no web search offered" }));
  } else {
    if (f && f.status === "directory" && f.listings.length > 0) row("Web", `Listed on ${f.listings.map(prettyHost).join(", ")}`);
    else if (f && f.status === "not-found" && !f.reason) row("Web", h("span", { class: "quiet", text: "A web search found nothing: likely no web presence" }));
    else if (lead.web === "verified") row("Web", "Website on record responds");
    const link = lead.searchUrl ? extLink("Search the web for this business", lead.searchUrl) : null;
    if (link) row(f || lead.web === "verified" ? "Search" : "Web", link);
    const sources = f ? (f.sourceUrls || []).map(u => ({ host: hostOf(u), url: u })).filter(s => s.host && safeHttpUrl(s.url)).slice(0, 4) : [];
    if (sources.length > 0) row("Found on", sources.flatMap((s, i) => [i > 0 ? ", " : "", extLink(s.host, s.url)]));
  }
  return dl;
}

async function copyText(text, quoteEl, status) {
  const done = () => {
    status.textContent = "Copied";
    window.setTimeout(() => { status.textContent = ""; }, 2000);
  };
  try {
    await navigator.clipboard.writeText(text);
    done();
    return;
  } catch {
    // fall through to the selection fallback
  }
  try {
    const range = document.createRange();
    range.selectNodeContents(quoteEl);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    if (document.execCommand("copy")) done();
    else toast("Press Ctrl+C (or Cmd+C) to copy the selected text.");
  } catch {
    toast("Press Ctrl+C (or Cmd+C) to copy the selected text.");
  }
}

function bestContacts(lead) {
  const pick = { phone: "", email: "", website: "" };
  for (const raw of lead.contacts) {
    const c = classifyContact(raw);
    if (c.kind === "phone" && !pick.phone) pick.phone = c.value;
    if (c.kind === "email" && !pick.email) pick.email = c.value;
    if (c.kind === "web" && !pick.website) pick.website = c.value;
  }
  const f = lead.found;
  if (f && f.status !== "skipped") {
    if (!pick.phone && f.phone) pick.phone = f.phone;
    if (!pick.email && f.email) pick.email = f.email;
    if (!pick.website && f.website) pick.website = f.website;
  }
  return pick;
}

function callBox(ctrl) {
  const lead = ctrl.lead;
  const saved = leadTracker(lead);
  let status = saved && OUTCOME_LABEL[saved.status] ? saved.status : "notcalled";
  const note = h("textarea", {
    class: "call-note",
    rows: "3",
    maxlength: "1000",
    placeholder: "Who you spoke to, what they said, when to follow up",
    "aria-label": `Notes about ${shownName(lead)}`,
  });
  note.value = saved && typeof saved.note === "string" ? saved.note : "";
  const savedAt = h("span", { class: "fine quiet", "aria-live": "polite" });
  let timer = 0;
  let dirty = false;

  const persist = () => {
    const contacts = bestContacts(lead);
    const a = lead.address;
    const p = app.lastParams || {};
    const prior = leadTracker(lead);
    const entry = {
      status,
      note: note.value.trim(),
      name: lead.name,
      individual: lead.individual === true,
      city: a.city || "",
      phone: contacts.phone,
      email: contacts.email,
      website: contacts.website,
      address: [a.street, [a.city, [a.state, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(", "),
      search: prior && prior.search ? prior.search : { query: String(p.query || ""), near: String(p.near || "") },
      trust: trustAtCall(prior, status, trustLabel(lead, app.result ? app.result.registryLookup : null)),
      updatedAt: new Date().toISOString(),
    };
    const ok = writeTracker(lead.key, entry);
    savedAt.textContent = ok ? "Saved on this computer" : "Couldn't save. Browser storage is blocked.";
    dirty = false;
    repaintRows(lead.key);
    updateFilterCounts();
    updateCallsCount();
  };

  const buttons = OUTCOMES.map(([id, label]) => h("button", {
    type: "button",
    "aria-pressed": id === status ? "true" : "false",
    text: label,
    onclick: () => {
      status = id;
      buttons.forEach((b, i) => b.setAttribute("aria-pressed", OUTCOMES[i][0] === status ? "true" : "false"));
      persist();
    },
  }));

  note.addEventListener("input", () => {
    dirty = true;
    window.clearTimeout(timer);
    timer = window.setTimeout(persist, 600);
  });
  note.addEventListener("blur", () => {
    window.clearTimeout(timer);
    if (dirty) persist();
  });

  return h("div", { class: "call-box" },
    h("h3", { class: "label", text: "Your call" }),
    h("div", { class: "seg", role: "group", "aria-label": `Call outcome for ${shownName(lead)}` }, buttons),
    note, savedAt);
}

// ---- my calls ----------------------------------------------------------------------------------------

function renderCalls() {
  const rows = allTracked();
  const body = $("calls-rows");
  clear(body);
  $("calls-title").textContent = `My calls · ${rows.length}`;
  $("calls-empty").hidden = rows.length > 0;
  $("calls-wrap").hidden = rows.length === 0;
  $("calls-csv").disabled = rows.length === 0;
  for (const r of rows) {
    const sub = [displayCity(r.city), r.phone || "no phone on record"].filter(Boolean).join(" · ");
    const from = r.search ? [r.search.query, r.search.near].filter(Boolean).join(" · ") : "";
    body.append(h("tr", null,
      h("td", null, h("b", { text: r.individual === false ? displayName(r.name || "") : r.name || "" }), h("br"), h("span", { class: "fine quiet", text: sub })),
      h("td", { class: "fine", text: from || "an earlier search" }),
      h("td", { class: "outcome", text: OUTCOME_LABEL[r.status] || "" }),
      h("td", { text: r.note || "" }),
      h("td", { class: "fine num", text: shortDate(r.updatedAt) })));
  }
  updateCallsCount();
}

function downloadCalls() {
  const rows = allTracked();
  if (rows.length === 0) {
    toast("No calls yet. Mark how a call went, or add a note, and it shows up here.");
    return;
  }
  download("my-calls.csv", trackedCsv(rows));
  toast(`Saved ${rows.length} call${rows.length === 1 ? "" : "s"}.`);
}

// ---- boot ----------------------------------------------------------------------------------------------

setupTabs();
setupForm();
renderSaved();
loadRecent();
updateCallsCount();
$("near").value = loadPref("near");
loadStatus();

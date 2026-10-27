// Registry Engine UI. Vanilla ES module, no build step.
//
// Safety rule: data from the server (business names, registry text, web
// results) is only ever put on the page with textContent / text nodes, never
// as HTML. Links are built only from validated URLs.

const $ = id => document.getElementById(id);

// ---- DOM helper ----------------------------------------------------------

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
    if (kid === undefined || kid === null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

function svgEl(tag, attrs, ...kids) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === "text") el.textContent = String(value);
      else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, String(value));
    }
  }
  for (const kid of kids.flat()) {
    if (kid === undefined || kid === null || kid === false) continue;
    el.append(kid);
  }
  return el;
}

function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

// ---- link / contact safety -------------------------------------------------

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
const PHONE_RE = /^\+?[\d\s().\-]{7,}(?:\s*(?:x|ext\.?)\s*\d+)?$/i;
const HOST_RE = /^(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:[/?#]\S*)?$/i;

function classifyContact(raw) {
  const value = String(raw).trim();
  if (EMAIL_RE.test(value)) return { kind: "email", value };
  const digits = value.replace(/\D/g, "");
  if (PHONE_RE.test(value) && digits.length >= 10 && digits.length <= 11) return { kind: "phone", value, digits };
  if (HOST_RE.test(value) && safeHttpUrl(value) !== null) return { kind: "web", value };
  return { kind: "text", value };
}

function extLink(text, url, cls) {
  const safe = safeHttpUrl(url);
  if (safe === null) return null;
  return h("a", { href: safe, target: "_blank", rel: "noopener noreferrer", class: cls, text });
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

function prettyHost(host) {
  const first = String(host).replace(/^www\./, "").split(".")[0] || String(host);
  return first.length <= 3 ? first.toUpperCase() : first.charAt(0).toUpperCase() + first.slice(1);
}

// ---- storage (every access guarded: it can be blocked or full) --------------

const TRACKER_PREFIX = "re:tracker:";
const STATUSES = [["new", "New"], ["called", "Called"], ["interested", "Interested"], ["notfit", "Not a fit"]];
const STATUS_LABEL = Object.fromEntries(STATUSES);

function loadTracker(id) {
  try {
    const raw = localStorage.getItem(TRACKER_PREFIX + id);
    if (raw === null) return null;
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

function saveTracker(id, data) {
  try {
    if ((data.status === "new" || !data.status) && !data.note) localStorage.removeItem(TRACKER_PREFIX + id);
    else localStorage.setItem(TRACKER_PREFIX + id, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

// Trackers are keyed by the stable lead key (name + ZIP5). Entries saved under
// the old source-dependent id are moved to the key the first time they are read.
function loadLeadTracker(lead) {
  const current = loadTracker(lead.key);
  if (current) return current;
  const legacy = loadTracker(lead.id);
  if (!legacy) return null;
  try {
    localStorage.setItem(TRACKER_PREFIX + lead.key, JSON.stringify(legacy));
    localStorage.removeItem(TRACKER_PREFIX + lead.id);
  } catch {
    // storage unavailable: keep using the legacy entry as read
  }
  return legacy;
}

function allTracked() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key === null || !key.startsWith(TRACKER_PREFIX)) continue;
      const data = loadTracker(key.slice(TRACKER_PREFIX.length));
      if (data) out.push(data);
    }
  } catch {
    // storage unavailable: nothing tracked
  }
  return out.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

// ---- saved searches ---------------------------------------------------------

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
  // A bare YYYY-MM-DD is a calendar date, not UTC midnight: parse it as local.
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

// ---- CSV (same rules as the server's writer) ---------------------------------

function csvCell(value) {
  let text = value === undefined || value === null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function trackedCsv(rows) {
  const header = ["name", "status", "note", "phone", "email", "website", "address", "updated_at"];
  const lines = rows.map(r => [
    r.name, STATUS_LABEL[r.status] || r.status, r.note, r.phone, r.email, r.website, r.address, r.updatedAt,
  ].map(csvCell).join(","));
  return [header.map(csvCell).join(","), ...lines].join("\n") + "\n";
}

// ---- state -----------------------------------------------------------------

const app = {
  status: null,
  running: false,
  lastParams: null,
  direction: "auto",
  map: null,
  origin: undefined,        // undefined until the origin event arrives
  result: null,
  filter: "all",
  items: [],                // { lead, el, group }
  groups: new Map(),
  totals: new Map(),
  moreQueue: [],
  steps: {},
  sourceRows: {},
  contactsEnabled: false,
  startedAt: 0,
  newKeys: new Set(),       // lead keys not seen in the previous run of a saved search
  newSince: null,           // ISO time of that previous run
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

// ---- status & form -----------------------------------------------------------

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

  if (Array.isArray(status.regions) && status.regions.length > 1) {
    const select = $("region");
    for (const code of status.regions) {
      select.append(h("option", { value: code, text: code.replace(/^US-/, "") }));
    }
    select.value = status.defaultRegion;
    $("region-field").hidden = false;
  }
}

function setDirection(value) {
  app.direction = value;
  for (const b of document.querySelectorAll(".dir-button")) {
    b.setAttribute("aria-pressed", b.dataset.direction === value ? "true" : "false");
  }
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
  params.hiddenOnly = $("hidden-only").checked;
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
    savePref("near", params.near || "");
    runSearch(params);
  });

  $("query").addEventListener("input", () => showQueryError(""));

  for (const chip of document.querySelectorAll(".example")) {
    chip.addEventListener("click", () => {
      $("query").value = chip.textContent;
      showQueryError("");
      $("query").focus();
    });
  }

  for (const b of document.querySelectorAll(".dir-button")) {
    b.addEventListener("click", () => setDirection(b.dataset.direction));
  }

  $("retry").addEventListener("click", () => {
    if (app.lastParams && !app.running) runSearch(app.lastParams);
  });

  // Industry code finder
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
      status.textContent = `${codes.length} match${codes.length === 1 ? "" : "es"}. Click one to add it.`;
      for (const entry of codes) {
        list.append(h("li", null, h("button", {
          type: "button",
          onclick: () => addCode(entry.code),
        }, h("span", { class: "code", text: entry.code }), entry.title, h("span", { class: "desc", text: entry.description }))));
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

// ---- progress ----------------------------------------------------------------

const STEP_DEFS = [
  ["map", "Understanding your request"],
  ["industries", "Choosing industries"],
  ["records", "Searching public records"],
  ["confirm", "Confirming with the state registry"],
  ["contacts", "Looking up contacts"],
  ["notes", "Writing call notes"],
];

function buildSteps() {
  const list = $("steps");
  clear(list);
  app.steps = {};
  app.sourceRows = {};
  for (const [id, label] of STEP_DEFS) {
    if (id === "contacts" && !app.contactsEnabled) continue;
    const icon = h("span", { class: "icon", "aria-hidden": "true" });
    const detail = h("div", { class: "detail" });
    const extra = h("ul", { class: "sources" });
    const li = h("li", { class: "step pending" }, icon,
      h("div", null, h("div", { class: "label", text: label }), detail, id === "records" ? extra : null));
    list.append(li);
    app.steps[id] = { li, detail, extra };
  }
}

function setStep(id, state, detail) {
  const step = app.steps[id];
  if (!step) return;
  step.li.className = `step ${state}`;
  if (detail !== undefined) step.detail.textContent = detail;
}

function addWarning(message) {
  $("warnings").append(h("li", { text: message }));
}

function sourceRow(id) {
  if (app.sourceRows[id]) return app.sourceRows[id];
  const count = h("span", { class: "count", text: "searching…" });
  const row = h("li", null, h("span", { text: id }), count);
  app.steps.records.extra.append(row);
  app.sourceRows[id] = { row, count, name: row.firstChild };
  return app.sourceRows[id];
}

const VIA_TEXT = {
  table: "Recognized from common requests",
  llm: "Interpreted with AI",
  override: "Using the industry codes you entered",
  none: "Couldn't match this to an industry yet",
};

function handleEvent(event) {
  switch (event.type) {
    case "map": {
      app.map = event;
      setStep("map", "done", VIA_TEXT[event.via] || "");
      const codes = event.naics.map(n => `${n.code} ${n.title}`.trim());
      setStep("industries", event.naics.length > 0 ? "done" : "error",
        codes.length > 0 ? codes.join(" · ") : "None found. Try different words or add industry codes under More options.");
      setStep("records", "active", "");
      renderInterp();
      // Once per search: bring the reading of the request (and the progress
      // under it) into view so results don't start below the fold.
      scrollTo($("interp"));
      break;
    }
    case "origin":
      app.origin = event.origin;
      renderInterp();
      break;
    case "routed":
      setStep("records", "active", event.sources.length === 0 ? "No public records cover this request in this state." : "");
      for (const s of event.sources) {
        const row = sourceRow(s.id);
        row.name.textContent = s.name;
      }
      break;
    case "fetched": {
      const row = sourceRow(event.sourceId);
      row.count.textContent = `${event.count.toLocaleString()} found`;
      break;
    }
    case "source_error": {
      const row = app.sourceRows[event.sourceId];
      const name = row ? row.name.textContent : event.sourceId;
      if (row) row.count.textContent = "unavailable";
      addWarning(`${name} didn't respond, so its results are missing. ${String(event.message).slice(0, 160)}`);
      break;
    }
    case "backfilled":
      setStep("records", "done");
      setStep("confirm", "active", `${event.count} matched against the state registry`);
      break;
    case "merged":
      setStep("records", "done", `${event.count.toLocaleString()} businesses to rank`);
      setStep("confirm", "done", app.steps.confirm.detail.textContent || "No extra lookups needed");
      break;
    case "probed":
      if (app.contactsEnabled) setStep("contacts", "active", "Searching the web for the top results");
      else setStep("notes", "active", "Preparing a note and opener for each top result");
      break;
    case "contacts":
      setStep("contacts", "done", `${event.found} of ${event.looked} found via ${event.provider}`);
      setStep("notes", "active", "Preparing a note and opener for each top result");
      break;
    default:
      break;
  }
}

function finishSteps() {
  for (const id of Object.keys(app.steps)) {
    const li = app.steps[id].li;
    if (li.classList.contains("pending") || li.classList.contains("active")) setStep(id, "done");
  }
}

function failSteps() {
  for (const id of Object.keys(app.steps)) {
    if (app.steps[id].li.classList.contains("active")) setStep(id, "error");
  }
}

// ---- interpretation bar ----------------------------------------------------------

function renderInterp() {
  const box = $("interp");
  clear(box);
  const map = app.map;
  if (!map) {
    box.hidden = true;
    return;
  }
  box.hidden = false;

  const line = h("div", { class: "interp-line" },
    "Looking for ", h("strong", { text: map.direction === "sell" ? "buyers" : "suppliers" }));
  if (!map.directionFixed) {
    const other = map.direction === "sell" ? "buy" : "sell";
    line.append(h("span", { class: "muted", text: " (guessed)" }));
    line.append(h("button", {
      type: "button",
      class: "link-button",
      onclick: () => {
        setDirection(other);
        if (!app.running && app.lastParams) runSearch({ ...app.lastParams, direction: other });
      },
    }, other === "sell" ? "Find buyers instead" : "Find suppliers instead"));
  }
  if (app.origin !== undefined) {
    line.append(h("span", { class: "sep", "aria-hidden": "true", text: "·" }));
    if (app.origin === null) line.append("anywhere in the state");
    else line.append("near ", h("strong", { text: app.origin.label }));
  }
  if (map.naics.length > 0) {
    line.append(h("button", {
      type: "button",
      class: "link-button",
      onclick: () => {
        $("naics").value = map.naics.map(n => n.code).join(", ");
        $("options").open = true;
        $("naics").focus();
        scrollTo($("naics"));
      },
    }, "Adjust industries"));
  }
  box.append(line);

  if (map.naics.length > 0) {
    box.append(h("div", { class: "interp-chips" },
      map.naics.map(n => h("span", { class: "chip accent num", text: `${n.code} ${n.title}`.trim() }))));
  }
  if (map.caveats.length > 0) {
    box.append(h("ul", { class: "caveats" }, map.caveats.map(c => h("li", { text: c }))));
  }
}

// ---- running a search ---------------------------------------------------------------

function resetForRun(params) {
  app.map = null;
  app.origin = undefined;
  app.result = null;
  app.items = [];
  app.groups = new Map();
  app.totals = new Map();
  app.moreQueue = [];
  app.newKeys = new Set();
  app.newSince = null;
  app.filter = "all";
  app.contactsEnabled = params.findContacts === true;
  app.startedAt = Date.now();

  $("how").hidden = true;
  $("error-box").hidden = true;
  $("empty").hidden = true;
  $("summary").hidden = true;
  $("filters").hidden = true;
  $("distmap").hidden = true;
  clear($("distmap-plot"));
  $("filter-empty").hidden = true;
  $("more-wrap").hidden = true;
  $("recent").hidden = true;
  clear($("recent-rows"));
  clear($("recent-note"));
  clear($("results"));
  clear($("summary"));
  clear($("filters"));
  clear($("warnings"));
  renderInterp();

  const progress = $("progress");
  progress.hidden = false;
  progress.classList.remove("finished");
  $("progress-title").textContent = "Working on it…";
  buildSteps();
  setStep("map", "active", "");
}

function showError(message) {
  failSteps();
  $("error-text").textContent = message;
  $("error-box").hidden = false;
  $("progress-title").textContent = "Search stopped";
  scrollTo($("error-box"));
}

async function runSearch(params) {
  app.running = true;
  app.lastParams = params;
  const go = $("go");
  go.disabled = true;
  go.textContent = "Searching…";
  resetForRun(params);
  scrollTo($("progress"));

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
        finishSteps();
        showResult(event);
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

// ---- results -------------------------------------------------------------------------

function showResult(result) {
  app.result = result;
  const seconds = Math.max(1, Math.round((Date.now() - app.startedAt) / 1000));
  $("progress-title").textContent = `Search complete · ${seconds} s`;
  $("progress").classList.add("finished");
  if ($("warnings").children.length === 0) $("progress").hidden = true;

  if (result.origin !== undefined) app.origin = result.origin;
  renderInterp();

  if (result.leads.length === 0 && result.more.length === 0) {
    renderEmpty();
    renderRecent(result);
    return;
  }

  const keys = [...result.leads, ...result.more].map(l => l.key);
  const saved = findSaved(app.lastParams);
  if (saved) {
    const prior = new Set(Array.isArray(saved.seen) ? saved.seen : []);
    app.newKeys = new Set(keys.filter(k => !prior.has(k)));
    app.newSince = saved.lastRunAt;
    const id = searchId(saved);
    const list = loadSaved().map(e => (searchId(e) === id
      ? { ...e, seen: keys.slice(0, SEEN_MAX), lastRunAt: new Date().toISOString() }
      : e));
    storeSaved(list);
    renderSaved();
  } else {
    app.newKeys = new Set();
    app.newSince = null;
  }

  renderSummary(result);
  renderFilters();
  renderResults(result);
  renderRecent(result);
}

// State-registry entities formed in the last few months whose names match.
// Not part of app.items, so the filters never touch them.
function renderRecent(result) {
  const box = $("recent");
  const rows = $("recent-rows");
  clear(rows);
  const w = result.recentWindow;
  const list = Array.isArray(result.recent) ? result.recent : [];
  if (!w || list.length === 0) {
    box.hidden = true;
    return;
  }
  $("recent-note").textContent = `New filings with the state in the last ${w.days} days, within ${w.radiusMi} miles, whose names match your search. The state registry doesn't record what a business does, so these are name matches — check before you call. Addresses are the registry's filing address.`;
  for (const lead of list) rows.append(compactRow(lead, { registered: true }));
  box.hidden = false;
}

function renderEmpty() {
  const tips = $("empty-tips");
  clear(tips);
  const p = app.lastParams || {};
  if (p.radiusMi) tips.append(h("li", { text: "Remove the distance limit, or choose a larger radius." }));
  if (p.hiddenOnly) tips.append(h("li", { text: "Untick \"Only businesses with no website on record\"." }));
  tips.append(h("li", { text: "Try different words. Describe the kind of business, like \"metal fabrication shop\"." }));
  tips.append(h("li", { text: "Enter industry codes under More options. \"Find codes\" will look them up for you." }));
  if (p.noLlm && app.map && app.map.direction === "sell") {
    tips.prepend(h("li", { text: "Finding buyers needs the AI step (it decides which industries use your product). Turn off \"Skip AI\", or enter industry codes in More options. If you need a supplier instead, choose \"Find suppliers\"." }));
  } else if (p.noLlm) {
    tips.append(h("li", { text: "Selling something? Turn off \"Skip AI\" so we can work out who would buy it." }));
  }
  $("empty").hidden = false;
  scrollTo($("empty"));
}

function renderSummary(result) {
  const box = $("summary");
  clear(box);
  const s = result.summary;
  const stat = (value, name) => h("div", { class: "stat" }, h("span", { class: "value", text: value }), h("span", { class: "name", text: name }));
  const c = result.contactLookups;
  const stats = [
    stat(s.coded.toLocaleString(), "matching businesses"),
    stat(s.nameOnly.toLocaleString(), "name matches only"),
  ];
  // "No website on record" says nothing when it is true of everyone.
  if (c) stats.push(stat(`${c.found}/${c.looked}`, `found online via ${c.provider} (~$${Number(c.costDollars).toFixed(2)})`));
  else {
    if (s.noWebsite < s.total) stats.push(stat(s.noWebsite.toLocaleString(), "no website on record"));
    stats.push(stat("Off", "web contact lookup"));
  }
  box.append(h("div", { class: "stats" }, stats));

  const csv = h("a", { class: "button small primary", href: "/api/csv", download: "leads.csv", text: "Download CSV (all results)" });
  const mine = h("button", { type: "button", class: "button small", text: "Download my list", onclick: downloadMyList });
  const print = h("button", { type: "button", class: "button small", text: "Print call sheet", onclick: () => window.print() });
  const already = findSaved(app.lastParams) !== null;
  const save = h("button", {
    type: "button",
    class: "button small",
    text: already ? "Saved ✓" : "Save this search",
    disabled: already,
  });
  save.addEventListener("click", () => saveCurrentSearch(save, result));
  box.append(h("div", { class: "summary-actions" }, csv, mine, print, save));
  if (Array.isArray(result.recent) && result.recent.length > 0) {
    box.append(h("p", { class: "small" }, h("button", {
      type: "button",
      class: "link-button",
      onclick: () => scrollTo($("recent")),
    }, `${result.recent.length} recently registered nearby`)));
  }
  if (app.newSince !== null) {
    const n = app.newKeys.size;
    const date = fmtDate(app.newSince);
    const tail = "New businesses can only come from live records (state registry, EPA, farm products); the PPP loan data is a fixed 2020–21 snapshot.";
    box.append(h("p", { class: "muted small", text: n > 0 ? `${n} new since ${date}. ${tail}` : `Nothing new since ${date}. ${tail}` }));
  }
  box.hidden = false;
}

function saveCurrentSearch(button, result) {
  const p = app.lastParams || {};
  const now = new Date().toISOString();
  const entry = {
    query: String(p.query || ""),
    near: p.near || "",
    naics: p.naics || "",
    direction: p.direction || "auto",
    savedAt: now,
    lastRunAt: now,
    seen: [...result.leads, ...result.more].map(l => l.key).slice(0, SEEN_MAX),
  };
  const id = searchId(entry);
  const list = loadSaved().filter(e => searchId(e) !== id);
  list.push(entry);
  if (!storeSaved(list.slice(-SAVED_MAX))) {
    toast("Couldn't save. Browser storage is blocked.");
    return;
  }
  button.textContent = "Saved ✓";
  button.disabled = true;
  renderSaved();
  toast("Saved. Run it again later to see what's new.");
}

function renderSaved() {
  const list = loadSaved();
  const box = $("saved");
  const ul = $("saved-list");
  clear(ul);
  box.hidden = list.length === 0;
  for (const entry of list) {
    const info = [
      entry.near ? `near ${entry.near}` : "",
      entry.naics ? `codes ${entry.naics}` : "",
      entry.direction === "buy" ? "suppliers" : entry.direction === "sell" ? "buyers" : "",
      fmtDate(entry.lastRunAt) ? `last run ${fmtDate(entry.lastRunAt)}` : "",
    ].filter(Boolean);
    const run = h("button", {
      type: "button",
      class: "button small",
      text: "Run",
      "aria-label": `Run saved search: ${entry.query}`,
      onclick: () => {
        $("query").value = entry.query;
        $("near").value = entry.near || "";
        $("naics").value = entry.naics || "";
        setDirection(entry.direction || "auto");
        showQueryError("");
        if (!app.running) runSearch(readParams());
      },
    });
    const remove = h("button", {
      type: "button",
      class: "button small secondary",
      text: "Remove",
      "aria-label": `Remove saved search: ${entry.query}`,
      onclick: () => {
        const id = searchId(entry);
        storeSaved(loadSaved().filter(e => searchId(e) !== id));
        renderSaved();
      },
    });
    ul.append(h("li", { class: "saved-item" },
      h("div", { class: "saved-info" },
        h("strong", { text: entry.query }),
        info.map(t => h("span", { class: "muted small", text: t }))),
      h("div", { class: "saved-buttons" }, run, remove)));
  }
}

function downloadMyList() {
  const rows = allTracked().filter(r => (r.status && r.status !== "new") || r.note);
  if (rows.length === 0) {
    toast("Nothing tracked yet. Mark a business as Called or Interested, or add a note, and it will appear here.");
    return;
  }
  const blob = new Blob([trackedCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: "my-leads.csv" });
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(`Saved ${rows.length} tracked business${rows.length === 1 ? "" : "es"}.`);
}

// ---- filters -----------------------------------------------------------------------------

function hasSite(lead) {
  return lead.web === "verified" || Boolean(lead.found && lead.found.website);
}

function trackerStatus(lead) {
  const t = loadLeadTracker(lead);
  return t && t.status ? t.status : "new";
}

const FILTERS = [
  ["all", "All", () => true],
  ["nosite", "No website", lead => !hasSite(lead)],
  ["interested", "Interested", lead => trackerStatus(lead) === "interested"],
  ["called", "Called", lead => trackerStatus(lead) === "called"],
  ["new", "Not contacted", lead => trackerStatus(lead) === "new"],
];

function renderFilters() {
  const nav = $("filters");
  clear(nav);
  for (const [id, label] of FILTERS) {
    const count = h("span", { class: "count", text: "0" });
    const button = h("button", {
      type: "button",
      class: "chip-button",
      "data-filter": id,
      "aria-pressed": id === app.filter ? "true" : "false",
      onclick: () => {
        app.filter = id;
        applyFilter();
      },
    }, label, count);
    nav.append(button);
  }
  nav.hidden = false;
}

function applyFilter() {
  const fn = FILTERS.find(f => f[0] === app.filter)[2];
  const visible = new Map();
  for (const item of app.items) {
    const show = fn(item.lead);
    item.el.hidden = !show;
    if (item.dot) item.dot.classList.toggle("is-hidden", !show);
    if (show) visible.set(item.group, (visible.get(item.group) || 0) + 1);
  }
  let any = false;
  for (const group of app.groups.values()) {
    const shown = visible.get(group) || 0;
    group.section.hidden = shown === 0;
    group.countEl.textContent = app.filter === "all" ? ` · ${group.total}` : ` · ${shown}`;
    if (shown > 0) any = true;
  }
  $("filter-empty").hidden = any;
  updateFilterCounts();
}

// Counts follow tracker changes at once; visibility waits for the next
// filter click so a card doesn't vanish while you are working on it.
function updateFilterCounts() {
  for (const button of $("filters").children) {
    const id = button.getAttribute("data-filter");
    const f = FILTERS.find(x => x[0] === id);
    button.setAttribute("aria-pressed", id === app.filter ? "true" : "false");
    button.lastChild.textContent = String(app.items.filter(item => f[2](item.lead)).length);
  }
}

// ---- grouped results ------------------------------------------------------------------------

function bandTitle(band) {
  if (!band) return "All results";
  return band.charAt(0).toUpperCase() + band.slice(1);
}

function groupFor(band) {
  const key = band || "";
  let group = app.groups.get(key);
  if (!group) {
    const countEl = h("span", { class: "count" });
    const cards = h("div", { class: "band-cards" });
    const rows = h("div", { class: "band-rows" });
    const section = h("section", { class: "band-group" },
      h("h2", { class: "band-heading" }, bandTitle(key), countEl), cards, rows);
    $("results").append(section);
    group = { key, section, countEl, cards, rows, total: app.totals.get(key) || 0 };
    app.groups.set(key, group);
  }
  return group;
}

function renderResults(result) {
  const all = [...result.leads, ...result.more];
  app.totals = new Map();
  for (const lead of all) app.totals.set(lead.band || "", (app.totals.get(lead.band || "") || 0) + 1);

  for (const lead of result.leads) {
    const group = groupFor(lead.band);
    const el = leadCard(lead);
    group.cards.append(el);
    app.items.push({ lead, el, group });
  }

  app.moreQueue = [...result.more];
  renderMoreControls();
  applyFilter();
  renderDistMap();
}

// ---- distance map ----------------------------------------------------------------------------------

const MAP_R = 100;
const MAP_RINGS = [10, 25, 50, 100];

function mapRadius(miles) {
  return MAP_R * Math.sqrt(Math.min(miles, 100) / 100);
}

function renderDistMap() {
  const box = $("distmap");
  const plot = $("distmap-plot");
  clear(plot);
  const o = app.origin;
  const placed = o ? app.items.filter(item => item.lead.point) : [];
  if (!o || placed.length === 0) {
    box.hidden = true;
    return;
  }

  const svg = svgEl("svg", { viewBox: "-110 -110 220 220", width: "100%", role: "img" });
  for (const miles of MAP_RINGS) {
    const r = mapRadius(miles);
    svg.append(svgEl("circle", { class: "ring", cx: 0, cy: 0, r }));
    svg.append(svgEl("text", { class: "ring-label", x: 0, y: -r - 1.5, text: `${miles} mi` }));
  }
  svg.append(svgEl("circle", { class: "origin-dot", cx: 0, cy: 0, r: 3.5 }));
  svg.append(svgEl("text", { class: "ring-label", x: 0, y: 10, text: "You" }));

  let shown = 0;
  let far = 0;
  for (const item of app.items) {
    const lead = item.lead;
    if (!lead.point) continue;
    const dx = (lead.point.lon - o.lon) * Math.cos(o.lat * Math.PI / 180);
    const dy = lead.point.lat - o.lat;
    const miles = typeof lead.distanceMi === "number" ? lead.distanceMi : Math.hypot(dx, dy) * 69;
    if (miles > 100) {
      far += 1;
      continue;
    }
    const angle = Math.atan2(dy, dx);
    const r = mapRadius(miles);
    const dot = svgEl("circle", {
      class: `lead-dot ${lead.naics.length > 0 ? "coded" : "name-only"}`,
      cx: (r * Math.cos(angle)).toFixed(2),
      cy: (-r * Math.sin(angle)).toFixed(2),
      r: 3,
      onclick: () => {
        scrollTo(item.el);
        item.el.classList.add("flash");
        window.setTimeout(() => item.el.classList.remove("flash"), 1500);
      },
    }, svgEl("title", { text: `${lead.name} · ${lead.distanceMi} mi` }));
    item.dot = dot;
    svg.append(dot);
    shown += 1;
  }
  svg.setAttribute("aria-label", `Map of ${shown} businesses around ${o.label}. The list below has the same results.`);
  plot.append(svg);

  const unknown = app.items.filter(item => !item.lead.point).length;
  const parts = [];
  if (far > 0) parts.push(`${far} farther than 100 mi`);
  if (unknown > 0) parts.push(`${unknown} without a location`);
  let note = "Dots sit at ZIP or town centers, so positions are approximate. Rings are spaced for readability, not to scale.";
  if (parts.length > 0) note += ` ${parts.join(" and ")} aren't shown.`;
  $("distmap-note").textContent = note;
  box.hidden = false;
  applyDotFilter();
}

function applyDotFilter() {
  for (const item of app.items) {
    if (item.dot) item.dot.classList.toggle("is-hidden", item.el.hidden);
  }
}

function renderMoreControls() {
  const wrap = $("more-wrap");
  clear(wrap);
  const total = app.result.summary.total;
  const known = app.result.leads.length + app.result.more.length;
  if (app.moreQueue.length > 0) {
    wrap.append(h("button", {
      type: "button",
      class: "button",
      text: `Show more results (${app.moreQueue.length})`,
      onclick: showMore,
    }));
  }
  if (total > known) {
    wrap.append(h("p", { class: "muted small center", text: `Showing the strongest ${known.toLocaleString()} of ${total.toLocaleString()}. The CSV download has all of them.` }));
  }
  wrap.hidden = wrap.children.length === 0;
}

function showMore() {
  const batch = app.moreQueue.splice(0, 50);
  for (const lead of batch) {
    const group = groupFor(lead.band);
    const el = compactRow(lead);
    group.rows.append(el);
    app.items.push({ lead, el, group });
  }
  renderMoreControls();
  applyFilter();
  renderDistMap();
}

// ---- lead presentation ---------------------------------------------------------------------------

function sizeText(lead) {
  if (typeof lead.employees !== "number") return "";
  return `${lead.employees.toLocaleString()} ${lead.employees === 1 ? "job" : "jobs"}`;
}

function webChip(lead) {
  const f = lead.found;
  if (lead.web === "verified") return { text: "Website ✓", tone: "ok" };
  if (f) {
    if (f.status === "found") return { text: "Found online — verify", tone: "accent" };
    if (f.status === "directory") {
      const names = f.listings.map(prettyHost);
      return { text: names.length > 0 ? `Listed on ${names.join(", ")}` : "Listed in directories", tone: "" };
    }
    if (f.status === "not-found") return { text: "No web presence found", tone: "accent" };
    return { text: "Not searched", tone: "" };
  }
  if (lead.web === "unresolved") return { text: "Listed website didn't respond", tone: "warn" };
  return { text: "No website on record", tone: "" };
}

function addressText(lead) {
  const a = lead.address;
  const cityLine = [a.city, [a.state, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [a.street, cityLine].filter(Boolean).join(", ");
}

// No search link and no verified website means the record is an individual's.
function noSearchNote(lead) {
  return lead.web !== "verified" ? h("span", { text: "Individual's record — no web search offered" }) : null;
}

function industryText(lead, max) {
  const titles = [...new Set(lead.naics.map(n => n.title || n.code))].slice(0, max);
  return titles.join(", ");
}

function compactRow(lead, opts = {}) {
  const chip = webChip(lead);
  const meta = h("div", { class: "row-meta" },
    opts.registered && fmtDate(lead.formedDate) ? h("span", { text: `Registered ${fmtDate(lead.formedDate)}` }) : null,
    app.newKeys.has(lead.key) ? h("span", { class: "chip new", text: `New since ${fmtDate(app.newSince)}` }) : null,
    lead.distanceMi !== null ? h("span", { text: `${lead.distanceMi} mi` }) : null,
    h("span", { text: industryText(lead, 1) || "Name match only" }),
    lead.address.city ? h("span", { text: lead.address.city }) : null,
    sizeText(lead) ? h("span", { text: sizeText(lead) }) : null,
    h("span", { text: chip.text }),
    lead.searchUrl ? extLink("Search the web", lead.searchUrl) : noSearchNote(lead));
  return h("div", { class: "row" }, h("div", { class: "row-name", text: lead.name }), meta);
}

// Phones, emails and websites for the Reach block, registry values first.
function collectReach(lead) {
  const items = [];
  const seen = new Set();
  const push = (kind, value, extra) => {
    const key = `${kind}:${String(extra && extra.digits ? extra.digits : value).toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ kind, value, ...extra });
  };
  const text = [];
  for (const raw of lead.contacts) {
    const c = classifyContact(raw);
    if (c.kind === "text") text.push(c.value);
    else push(c.kind, c.value, { digits: c.digits, found: false });
  }
  const f = lead.found;
  if (f && f.status !== "skipped") {
    if (f.phone) { const c = classifyContact(f.phone); push(c.kind === "phone" ? "phone" : "text", f.phone, { digits: c.digits, found: true }); }
    if (f.email && EMAIL_RE.test(f.email)) push("email", f.email, { found: true });
    if (f.website && safeHttpUrl(f.website)) push("web", f.website, { found: true });
  }
  return { items, text };
}

function reachItem(item, provider) {
  let link = null;
  const label = { phone: "Phone", email: "Email", web: "Website", text: "Contact" }[item.kind];
  if (item.kind === "phone" && item.digits) {
    link = h("a", { class: "strong", href: `tel:${item.digits}`, text: item.value });
  } else if (item.kind === "email") {
    link = h("a", { class: "strong", href: `mailto:${item.value}`, text: item.value });
  } else if (item.kind === "web") {
    link = extLink(item.value.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, ""), item.value, "strong");
  }
  return h("li", null,
    h("span", { class: "kind", text: label }),
    link || h("span", { text: item.value }),
    item.found ? h("span", { class: "tag verify", text: `found via ${provider || "web search"} — verify` }) : null);
}

function reachSection(lead) {
  const { items, text } = collectReach(lead);
  const provider = lead.found ? lead.found.provider : "";
  const sec = h("section", { class: "sec-reach" }, h("h4", { class: "sec-title", text: "Reach" }));

  if (items.length > 0 || text.length > 0) {
    sec.append(h("ul", { class: "reach-list" },
      items.map(i => reachItem(i, provider)),
      text.map(t => h("li", null, h("span", { class: "kind", text: "Contact" }), h("span", { text: t })))));
  } else {
    sec.append(h("p", { class: "muted small", text: "No phone or email on public record." }));
  }

  const f = lead.found;
  if (f) {
    if (f.status === "skipped") {
      sec.append(h("p", { class: "muted small", text: "Web lookup skipped. This looks like an individual's record." }));
    } else if (f.status === "directory" && f.listings.length > 0) {
      sec.append(h("p", { class: "muted small", text: `Listed on ${f.listings.join(", ")}.` }));
    } else if (f.status === "not-found") {
      sec.append(h("p", { class: "muted small", text: "A web search found nothing, so this business likely has no web presence." }));
    }
    const sources = (f.sourceUrls || []).map(u => ({ host: hostOf(u), url: u })).filter(s => s.host && safeHttpUrl(s.url));
    if (sources.length > 0) {
      const links = [];
      sources.slice(0, 4).forEach((s, i) => {
        if (i > 0) links.push(", ");
        links.push(extLink(s.host, s.url));
      });
      sec.append(h("p", { class: "tag" }, "Sources: ", links));
    }
  }

  const address = addressText(lead);
  if (address) {
    sec.append(h("p", { class: "address-line small" }, h("span", { text: address }), mapsLink(lead.mapsUrl)));
  }
  if (lead.officers.length > 0) {
    sec.append(h("p", { class: "officers", text: `Agent/principals: ${lead.officers.join("; ")}` }));
  }
  if (lead.searchUrl) {
    sec.append(h("p", { class: "small" }, extLink("Search the web", lead.searchUrl)));
  } else if (lead.web !== "verified") {
    sec.append(h("p", { class: "muted small", text: "Individual's record — no web search offered" }));
  }
  return sec;
}

function bestContacts(lead) {
  const { items } = collectReach(lead);
  const pick = kind => items.find(i => i.kind === kind);
  const phone = pick("phone");
  const email = pick("email");
  const web = pick("web");
  return { phone: phone ? phone.value : "", email: email ? email.value : "", website: web ? web.value : "" };
}

function notesSection(lead) {
  const sec = h("section", { class: "sec-notes" }, h("h4", { class: "sec-title", text: "Call notes" }));
  if (lead.brief) sec.append(h("p", { text: lead.brief }));
  if (lead.opener) {
    const quote = h("blockquote", { class: "opener" }, h("p", { text: lead.opener }));
    const copy = h("button", { type: "button", class: "button small copy-button", text: "Copy opener" });
    copy.addEventListener("click", () => copyText(lead.opener, quote, copy));
    sec.append(h("div", { class: "opener-row" }, quote, copy));
  }
  return sec;
}

async function copyText(text, quoteEl, button) {
  const done = () => {
    button.textContent = "Copied ✓";
    window.setTimeout(() => { button.textContent = "Copy opener"; }, 2000);
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

function trackerSection(lead) {
  const sec = h("section", { class: "sec-tracker" }, h("h4", { class: "sec-title", text: "Your outreach" }));
  const saved = loadLeadTracker(lead);
  let status = saved && STATUS_LABEL[saved.status] ? saved.status : "new";
  const note = h("textarea", {
    class: "tracker-note",
    rows: "3",
    maxlength: "1000",
    placeholder: "Notes: who you spoke to, what they said, when to follow up",
    "aria-label": `Notes about ${lead.name}`,
  });
  note.value = saved && typeof saved.note === "string" ? saved.note : "";
  const savedAt = h("p", { class: "saved-at", "aria-live": "polite" });
  const printLine = h("p", { class: "print-only" });

  const buttons = STATUSES.map(([id, label]) => h("button", {
    type: "button",
    "aria-pressed": id === status ? "true" : "false",
    text: label,
    onclick: () => {
      status = id;
      refresh();
      persist();
    },
  }));

  const refresh = () => {
    buttons.forEach((b, i) => b.setAttribute("aria-pressed", STATUSES[i][0] === status ? "true" : "false"));
    const parts = [];
    if (status !== "new") parts.push(`Status: ${STATUS_LABEL[status]}`);
    if (note.value.trim()) parts.push(`Notes: ${note.value.trim()}`);
    printLine.textContent = parts.join(" · ");
    sec.classList.toggle("untracked", parts.length === 0);
  };

  const persist = () => {
    const contacts = bestContacts(lead);
    const ok = saveTracker(lead.key, {
      status,
      note: note.value.trim(),
      name: lead.name,
      phone: contacts.phone,
      email: contacts.email,
      website: contacts.website,
      address: addressText(lead),
      updatedAt: new Date().toISOString(),
    });
    savedAt.textContent = ok ? "Saved on this computer" : "Couldn't save. Browser storage is blocked.";
    dirty = false;
    if (app.result) updateFilterCounts();
  };

  let timer = 0;
  let dirty = false;
  note.addEventListener("input", () => {
    dirty = true;
    refresh();
    window.clearTimeout(timer);
    timer = window.setTimeout(persist, 500);
  });
  note.addEventListener("blur", () => {
    window.clearTimeout(timer);
    if (dirty) persist();
  });

  refresh();
  sec.append(h("div", { class: "segmented", role: "group", "aria-label": `Outreach status for ${lead.name}` }, buttons), note, savedAt, printLine);
  return sec;
}

function leadCard(lead) {
  const chip = webChip(lead);
  const chips = h("div", { class: "chip-row" },
    app.newKeys.has(lead.key) ? h("span", { class: "chip new", text: `New since ${fmtDate(app.newSince)}` }) : null,
    lead.distanceMi !== null ? h("span", { class: "chip", text: `${lead.distanceMi} mi` }) : null,
    sizeText(lead) ? h("span", { class: "chip", text: sizeText(lead) }) : null,
    lead.onStateRegistry
      ? h("span", { class: "chip ok", text: "On state registry", title: lead.lastSeen ? `Last record ${lead.lastSeen}` : "" })
      : h("span", { class: "chip warn", text: "Confirm it's still operating", title: lead.lastSeen ? `Last record ${lead.lastSeen}` : "No state registry match" }),
    h("span", { class: `chip ${chip.tone}`.trim(), text: chip.text }));

  const head = h("div", { class: "lead-head" },
    h("div", { class: "lead-title" }, h("span", { class: "rank", text: `#${lead.rank}` }), h("h3", { text: lead.name })),
    lead.aka.length > 0 ? h("p", { class: "aka", text: `Also known as ${lead.aka.slice(0, 3).join("; ")}` }) : null,
    chips);

  const what = h("section", { class: "sec-what" }, h("h4", { class: "sec-title", text: "What they do" }));
  if (lead.naics.length > 0) {
    const sources = (lead.codeSources || []).map(s => s.name).join(", ");
    what.append(h("p", { text: industryText(lead, 3) }), h("p", { class: "muted small", text: sources ? `per ${sources}` : "" }));
  } else {
    what.append(h("p", { text: "Name match only." }), h("p", { class: "muted small", text: "No industry code on record, so this is lower confidence." }));
  }
  const upkeep = [lead.status ? `Registry status: ${lead.status}` : "", lead.lastSeen ? `Last record ${lead.lastSeen}` : ""].filter(Boolean).join(" · ");
  if (upkeep) what.append(h("p", { class: "muted small", text: upkeep }));

  const body = h("div", { class: "lead-body" }, what, reachSection(lead), notesSection(lead), trackerSection(lead));

  if (lead.evidence && lead.evidence.length > 0) {
    body.append(h("section", { class: "sec-details" },
      h("details", { class: "evidence" },
        h("summary", { text: `Evidence (${lead.evidence.length})` }),
        h("ul", { class: "evidence-list" }, lead.evidence.map(ev =>
          h("li", { text: `[${ev.source}] ${ev.field}=${ev.value}${ev.note ? ` (${ev.note})` : ""}` }))))));
  }

  return h("article", { class: "card lead", "data-id": lead.id }, head, body);
}

// ---- boot --------------------------------------------------------------------------------------------

setupForm();
renderSaved();
$("near").value = loadPref("near");
loadStatus();

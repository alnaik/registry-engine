import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { leadsToCsv, summaryCounts, sheetCounts, partitionLeads, codeSourceIds, naicsFieldMap, isLikelyIndividual } from "@registry-engine/qualify";
import type { search, EngineEvent, Lead, SearchOutcome, RegistryCheck, RawLlm, LlmBilling } from "@registry-engine/qualify";
import { SOURCES, knownRegions, defaultRegion, lookupCodes, naicsLabel, naicsPhrase, naicsRelated, normalizeName } from "@registry-engine/registry-core";

// The local web app's HTTP surface: static files, a status probe, a NAICS
// lookup, and one streaming search endpoint. Everything is loopback-only
// (main.ts binds 127.0.0.1; the Host check below stops DNS rebinding), and
// one search runs at a time because each can spend LLM and contact-API credits.

export interface AppDeps {
  search: typeof search;
  // The LLM backend picked from the environment, or null when there is none.
  llm: () => Promise<{ backend: RawLlm; billing: LlmBilling } | null>;
  contactsProvider: () => string | null;
  port: number;
  publicDir: string;
  historyDir?: string | undefined;   // finished searches kept on disk; undefined = no history
}

const MAX_BODY_BYTES = 10 * 1024;
const MORE_LEADS = 300;
const GROUP_LEADS = 100;      // individuals' records and name-only matches sent per search
const DEFAULT_LEADS = 12;
const DEFAULT_RADIUS_MI = 25; // the summary's "within N miles" when no radius is set
const HISTORY_MAX = 20;
const HISTORY_ID_RE = /^[a-f0-9]{40}$/;
const HISTORY_FILE_RE = /^[a-f0-9]{40}\.json$/;

const REGION_NAMES: Record<string, string> = { "US-CO": "Colorado", "US-CT": "Connecticut", "US-NY": "New York" };

const HTML_CSP = "default-src 'self'; img-src 'self' data:; connect-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

// Exact whitelist: the URL never takes part in building a file path.
const STATIC_FILES: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/app.css": { file: "app.css", type: "text/css; charset=utf-8" },
  "/labels.js": { file: "labels.js", type: "text/javascript; charset=utf-8" },
  // Component sheet: every UI component with fictional data, light and dark.
  "/design": { file: "design.html", type: "text/html; charset=utf-8" },
  "/design.js": { file: "design.js", type: "text/javascript; charset=utf-8" },
};

interface SearchParams {
  query: string;
  near: string | undefined;
  radiusMi: number | undefined;
  naics: string[] | undefined;
  checkAll: boolean;   // check every coded lead's name against the registry (the "Check all" button)
  findContacts: boolean;
  noLlm: boolean;
  leads: number;
  region: string | undefined;
  direction: "buy" | "sell" | undefined;
}

class BadRequest extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export interface LeadView {
  id: string;
  key: string;   // stable across sources: normalized name + ZIP5
  rank: number;
  score: number;
  name: string;
  aka: string[];
  address: { street: string; city: string; state: string; zip: string };
  distanceMi: number | null;
  band: string;
  naics: { code: string; title: string }[];
  what: string;          // the best-fitting code's title as a plain phrase ("Makes textile bag and canvas products"); "" = no code
  coded: boolean;        // carries an industry code related to the request (false = name match only)
  individual: boolean;   // an individual's record: shown as filed, no map link, no web search
  employees: number | null;
  lastSeen: string | null;
  formedDate: string | null;
  sources: { id: string; name: string }[];
  codeSources: { id: string; name: string }[];   // the sources that carry the industry code
  registryCheck: RegistryCheck;
  registeredElsewhere: boolean;   // checked_not_found, but a same-named registration is at another locality
  registryStanding: { status: string; since: string | null } | null;   // inactive: the registry's status and date
  status: string;
  contacts: string[];
  web: Lead["web"];
  found: Lead["found"] | null;
  officers: string[];
  searchUrl: string | null;
  mapsUrl: string | null;   // null for individuals' records
  brief: string;
  opener: string;
  evidence?: { source: string; field: string; value: string; note: string }[];
}

export function createApp(deps: AppDeps): (req: IncomingMessage, res: ServerResponse) => void {
  let busy = false;
  let last: { ranked: Lead[]; existenceIds: string[] } | null = null;
  const allowedHosts = new Set([`localhost:${deps.port}`, `127.0.0.1:${deps.port}`]);

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");

    if (!allowedHosts.has(req.headers.host ?? "")) {
      sendJson(res, 403, { error: "forbidden host" });
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const method = req.method ?? "GET";

    // HEAD gets the headers of the GET response, no body.
    const head = method === "HEAD";
    if ((method === "GET" || head) && Object.hasOwn(STATIC_FILES, path)) {
      const entry = STATIC_FILES[path]!;
      let body: Buffer;
      try {
        body = await readFile(join(deps.publicDir, entry.file));
      } catch {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      res.writeHead(200, {
        "Content-Type": entry.type,
        "Cache-Control": "no-store",
        ...(entry.type.startsWith("text/html") ? { "Content-Security-Policy": HTML_CSP } : {}),
      });
      res.end(head ? undefined : body);
      return;
    }

    if ((method === "GET" || head) && path === "/api/status") {
      // Only which billing path is active; nothing about the key itself.
      const picked = await deps.llm();
      sendJson(res, 200, {
        llm: picked !== null,
        llmBilling: picked?.billing ?? null,
        contactsProvider: deps.contactsProvider(),
        regions: knownRegions(SOURCES),
        defaultRegion: defaultRegion(SOURCES),
      }, head);
      return;
    }

    if (method === "GET" && path === "/api/codes") {
      const q = (url.searchParams.get("q") ?? "").slice(0, 100);
      sendJson(res, 200, lookupCodes(q.split(/\s+/).filter(Boolean)));
      return;
    }

    if (method === "GET" && path === "/api/history") {
      sendJson(res, 200, await listHistory(deps.historyDir));
      return;
    }

    if (method === "GET" && path.startsWith("/api/history/")) {
      const id = path.slice("/api/history/".length);
      if (!HISTORY_ID_RE.test(id)) {
        sendJson(res, 400, { error: "bad id" });
        return;
      }
      const stored = await readHistoryFile(deps.historyDir, `${id}.json`);
      if (stored === null) {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      let entry: { params?: unknown; ranAt?: unknown; map?: unknown; result?: unknown };
      try {
        entry = JSON.parse(stored) as typeof entry;
      } catch {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      sendJson(res, 200, { params: entry.params, ranAt: entry.ranAt, map: entry.map ?? null, result: entry.result });
      return;
    }

    if (method === "GET" && path === "/api/csv" && url.searchParams.has("id")) {
      const id = url.searchParams.get("id") ?? "";
      if (!HISTORY_ID_RE.test(id)) {
        sendJson(res, 400, { error: "bad id" });
        return;
      }
      const csv = await readHistoryFile(deps.historyDir, `${id}.csv`);
      if (csv === null) {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="leads.csv"',
        "Cache-Control": "no-store",
      });
      res.end(csv);
      return;
    }

    if (method === "GET" && path === "/api/csv") {
      if (last === null) {
        sendJson(res, 404, { error: "no search yet" });
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="leads.csv"',
        "Cache-Control": "no-store",
      });
      res.end(leadsToCsv(last.ranked, last.existenceIds));
      return;
    }

    if (method === "POST" && path === "/api/search") {
      await handleSearch(req, res);
      return;
    }

    sendJson(res, 404, { error: "not found" });
  }

  async function handleSearch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!/^application\/json\s*(;|$)/i.test(req.headers["content-type"] ?? "")) {
      sendJson(res, 415, { error: "Content-Type must be application/json" });
      return;
    }
    let params: SearchParams;
    try {
      params = parseSearchParams(await readJson(req));
    } catch (err) {
      if (err instanceof BadRequest) {
        sendJson(res, err.status, { error: err.message });
        return;
      }
      throw err;
    }

    // Claim the slot synchronously after validation: no await in between.
    if (busy) {
      sendJson(res, 429, { error: "a search is already running" });
      return;
    }
    busy = true;

    res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" });
    const write = (obj: unknown): void => {
      if (res.writableEnded || res.destroyed) return;
      res.write(`${JSON.stringify(obj)}\n`);
    };

    try {
      const sourceNames = new Map(SOURCES.map(s => [s.id, s.name]));
      // Per-source counts for "About this search", gathered from the stream.
      const fetchedBy = new Map<string, { count: number; capped: boolean; error: boolean }>();
      // The map event's line is kept with the stored result: the reading line
      // and the "Before you call" caveats live there.
      let mapLine: Record<string, unknown> | null = null;
      const picked = params.noLlm ? null : await deps.llm();
      const outcome = await deps.search(params.query, {
        llm: picked === null ? undefined : { backend: picked.backend },
        near: params.near,
        radiusMi: params.radiusMi,
        naics: params.naics,
        backfillAll: params.checkAll,
        maxLeads: params.leads,
        region: params.region,
        direction: params.direction,
        contacts: params.findContacts ? undefined : null,
        onEvent: event => {
          if (event.type === "fetched") fetchedBy.set(event.sourceId, { count: event.count, capped: event.capped, error: false });
          if (event.type === "source_error" && !fetchedBy.has(event.sourceId)) fetchedBy.set(event.sourceId, { count: 0, capped: false, error: true });
          const line = translateEvent(event);
          if (event.type === "map") mapLine = line;
          if (line !== null) write(line);
        },
      });

      // The rejected map answer goes to the server's stderr for diagnosis,
      // never into the result line or the page.
      if (outcome.mapRawAnswer !== null) {
        console.error(`[map] the AI answer couldn't be used. Raw answer (untrusted):\n${outcome.mapRawAnswer}\n[map] end of raw answer`);
      }
      const existenceIds = outcome.routed.filter(s => s.plane === "existence").map(s => s.id);
      last = { ranked: outcome.ranked, existenceIds };
      const result = buildResult(outcome, existenceIds, params, sourceNames, fetchedBy, picked?.billing ?? null);
      if (deps.historyDir !== undefined) {
        await saveHistory(deps.historyDir, params, mapLine, result, leadsToCsv(outcome.ranked, existenceIds));
      }
      write(result);
    } catch (err) {
      write({ type: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      busy = false;
      if (!res.writableEnded) res.end();
    }
  }

  return (req, res) => {
    handle(req, res).catch(err => {
      console.error(err);
      if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
      else if (!res.writableEnded) res.end();
    });
  };
}

// ---- search history: <id>.json + <id>.csv per search, newest 20 kept ----------------

// Server-only key: the same request (region, words, place, codes, direction)
// overwrites its earlier run. checkAll is left out on purpose: the fuller
// "check all" run overwrites the stored copy of the same search.
export function historyId(params: Pick<SearchParams, "region" | "query" | "near" | "naics" | "direction">): string {
  const key = JSON.stringify([
    params.region ?? "",
    params.query.trim().toLowerCase(),
    (params.near ?? "").trim().toLowerCase(),
    [...(params.naics ?? [])].sort().join(","),
    params.direction ?? "auto",
  ]);
  return createHash("sha1").update(key).digest("hex");
}

async function writeAtomic(dir: string, name: string, body: string): Promise<void> {
  const tmp = join(dir, `${name}.tmp-${process.pid}-${Date.now()}`);
  await writeFile(tmp, body);
  await rename(tmp, join(dir, name));
}

// A write failure is logged and never fails the search.
async function saveHistory(dir: string, params: SearchParams, map: Record<string, unknown> | null, result: Record<string, unknown>, csv: string): Promise<void> {
  try {
    const id = historyId(params);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const entry = { id, ranAt: new Date().toISOString(), params, map, result };
    await writeAtomic(dir, `${id}.json`, JSON.stringify(entry));
    await writeAtomic(dir, `${id}.csv`, csv);
    const files = await historyFiles(dir);
    for (const f of files.slice(HISTORY_MAX)) {
      const stale = f.name.slice(0, -".json".length);
      await unlink(join(dir, `${stale}.json`)).catch(() => {});
      await unlink(join(dir, `${stale}.csv`)).catch(() => {});
    }
  } catch (err) {
    console.error(`[history] couldn't save this search: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// History .json files, newest first by mtime. Only names matching the id pattern.
async function historyFiles(dir: string): Promise<{ name: string; mtimeMs: number }[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: { name: string; mtimeMs: number }[] = [];
  for (const name of names) {
    if (!HISTORY_FILE_RE.test(name)) continue;
    try {
      out.push({ name, mtimeMs: (await stat(join(dir, name))).mtimeMs });
    } catch {
      // removed between readdir and stat
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

// `name` is built only from a validated id.
async function readHistoryFile(dir: string | undefined, name: string): Promise<string | null> {
  if (dir === undefined) return null;
  try {
    return await readFile(join(dir, name), "utf8");
  } catch {
    return null;
  }
}

async function listHistory(dir: string | undefined): Promise<Record<string, unknown>[]> {
  if (dir === undefined) return [];
  const out: Record<string, unknown>[] = [];
  for (const f of await historyFiles(dir)) {
    const text = await readHistoryFile(dir, f.name);
    if (text === null) continue;
    try {
      const entry = JSON.parse(text) as { id: string; ranAt: string; params: Partial<SearchParams>; result: { sheet?: { businesses?: number } } };
      const p = entry.params;
      out.push({
        id: entry.id, query: p.query, near: p.near, naics: p.naics, direction: p.direction, region: p.region,
        ranAt: entry.ranAt, businesses: entry.result.sheet?.businesses,
      });
    } catch {
      // a file that fails to parse is skipped
    }
  }
  return out;
}

function sendJson(res: ServerResponse, status: number, body: unknown, headOnly = false): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(headOnly ? undefined : JSON.stringify(body));
}

// Reads at most MAX_BODY_BYTES; a larger body is discarded and rejected.
function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    let size = 0;
    let tooLarge = Number.isFinite(declared) && declared > MAX_BODY_BYTES;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) tooLarge = true;
      if (!tooLarge) chunks.push(chunk);
    });
    req.on("error", reject);
    req.on("end", () => {
      if (tooLarge) {
        reject(new BadRequest("request body too large", 413));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new BadRequest("body must be valid JSON"));
      }
    });
  });
}

function parseSearchParams(body: unknown): SearchParams {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new BadRequest("body must be a JSON object");
  const b = body as Record<string, unknown>;

  const query = typeof b["query"] === "string" ? b["query"].trim() : "";
  if (query.length < 3 || query.length > 300) throw new BadRequest("query must be 3 to 300 characters");

  let near: string | undefined;
  if (b["near"] !== undefined && b["near"] !== null) {
    if (typeof b["near"] !== "string" || b["near"].length > 60) throw new BadRequest("near must be a string of at most 60 characters");
    near = b["near"].trim() === "" ? undefined : b["near"].trim();
  }

  let radiusMi: number | undefined;
  if (b["radiusMi"] !== undefined && b["radiusMi"] !== null) {
    const r = b["radiusMi"];
    if (typeof r !== "number" || !Number.isFinite(r) || r < 1 || r > 500) throw new BadRequest("radiusMi must be a number from 1 to 500");
    radiusMi = r;
  }

  let naics: string[] | undefined;
  if (b["naics"] !== undefined && b["naics"] !== null) {
    if (typeof b["naics"] !== "string" || b["naics"].length > 100) throw new BadRequest("naics must be a string of at most 100 characters");
    const codes = b["naics"].split(/[\s,]+/).filter(c => c.length > 0);
    if (!codes.every(c => /^\d{2,6}$/.test(c))) throw new BadRequest("naics codes must be 2 to 6 digits");
    if (codes.length > 0) naics = codes;
  }

  const flag = (key: string, fallback: boolean): boolean => {
    const v = b[key];
    if (v === undefined || v === null) return fallback;
    if (typeof v !== "boolean") throw new BadRequest(`${key} must be true or false`);
    return v;
  };

  let leads = DEFAULT_LEADS;
  if (b["leads"] !== undefined && b["leads"] !== null) {
    const n = b["leads"];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 50) throw new BadRequest("leads must be a whole number from 1 to 50");
    leads = n;
  }

  let region: string | undefined;
  if (b["region"] !== undefined && b["region"] !== null) {
    if (typeof b["region"] !== "string" || !knownRegions(SOURCES).includes(b["region"])) throw new BadRequest("unknown region");
    region = b["region"];
  }

  let direction: "buy" | "sell" | undefined;
  if (b["direction"] !== undefined && b["direction"] !== null && b["direction"] !== "auto") {
    if (b["direction"] !== "buy" && b["direction"] !== "sell") throw new BadRequest("direction must be auto, buy or sell");
    direction = b["direction"];
  }

  return {
    query, near, radiusMi, naics, region, leads, direction,
    checkAll: flag("checkAll", false),
    findContacts: flag("findContacts", true),
    noLlm: flag("noLlm", false),
  };
}

// Engine events -> the shapes the browser needs. Raw MapResult/SourceSpec
// objects (endpoints, field maps) stay on the server.
function translateEvent(event: EngineEvent): Record<string, unknown> | null {
  switch (event.type) {
    case "map":
      return {
        type: "map",
        direction: event.map.intent.direction,
        naics: event.map.intent.naics.map(code => ({ code, title: naicsLabel(code) ?? "" })),
        cities: event.map.intent.geo.cities,
        caveats: event.map.caveats,
        via: event.map.via,
        directionFixed: event.map.directionFixed,
        ...(event.map.llmError !== undefined ? { llmError: event.map.llmError } : {}),
      };
    case "origin":
      return { type: "origin", origin: event.origin };
    case "routed":
      return { type: "routed", sources: event.sources.map(s => ({ id: s.id, name: s.name })) };
    case "fetched":
      return { type: "fetched", sourceId: event.sourceId, count: event.count, capped: event.capped };
    case "source_error":
      return { type: "source_error", sourceId: event.sourceId, message: event.message };
    case "merged":
    case "backfilled":
    case "probed":
      return { type: event.type, count: event.count };
    case "backfill_progress":
      return { type: "backfill_progress", checked: event.checked, total: event.total };
    case "recent":
      return { type: "recent", count: event.count };
    case "contacts":
      return { ...event };
    default:
      return null;
  }
}

function buildResult(
  outcome: SearchOutcome,
  existenceIds: string[],
  params: SearchParams,
  sourceNames: Map<string, string>,
  fetchedBy: Map<string, { count: number; capped: boolean; error: boolean }>,
  llmBilling: LlmBilling | null
): Record<string, unknown> {
  const names = new Map(sourceNames);
  for (const s of outcome.routed) names.set(s.id, s.name);
  const naicsFields = naicsFieldMap(outcome.routed);
  const codes = outcome.map.intent.naics;
  const topN = params.leads;
  const view = (lead: Lead, rank: number, withEvidence: boolean): LeadView => leadView(lead, rank, existenceIds, names, naicsFields, codes, withEvidence);

  // Three lists from one ranking: coded businesses (the sheet), coded
  // individuals' records (a collapsed group), and name-only matches (a
  // collapsed group that never enters the headline count).
  // partitionLeads is the same split sheetCounts counts over.
  const ranks = new Map(outcome.ranked.map((l, i) => [l, i + 1]));
  const { businesses: main, individuals, nameOnly } = partitionLeads(outcome.ranked, codes);
  const radiusMi = params.radiusMi ?? DEFAULT_RADIUS_MI;
  const region = outcome.map.intent.geo.region;

  return {
    type: "result",
    origin: outcome.origin,
    region,
    regionName: REGION_NAMES[region] ?? region.replace(/^US-/, ""),
    summary: summaryCounts(outcome.ranked, codes),
    sheet: sheetCounts(outcome.ranked, codes, { radiusMi, hasOrigin: outcome.origin !== null, listCap: topN + MORE_LEADS }),
    registryLookup: outcome.registryLookup,
    sources: outcome.routed.map(s => ({ id: s.id, name: s.name, plane: s.plane, ...(fetchedBy.get(s.id) ?? { count: 0, capped: false, error: false }) })),
    contactLookups: outcome.contactLookups,
    llmCalls: outcome.llmCalls,
    llmUsage: outcome.llmUsage,
    llmBilling,
    leads: main.slice(0, topN).map(l => view(l, ranks.get(l) ?? 0, true)),
    more: main.slice(topN, topN + MORE_LEADS).map(l => view(l, ranks.get(l) ?? 0, true)),
    individuals: individuals.slice(0, GROUP_LEADS).map(l => view(l, ranks.get(l) ?? 0, true)),
    nameOnly: nameOnly.slice(0, GROUP_LEADS).map(l => view(l, ranks.get(l) ?? 0, false)),
    recent: outcome.recent.map((l, i) => view(l, i + 1, false)),
    recentWindow: outcome.recentWindow,
  };
}

function leadView(lead: Lead, rank: number, existenceIds: string[], names: Map<string, string>, naicsFields: Record<string, string>, codes: string[], withEvidence: boolean): LeadView {
  const e = lead.entity;
  const a = e.address;
  const address = { street: a.street ?? "", city: a.city ?? "", state: a.state ?? "", zip: a.zip ?? "" };
  const individual = isLikelyIndividual(e);
  const place = [e.name, address.street, address.city, address.state, address.zip].filter(v => v !== "").join(" ");
  // The code that best fits the request leads the plain-language line.
  const related = e.naics.filter(c => codes.some(q => naicsRelated(c, q)));
  const best = related[0] ?? e.naics[0];
  const onRegistry = e.source_ids.some(id => existenceIds.includes(id));
  const view: LeadView = {
    id: e.id,
    key: `${normalizeName(e.name)}|${(e.address.zip ?? "").trim().slice(0, 5)}`,
    rank,
    score: lead.score,
    name: e.name,
    aka: e.names,
    address,
    distanceMi: lead.distanceMi,
    band: lead.band,
    naics: e.naics.map(code => ({ code, title: naicsLabel(code) ?? "" })),
    what: best === undefined ? "" : naicsPhrase(naicsLabel(best) ?? ""),
    coded: related.length > 0,
    individual,
    employees: e.employees ?? null,
    lastSeen: e.lastSeen ?? null,
    formedDate: e.formedDate ?? null,
    sources: e.source_ids.map(id => ({ id, name: names.get(id) ?? id })),
    codeSources: codeSourceIds(e, naicsFields).map(id => ({ id, name: names.get(id) ?? id })),
    // The engine sets the tri-state; a lead from a caller that didn't falls
    // back to the join alone and never claims a lookup that may not have run.
    registryCheck: lead.registryCheck ?? (onRegistry ? "matched" : "not_checked"),
    registeredElsewhere: lead.registeredElsewhere === true,
    registryStanding: lead.registryStanding === undefined ? null : { status: lead.registryStanding.status, since: lead.registryStanding.since },
    status: e.status,
    contacts: e.contacts,
    web: lead.web,
    found: lead.found ?? null,
    officers: e.officers,
    searchUrl: individual ? null : lead.searchUrl,
    mapsUrl: individual ? null : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`,
    brief: lead.brief,
    opener: lead.opener,
  };
  if (withEvidence) {
    view.evidence = e.evidence.map(ev => ({ source: ev.source, field: ev.field, value: ev.value, note: ev.note ?? "" }));
  }
  return view;
}

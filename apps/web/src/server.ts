import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ClaudeCodeBackend, leadsToCsv, summaryCounts, codeSourceIds, naicsFieldMap } from "@registry-engine/qualify";
import type { search, EngineEvent, Lead, SearchOutcome } from "@registry-engine/qualify";
import { SOURCES, knownRegions, defaultRegion, lookupCodes, naicsLabel } from "@registry-engine/registry-core";

// The local web app's HTTP surface: static files, a status probe, a NAICS
// lookup, and one streaming search endpoint. Everything is loopback-only
// (main.ts binds 127.0.0.1; the Host check below stops DNS rebinding), and
// one search runs at a time because each can spend LLM and contact-API credits.

export interface AppDeps {
  search: typeof search;
  llmAvailable: () => Promise<boolean>;
  contactsProvider: () => string | null;
  port: number;
  publicDir: string;
}

const MAX_BODY_BYTES = 10 * 1024;
const MORE_LEADS = 300;
const DEFAULT_LEADS = 12;

const HTML_CSP = "default-src 'self'; img-src 'self' data:; connect-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

// Exact whitelist: the URL never takes part in building a file path.
const STATIC_FILES: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/app.css": { file: "app.css", type: "text/css; charset=utf-8" },
};

interface SearchParams {
  query: string;
  near: string | undefined;
  radiusMi: number | undefined;
  naics: string[] | undefined;
  hiddenOnly: boolean;
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
  rank: number;
  score: number;
  name: string;
  aka: string[];
  address: { street: string; city: string; state: string; zip: string };
  distanceMi: number | null;
  band: string;
  naics: { code: string; title: string }[];
  employees: number | null;
  lastSeen: string | null;
  sources: { id: string; name: string }[];
  codeSources: { id: string; name: string }[];   // the sources that carry the industry code
  onStateRegistry: boolean;
  status: string;
  contacts: string[];
  web: Lead["web"];
  found: Lead["found"] | null;
  officers: string[];
  searchUrl: string | null;
  mapsUrl: string;
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
        ...(path === "/" ? { "Content-Security-Policy": HTML_CSP } : {}),
      });
      res.end(head ? undefined : body);
      return;
    }

    if ((method === "GET" || head) && path === "/api/status") {
      sendJson(res, 200, {
        llm: await deps.llmAvailable(),
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
      const outcome = await deps.search(params.query, {
        llm: params.noLlm ? undefined : { backend: new ClaudeCodeBackend() },
        near: params.near,
        radiusMi: params.radiusMi,
        naics: params.naics,
        hiddenOnly: params.hiddenOnly,
        maxLeads: params.leads,
        region: params.region,
        direction: params.direction,
        contacts: params.findContacts ? undefined : null,
        onEvent: event => {
          const line = translateEvent(event);
          if (line !== null) write(line);
        },
      });

      const existenceIds = outcome.routed.filter(s => s.plane === "existence").map(s => s.id);
      last = { ranked: outcome.ranked, existenceIds };
      write(buildResult(outcome, existenceIds, params.leads, sourceNames));
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
    hiddenOnly: flag("hiddenOnly", false),
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
      };
    case "origin":
      return { type: "origin", origin: event.origin };
    case "routed":
      return { type: "routed", sources: event.sources.map(s => ({ id: s.id, name: s.name })) };
    case "fetched":
      return { type: "fetched", sourceId: event.sourceId, count: event.count };
    case "source_error":
      return { type: "source_error", sourceId: event.sourceId, message: event.message };
    case "merged":
    case "backfilled":
    case "probed":
      return { type: event.type, count: event.count };
    case "contacts":
      return { ...event };
    default:
      return null;
  }
}

function buildResult(outcome: SearchOutcome, existenceIds: string[], topN: number, sourceNames: Map<string, string>): Record<string, unknown> {
  const names = new Map(sourceNames);
  for (const s of outcome.routed) names.set(s.id, s.name);
  const naicsFields = naicsFieldMap(outcome.routed);
  const view = (lead: Lead, i: number, withEvidence: boolean): LeadView => leadView(lead, i + 1, existenceIds, names, naicsFields, withEvidence);
  return {
    type: "result",
    origin: outcome.origin,
    summary: summaryCounts(outcome.ranked, outcome.map.intent.naics),
    contactLookups: outcome.contactLookups,
    llmCalls: outcome.llmCalls,
    leads: outcome.ranked.slice(0, topN).map((l, i) => view(l, i, true)),
    more: outcome.ranked.slice(topN, topN + MORE_LEADS).map((l, i) => view(l, topN + i, false)),
  };
}

function leadView(lead: Lead, rank: number, existenceIds: string[], names: Map<string, string>, naicsFields: Record<string, string>, withEvidence: boolean): LeadView {
  const e = lead.entity;
  const a = e.address;
  const address = { street: a.street ?? "", city: a.city ?? "", state: a.state ?? "", zip: a.zip ?? "" };
  const place = [e.name, address.street, address.city, address.state, address.zip].filter(v => v !== "").join(" ");
  const view: LeadView = {
    id: e.id,
    rank,
    score: lead.score,
    name: e.name,
    aka: e.names,
    address,
    distanceMi: lead.distanceMi,
    band: lead.band,
    naics: e.naics.map(code => ({ code, title: naicsLabel(code) ?? "" })),
    employees: e.employees ?? null,
    lastSeen: e.lastSeen ?? null,
    sources: e.source_ids.map(id => ({ id, name: names.get(id) ?? id })),
    codeSources: codeSourceIds(e, naicsFields).map(id => ({ id, name: names.get(id) ?? id })),
    onStateRegistry: e.source_ids.some(id => existenceIds.includes(id)),
    status: e.status,
    contacts: e.contacts,
    web: lead.web,
    found: lead.found ?? null,
    officers: e.officers,
    searchUrl: lead.searchUrl,
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`,
    brief: lead.brief,
    opener: lead.opener,
  };
  if (withEvidence) {
    view.evidence = e.evidence.map(ev => ({ source: ev.source, field: ev.field, value: ev.value, note: ev.note ?? "" }));
  }
  return view;
}

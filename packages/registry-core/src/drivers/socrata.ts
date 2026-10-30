import type { Driver, SourceSpec, FetchRequest, RecentRequest, FetchByNamesExtra } from "../driver.js";
import type { Entity } from "../entity.js";
import { ORG_SUFFIXES } from "../entity.js";
import { buildSoqlUrl, fetchWithRetry, Limiter, type FetchRetryOptions } from "../util/http.js";
import { rowToEntity, keywordEvidence, fieldEvidence, str } from "./mapRow.js";

const PAGE_SIZE = 1000;
const DEFAULT_LIMIT = 500;
const MAX_KEYWORDS = 8;
const ID_CHUNK = 100;
const CONCURRENCY = 4;
export const MAX_BACKFILL_NAMES = 80;    // cap on distinct name patterns per call
const NAME_CHUNK = 25;            // OR'd LIKE patterns per request
const BACKFILL_PAGE_LIMIT = 200;  // row cap per chunk request
const CACHE_TTL_MS = 15 * 60_000;  // a repeated page request within this reuses the parsed body
const CACHE_MAX = 200;             // entries kept (oldest dropped first)
const RECENT_LIMIT = 1000;        // default row cap for fetchRecent: one Socrata page, so the 90-day window isn't cut short statewide before the radius filter

// Socrata quirks carried by the manifest entry. The optional tradeNames block
// wires a second dataset whose descriptions are keyword-searched and whose
// hits join back to entities by ID (a DBA can match when the legal name
// doesn't — that's the point of trade names).
interface TradeNameQuirks {
  datasetId: string;
  statusValue: string;
  fields: { entityId: string; description: string; status: string; city: string };
}

interface SocrataQuirks {
  datasetId: string;
  statusValue?: string | undefined;       // absent = no status filter anywhere
  keywordFields?: string[] | undefined;   // source fields keywords are LIKE'd against; default [fields.name]
  tradeNames?: TradeNameQuirks | undefined;
  backfillInactive?: boolean | undefined; // fetchByNames also returns rows whose status isn't statusValue
}

// Keywords and cities are interpolated into SoQL LIKE clauses. Strip anything
// that could break out of the string literal or act as a wildcard.
export function soqlSafeLiteral(v: string): string {
  return v.toUpperCase().replace(/[%_']/g, "").replace(/\s+/g, " ").trim();
}

// LIKE pattern for an existence-registry name lookup, built from the RAW name
// (registries keep "&" and "'" that normalizeName rewrites): every
// non-alphanumeric run becomes a wildcard, AND and trailing org suffixes are
// dropped. "PAUL'S CUSTOM CANVAS INC" -> "%PAUL%S%CUSTOM%CANVAS%".
export function namePattern(name: string): string | null {
  const tokens = name.toUpperCase().split(/[^A-Z0-9]+/).filter(t => t.length > 0 && t !== "AND");
  while (tokens.length > 1 && ORG_SUFFIXES.has(tokens[tokens.length - 1]!)) tokens.pop();
  const safe = soqlSafeLiteral(tokens.join(" ")).split(" ").filter(t => t.length > 0);
  if (safe.join("").length < 4) return null;
  return `%${safe.join("%")}%`;
}

function likeClause(field: string, values: string[]): string {
  const parts = values.map(v => `upper(${field}) LIKE '%${v}%'`);
  return `(${parts.join(" OR ")})`;
}

// Keywords may hit any of several fields (a farm filing lists its crops in
// three); the clauses are OR'd.
function keywordClause(fields: string[], values: string[]): string {
  if (fields.length === 1) return likeClause(fields[0]!, values);
  return `(${fields.map(field => likeClause(field, values)).join(" OR ")})`;
}

export class SocrataDriver implements Driver {
  readonly kind = "socrata" as const;
  readonly defaultLimit: number = DEFAULT_LIMIT;
  readonly maxBackfillNames: number = MAX_BACKFILL_NAMES;

  // Page URL (+ whether an app token went with it) -> parsed 200 body. Map
  // insertion order is age order, so the first key is the oldest.
  private readonly cache = new Map<string, { at: number; page: Record<string, unknown>[] }>();

  backfillKey(name: string): string | null {
    return namePattern(name);
  }

  async fetch(source: SourceSpec, req: FetchRequest, opts: FetchRetryOptions = {}): Promise<Entity[]> {
    const quirks = readQuirks(source);
    const keywords = req.keywords.map(soqlSafeLiteral).filter(k => k.length >= 3).slice(0, MAX_KEYWORDS);
    // Existence registries are only ever keyword-searched: without keywords a
    // statewide query would stream the whole registry.
    if (keywords.length === 0) return [];
    const cities = req.cities.map(soqlSafeLiteral).filter(c => c.length > 0);
    const limit = req.limit ?? DEFAULT_LIMIT;
    const limiter = new Limiter(CONCURRENCY);

    const f = source.fields;
    const statusWhere = statusClause(source, quirks);
    const keywordFields = quirks.keywordFields ?? [f["name"]!];
    // Sources with only a one-line address are city-filtered against that.
    const entityCityField = f["city"] ?? f["address_line"];
    const cityWhere = (cityField: string | undefined) =>
      (cities.length > 0 && cityField !== undefined ? [likeClause(cityField, cities)] : []);

    // 1) Entities whose keyword fields (default: legal name) match a keyword.
    const entityWhere = [
      ...statusWhere,
      keywordClause(keywordFields, keywords),
      ...cityWhere(entityCityField),
    ].join(" AND ");
    const nameRows = await this.pages(source, quirks.datasetId, entityWhere, limit, limiter, opts);

    // 2) Trade names whose description matches; pull their entities by ID.
    let tradeRows: Record<string, unknown>[] = [];
    const tn = quirks.tradeNames;
    if (tn !== undefined) {
      const tradeWhere = [
        `${tn.fields.status}='${tn.statusValue}'`,
        likeClause(tn.fields.description, keywords),
        ...cityWhere(tn.fields.city),
      ].join(" AND ");
      tradeRows = await this.pages(source, tn.datasetId, tradeWhere, limit, limiter, opts);
    }

    const idField = f["id"]!;
    const byId = new Map<string, Record<string, unknown>>();
    for (const row of nameRows) byId.set(str(row[idField]), row);

    const missingIds = tn === undefined ? [] : [...new Set(
      tradeRows.map(r => str(r[tn.fields.entityId])).filter(id => id !== "" && !byId.has(id))
    )];
    for (const chunk of chunks(missingIds, ID_CHUNK)) {
      const where = [
        `${idField} IN (${chunk.map(id => `'${soqlSafeLiteral(id)}'`).join(",")})`,
        ...statusWhere,
      ].join(" AND ");
      for (const row of await this.pages(source, quirks.datasetId, where, limit, limiter, opts)) {
        byId.set(str(row[idField]), row);
      }
    }

    // 3) Hydrate ALL result entities with their trade names, so names[] can
    // merge against other planes even when the match came from the legal name.
    const tradeNamesByEntity = new Map<string, Record<string, unknown>[]>();
    if (tn !== undefined && byId.size > 0) {
      for (const chunk of chunks([...byId.keys()], ID_CHUNK)) {
        const where = [
          `${tn.fields.entityId} IN (${chunk.map(id => `'${soqlSafeLiteral(id)}'`).join(",")})`,
          `${tn.fields.status}='${tn.statusValue}'`,
        ].join(" AND ");
        for (const row of await this.pages(source, tn.datasetId, where, 10000, limiter, opts)) {
          const eid = str(row[tn.fields.entityId]);
          const list = tradeNamesByEntity.get(eid) ?? [];
          list.push(row);
          tradeNamesByEntity.set(eid, list);
        }
      }
    }

    const entities: Entity[] = [];
    for (const [id, row] of byId) {
      const entity = rowToEntity(source, row);
      for (const kf of keywordFields) {
        entity.evidence.push(...keywordEvidence(source, kf, str(row[kf]), keywords));
      }
      // The trade dataset repeats descriptions across filings — dedupe per entity.
      const seenDescs = new Set<string>();
      for (const tr of tradeNamesByEntity.get(id) ?? []) {
        const desc = tn === undefined ? "" : str(tr[tn.fields.description]);
        if (desc === "" || seenDescs.has(desc.toUpperCase())) continue;
        seenDescs.add(desc.toUpperCase());
        if (!entity.names.includes(desc)) entity.names.push(desc);
        if (tn !== undefined) {
          entity.evidence.push(...keywordEvidence(source, tn.fields.description, desc, keywords));
        }
      }
      entity.evidence.push(...fieldEvidence(source, row));
      entities.push(entity);
      if (entities.length >= limit) break;
    }
    return entities;
  }

  // Targeted existence lookup: given business names discovered on another
  // plane, fetch existence-registry rows whose name matches — no keywords,
  // no city filter, just a normalized-name LIKE join back to the caller.
  // extra.maxNames overrides MAX_BACKFILL_NAMES (Infinity = no cap);
  // extra.onProgress(checked, total) fires as each chunk's queries settle.
  async fetchByNames(source: SourceSpec, names: string[], opts: FetchRetryOptions = {}, extra: FetchByNamesExtra = {}): Promise<Entity[]> {
    const quirks = readQuirks(source);
    const patterns: string[] = [];
    for (const name of names) {
      const pattern = namePattern(name);
      if (pattern !== null && !patterns.includes(pattern)) patterns.push(pattern);
    }
    const capped = patterns.slice(0, extra.maxNames ?? MAX_BACKFILL_NAMES);
    if (capped.length === 0) return [];

    const f = source.fields;
    const statusWhere = statusClause(source, quirks);
    const limiter = new Limiter(CONCURRENCY);

    // With quirks.backfillInactive, a second query per chunk returns the
    // rows NOT in the active status (dissolved, delinquent, ...), so a lead
    // can say "Dissolved Oct 2026" instead of "not on the registry". It is a
    // separate query so inactive rows can't crowd active ones out of the
    // per-chunk row cap; active rows come first in the result.
    const inactiveWhere = quirks.backfillInactive === true && statusWhere.length > 0
      ? [`${f["status"]!}<>'${quirks.statusValue!}'`] : null;
    // Every chunk's queries go through the shared limiter at once; a chunk
    // counts toward progress when all its queries settle (chunks settle out
    // of order, so the count is a running sum).
    const total = capped.length;
    let checked = 0;
    const chunkResults = await Promise.all(chunks(capped, NAME_CHUNK).map(chunk => {
      const queries = [
        [...statusWhere, likeClause(f["name"]!, chunk)].join(" AND "),
        ...(inactiveWhere === null ? [] : [[...inactiveWhere, likeClause(f["name"]!, chunk)].join(" AND ")]),
      ];
      return Promise.all(queries.map(where =>
        this.pages(source, quirks.datasetId, where, BACKFILL_PAGE_LIMIT, limiter, opts)))
        .then(rows => {
          checked += chunk.length;
          extra.onProgress?.(checked, total);
          return rows.flat();
        });
    }));

    const idField = f["id"]!;
    const byId = new Map<string, Record<string, unknown>>();
    for (const row of chunkResults.flat()) {
      const id = str(row[idField]);
      if (!byId.has(id)) byId.set(id, row);
    }

    const entities: Entity[] = [];
    for (const row of byId.values()) {
      const entity = rowToEntity(source, row);
      entity.evidence.push({
        source: source.id, field: f["name"]!, value: entity.name,
        note: "existence backfill — name match from another plane",
      });
      entity.evidence.push(...fieldEvidence(source, row));
      entities.push(entity);
    }
    return entities;
  }

  // Existence entities formed on or after `since`, newest first, whose name
  // matches a keyword. `since` is interpolated into SoQL, so it is validated.
  async fetchRecent(source: SourceSpec, req: RecentRequest, opts: FetchRetryOptions = {}): Promise<Entity[]> {
    const formedField = source.fields["formedDate"];
    if (formedField === undefined) return [];
    const keywords = req.keywords.map(soqlSafeLiteral).filter(k => k.length >= 3).slice(0, MAX_KEYWORDS);
    if (keywords.length === 0) return [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.since)) throw new Error("fetchRecent: since must be YYYY-MM-DD");

    const quirks = readQuirks(source);
    const f = source.fields;
    const where = [
      ...statusClause(source, quirks),
      likeClause(f["name"]!, keywords),
      `${formedField} >= '${req.since}T00:00:00'`,
    ].join(" AND ");
    const rows = await this.pages(source, quirks.datasetId, where, req.limit ?? RECENT_LIMIT, new Limiter(CONCURRENCY), opts, `${formedField} DESC`);

    const idField = f["id"]!;
    const byId = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const id = str(row[idField]);
      if (!byId.has(id)) byId.set(id, row);
    }
    const entities: Entity[] = [];
    for (const row of byId.values()) {
      const entity = rowToEntity(source, row);
      entity.evidence.push(...keywordEvidence(source, f["name"]!, str(row[f["name"]!]), keywords));
      entity.evidence.push(...fieldEvidence(source, row));
      entities.push(entity);
    }
    return entities;
  }

  private async pages(
    source: SourceSpec,
    datasetId: string,
    where: string,
    limit: number,
    limiter: Limiter,
    opts: FetchRetryOptions,
    order?: string
  ): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = [];
    let offset = 0;
    while (rows.length < limit) {
      const requested = Math.min(PAGE_SIZE, limit - rows.length);
      const url = buildSoqlUrl(`${source.endpoint}/${datasetId}.json`, {
        $where: where,
        $limit: String(requested),
        $offset: String(offset),
        $order: order ?? ":id",
      });
      const key = `${opts.appToken !== undefined ? "token " : ""}${url}`;
      let page = this.cached(key);
      if (page === undefined) {
        const resp = await limiter.run(() => fetchWithRetry(url, opts));
        if (!resp.ok) throw new Error(`${source.id}: HTTP ${resp.status}`);
        page = (await resp.json()) as Record<string, unknown>[];
        if (resp.status === 200) this.remember(key, page);
      }
      rows.push(...page);
      if (page.length < requested) break;
      offset += requested;
    }
    return rows.slice(0, Math.max(limit, 0));
  }

  private cached(key: string): Record<string, unknown>[] | undefined {
    const hit = this.cache.get(key);
    if (hit === undefined) return undefined;
    if (Date.now() - hit.at > CACHE_TTL_MS) {
      this.cache.delete(key);
      return undefined;
    }
    return hit.page;
  }

  private remember(key: string, page: Record<string, unknown>[]): void {
    this.cache.delete(key);
    this.cache.set(key, { at: Date.now(), page });
    while (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
  }
}

function readQuirks(source: SourceSpec): SocrataQuirks {
  const q = source.quirks ?? {};
  const datasetId = q["datasetId"];
  const statusValue = typeof q["statusValue"] === "string" ? q["statusValue"] : undefined;
  if (typeof datasetId !== "string") {
    throw new Error(`source "${source.id}": socrata driver needs quirks.datasetId`);
  }
  const kf = q["keywordFields"];
  const keywordFields = Array.isArray(kf) && kf.length > 0 && kf.every(x => typeof x === "string")
    ? (kf as string[]) : undefined;
  let tradeNames: TradeNameQuirks | undefined;
  const tn = q["tradeNames"];
  if (tn !== undefined) {
    tradeNames = tn as TradeNameQuirks;
    if (typeof tradeNames.datasetId !== "string" || typeof tradeNames.statusValue !== "string" || typeof tradeNames.fields !== "object") {
      throw new Error(`source "${source.id}": quirks.tradeNames needs datasetId, statusValue, fields`);
    }
  }
  return { datasetId, statusValue, keywordFields, tradeNames, backfillInactive: q["backfillInactive"] === true };
}

// The existence-status filter, or nothing when the source has no status.
function statusClause(source: SourceSpec, quirks: SocrataQuirks): string[] {
  const statusField = source.fields["status"];
  return quirks.statusValue !== undefined && statusField !== undefined
    ? [`${statusField}='${quirks.statusValue}'`] : [];
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

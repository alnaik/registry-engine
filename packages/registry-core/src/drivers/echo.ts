import type { Driver, SourceSpec, FetchRequest } from "../driver.js";
import type { Entity } from "../entity.js";
import { fetchWithRetry, Limiter, type FetchRetryOptions } from "../util/http.js";
import { rowToEntity, fieldEvidence } from "./mapRow.js";

// EPA ECHO (Enforcement and Compliance History Online): every active
// regulated facility, with the NAICS codes it filed and its last inspection
// date. The REST service is a two-step query — get_facilities runs the
// search and returns a QueryID, get_qid pages through the result rows.
//   <endpoint>/echo_rest_services.get_facilities?output=JSON&p_st=CO&p_ncs=332&p_act=Y
//   <endpoint>/echo_rest_services.get_qid?output=JSON&qid=<QueryID>&pageno=1&responseset=500
// Query codes must be 3-6 digits (p_ncs prefix-matches); sectors alone are
// too broad to ask ECHO for.

const DEFAULT_LIMIT = 500;
const MAX_PAGE_SIZE = 1000;
const CONCURRENCY = 2;

interface EchoResults {
  QueryID?: string;
  QueryRows?: string;
  Error?: unknown;
  Facilities?: Record<string, unknown>[];
}

export class EchoDriver implements Driver {
  readonly kind = "echo" as const;

  async fetch(source: SourceSpec, req: FetchRequest, opts: FetchRetryOptions = {}): Promise<Entity[]> {
    const codes = req.naics.filter(c => /^\d{3,6}$/.test(c));
    if (codes.length === 0) return [];
    const state = req.region.startsWith("US-") ? req.region.slice("US-".length) : "";
    if (state === "") return [];

    const limit = req.limit ?? DEFAULT_LIMIT;
    const limiter = new Limiter(CONCURRENCY);
    const cities = req.cities.map(c => c.toUpperCase());
    const searches = cities.length > 0 ? cities : [undefined];

    const perSearch = await Promise.all(searches.map(async city => {
      const params: Record<string, string> = { output: "JSON", p_st: state, p_ncs: codes.join(","), p_act: "Y" };
      if (city !== undefined) params["p_ct"] = city;
      const started = await this.call(source, "get_facilities", params, limiter, opts);
      const qid = started.QueryID;
      if (qid === undefined) throw new Error(`source "${source.id}": ECHO returned no QueryID`);

      const rows: Record<string, unknown>[] = [];
      for (let pageno = 1; rows.length < limit; pageno++) {
        const page = await this.call(source, "get_qid", {
          output: "JSON", qid, pageno: String(pageno), responseset: String(Math.min(limit, MAX_PAGE_SIZE)),
        }, limiter, opts);
        const facilities = page.Facilities ?? [];
        if (facilities.length === 0) break;
        rows.push(...facilities);
      }
      return rows.slice(0, limit);
    }));

    const byId = new Map<string, Entity>();
    for (const row of perSearch.flat()) {
      const entity = rowToEntity(source, row);
      if (byId.has(entity.id)) continue;
      entity.evidence.push({
        source: source.id,
        field: "registry",
        value: source.name,
        note: `NAICS ${(entity.naics.length > 0 ? entity.naics : codes).join(",")} · last inspection ${entity.lastSeen ?? "none on record"}`,
      });
      entity.evidence.push(...fieldEvidence(source, row));
      byId.set(entity.id, entity);
    }
    return [...byId.values()];
  }

  private async call(
    source: SourceSpec,
    service: "get_facilities" | "get_qid",
    params: Record<string, string>,
    limiter: Limiter,
    opts: FetchRetryOptions
  ): Promise<EchoResults> {
    const url = `${source.endpoint}/echo_rest_services.${service}?${new URLSearchParams(params).toString()}`;
    const resp = await limiter.run(() => fetchWithRetry(url, opts));
    if (!resp.ok) throw new Error(`source "${source.id}": ${service} -> HTTP ${resp.status}`);
    const body = (await resp.json()) as { Results?: EchoResults };
    const results = body.Results;
    if (results === undefined || results.Error !== undefined) {
      throw new Error(`source "${source.id}": ${echoMessage(results?.Error)}`);
    }
    return results;
  }
}

// ECHO reports errors as a string or as { ErrorMessage }.
function echoMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (typeof err === "object" && err !== null) {
    const m = (err as Record<string, unknown>)["ErrorMessage"];
    if (typeof m === "string") return m;
    return JSON.stringify(err);
  }
  return "ECHO returned no Results";
}

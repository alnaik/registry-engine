import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Entity } from "@registry-engine/registry-core";
import { Limiter, normalizeName } from "@registry-engine/registry-core";
import type { Lead } from "./brief.js";
import { publishedDomain } from "./probe.js";

// Web contact lookup for the top leads. Registries rarely publish a phone or
// website, so one web-search API call per lead (Exa or Parallel) fetches
// candidate pages and extractContact() reads them DETERMINISTICALLY — regexes
// and a name+place match, no model. Page text never reaches an LLM, only the
// extracted strings do. Results are cached on disk and every one carries its
// source URLs: this is "found online, verify", never a verified record.

export interface WebResult { url: string; title: string; text: string }

export interface WebSearchProvider {
  readonly name: string;
  search(query: string, objective: string, signal?: AbortSignal | undefined): Promise<{ results: WebResult[]; costDollars?: number | undefined }>;
}

export interface FoundContact {
  website?: string | undefined;
  phone?: string | undefined;
  email?: string | undefined;
  listings: string[];      // directory hosts that list the business
  sourceUrls: string[];    // pages the extracted values came from
  status: "found" | "directory" | "not-found" | "skipped";
  provider: string;
  reason?: string | undefined;
}

const SEARCH_TIMEOUT_MS = 20_000;

export function exaProvider(apiKey: string, fetchImpl: typeof fetch = fetch): WebSearchProvider {
  return {
    name: "exa",
    async search(query, _objective, signal) {
      const resp = await fetchImpl("https://api.exa.ai/search", {
        method: "POST",
        headers: { "x-api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          query,
          type: "auto",
          numResults: 6,
          userLocation: "US",
          contents: { text: { maxCharacters: 1500 } },   // never `summary`: that is model-generated
        }),
        signal: searchSignal(signal),
      });
      if (!resp.ok) throw new Error(`exa search -> HTTP ${resp.status}`);
      const data = (await resp.json()) as { results?: unknown; costDollars?: { total?: unknown } };
      const total = data.costDollars?.total;
      return {
        results: toResults(data.results, r => (typeof r["text"] === "string" ? r["text"] : "")),
        costDollars: typeof total === "number" ? total : undefined,
      };
    },
  };
}

export function parallelProvider(apiKey: string, fetchImpl: typeof fetch = fetch): WebSearchProvider {
  return {
    name: "parallel",
    async search(query, objective, signal) {
      const resp = await fetchImpl("https://api.parallel.ai/v1/search", {
        method: "POST",
        headers: { "x-api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify({ objective, search_queries: [query], mode: "fast" }),
        signal: searchSignal(signal),
      });
      if (!resp.ok) throw new Error(`parallel search -> HTTP ${resp.status}`);
      const data = (await resp.json()) as { results?: unknown };
      return {
        results: toResults(data.results, r =>
          Array.isArray(r["excerpts"]) ? r["excerpts"].filter((x): x is string => typeof x === "string").join("\n") : ""),
      };
    },
  };
}

// The per-request deadline, plus the caller's cancel when there is one.
function searchSignal(signal: AbortSignal | undefined): AbortSignal {
  const deadline = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
  return signal === undefined ? deadline : AbortSignal.any([signal, deadline]);
}

function toResults(raw: unknown, text: (r: Record<string, unknown>) => string): WebResult[] {
  if (!Array.isArray(raw)) return [];
  const out: WebResult[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r["url"] !== "string") continue;
    out.push({ url: r["url"], title: typeof r["title"] === "string" ? r["title"] : "", text: text(r) });
  }
  return out;
}

// EXA_API_KEY wins over PARALLEL_API_KEY; neither -> lookups are off.
export function providerFromEnv(env: Record<string, string | undefined> = process.env): WebSearchProvider | null {
  const exa = env["EXA_API_KEY"];
  if (exa !== undefined && exa !== "") return exaProvider(exa);
  const parallel = env["PARALLEL_API_KEY"];
  if (parallel !== undefined && parallel !== "") return parallelProvider(parallel);
  return null;
}

// ---- extraction (pure) ----------------------------------------------------

const NAME_STOP = new Set([
  "AND", "THE", "OF", "A", "AN", "CO", "COMPANY", "INC", "LLC", "CORP", "SERVICES", "SERVICE",
  "GROUP", "ENTERPRISES", "DENVER", "COLORADO",
]);

const DIRECTORY_HOSTS = [
  "yelp.com", "bbb.org", "yellowpages.com", "manta.com", "mapquest.com", "facebook.com",
  "linkedin.com", "instagram.com", "x.com", "twitter.com", "opencorporates.com", "bizapedia.com",
  "dnb.com", "zoominfo.com", "buzzfile.com", "chamberofcommerce.com", "nextdoor.com", "google.com",
  "angi.com", "houzz.com", "thumbtack.com", "porch.com", "indeed.com", "glassdoor.com",
  "corporationwiki.com", "opengovco.com", "bloomberg.com", "crunchbase.com", "sos.state.co.us",
  "coloradosos.gov", "usaspending.gov", "sam.gov",
];

const PHONE_RE = /(?:\+?1[-.\s]?)?\(?([2-9]\d{2})\)?[-.\s]?([2-9]\d{2})[-.\s]?(\d{4})\b/;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|svg)$/;
const ORG_AFTER_COMMA = new Set([
  "INC", "INC.", "LLC", "L.L.C.", "LTD", "LTD.", "CO", "CO.", "CORP", "CORP.", "CORPORATION",
  "COMPANY", "LP", "LLP", "PLLC", "PC", "P.C.",
]);
const INDIVIDUAL_TYPES = new Set(["sole proprietorship", "self-employed individuals", "independent contractors"]);

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

// The directory entry a host belongs to (including subdomains), else null.
function directoryOf(host: string): string | null {
  return DIRECTORY_HOSTS.find(d => host === d || host.endsWith(`.${d}`)) ?? null;
}

// A sole proprietor's or farm debtor's record is a person's: no web search.
export function isLikelyIndividual(entity: Entity): boolean {
  const personal = entity.evidence.some(ev =>
    ev.source === "ppp" && ev.field === "business_type" && INDIVIDUAL_TYPES.has(ev.value.trim().toLowerCase()));
  if (personal) return true;
  // "LAST, FIRST" — unless the word after the comma is an org suffix ("ACME, INC").
  const m = /^[A-Za-z'-]+,\s+([A-Za-z][^\s,]*)/.exec(entity.name.trim());
  return m !== null && !ORG_AFTER_COMMA.has(m[1]!.toUpperCase());
}

export function extractContact(entity: Entity, results: WebResult[], provider: string): FoundContact {
  const cityWords = new Set(normalizeName(entity.address.city ?? "").split(" ").filter(Boolean));
  const all = normalizeName(entity.name).split(" ").filter(t => t.length >= 3);
  const distinctive = all.filter(t => !NAME_STOP.has(t) && !cityWords.has(t));
  const tokens = distinctive.length > 0 ? distinctive : all;
  const need = Math.max(1, Math.ceil(0.6 * tokens.length));

  const city = (entity.address.city ?? "").trim().toLowerCase();
  const zip = (entity.address.zip ?? "").trim().slice(0, 5);

  interface Hit { result: WebResult; host: string; directory: string | null }
  const hits: Hit[] = [];
  for (const result of results) {
    if (tokens.length === 0) break;
    const host = hostOf(result.url);
    const hay = `${result.title} ${host.replace(/[.-]/g, " ")} ${result.text.slice(0, 600)}`.toUpperCase();
    const hostLetters = host.replace(/[^a-z0-9]/g, "").toUpperCase();
    const matched = tokens.filter(t => hay.includes(t) || hostLetters.includes(t)).length;
    if (matched < need) continue;
    const body = `${result.title} ${result.text}`.toLowerCase();
    const placed = (city !== "" && body.includes(city)) || (zip.length === 5 && body.includes(zip));
    if (!placed) continue;
    hits.push({ result, host, directory: directoryOf(host) });
  }

  const websiteHit = hits.find(h => h.directory === null);
  const websiteHost = websiteHit?.host;
  const website = websiteHit !== undefined && publishedDomain(entity) === null ? `https://${websiteHit.host}` : undefined;

  // Phone/email source order: the business's own page, then directories, then the rest.
  const ordered = [
    ...hits.filter(h => h === websiteHit),
    ...hits.filter(h => h.directory !== null),
    ...hits.filter(h => h !== websiteHit && h.directory === null),
  ];

  let phone: string | undefined;
  let phoneUrl: string | undefined;
  for (const h of ordered) {
    const m = PHONE_RE.exec(`${h.result.title} ${h.result.text}`);
    if (m !== null) {
      phone = `(${m[1]}) ${m[2]}-${m[3]}`;
      phoneUrl = h.result.url;
      break;
    }
  }

  const emails: Array<{ email: string; url: string }> = [];
  for (const h of ordered) {
    for (const m of `${h.result.title} ${h.result.text}`.match(EMAIL_RE) ?? []) {
      const email = m.toLowerCase();
      const domain = email.slice(email.indexOf("@") + 1);
      if (directoryOf(domain) !== null || IMAGE_EXT.test(domain)) continue;
      if (domain === "example.com" || email.includes("sentry")) continue;
      emails.push({ email, url: h.result.url });
    }
  }
  const pickedEmail = emails.find(e => websiteHost !== undefined && e.email.endsWith(`@${websiteHost}`)) ?? emails[0];

  const listings = [...new Set(hits.flatMap(h => (h.directory === null ? [] : [h.directory])))];

  const sourceUrls = [...new Set([
    ...(website !== undefined && websiteHit !== undefined ? [websiteHit.result.url] : []),
    ...(phoneUrl !== undefined ? [phoneUrl] : []),
    ...(pickedEmail !== undefined ? [pickedEmail.url] : []),
    ...hits.filter(h => h.directory !== null).map(h => h.result.url),
  ])].slice(0, 5);

  const status: FoundContact["status"] = website !== undefined ? "found"
    : listings.length > 0 || phone !== undefined || pickedEmail !== undefined ? "directory"
      : "not-found";

  const found: FoundContact = { listings, sourceUrls, status, provider };
  if (website !== undefined) found.website = website;
  if (phone !== undefined) found.phone = phone;
  if (pickedEmail !== undefined) found.email = pickedEmail.email;
  return found;
}

// ---- cache ----------------------------------------------------------------

export interface ContactCache {
  get(key: string): FoundContact | undefined;
  set(key: string, v: FoundContact): void;
}

const CACHE_TTL_MS = 30 * 86_400_000;

export function memoryContactCache(): ContactCache {
  const map = new Map<string, FoundContact>();
  return { get: key => map.get(key), set: (key, v) => { map.set(key, v); } };
}

// ~/.cache/registry-engine/contacts.json: { key: { at: <ms>, v: FoundContact } }.
// Read once, written through on every set, never throws — a broken file is an
// empty cache.
export function fileContactCache(path: string = join(homedir(), ".cache", "registry-engine", "contacts.json")): ContactCache {
  let entries: Record<string, { at: number; v: FoundContact }> | undefined;
  const load = (): Record<string, { at: number; v: FoundContact }> => {
    if (entries !== undefined) return entries;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
      entries = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? parsed as Record<string, { at: number; v: FoundContact }> : {};
    } catch {
      entries = {};
    }
    return entries;
  };
  return {
    get(key) {
      try {
        const entry = load()[key];
        if (entry === undefined || typeof entry.at !== "number" || typeof entry.v !== "object" || entry.v === null) return undefined;
        return Date.now() - entry.at < CACHE_TTL_MS ? entry.v : undefined;
      } catch {
        return undefined;
      }
    },
    set(key, v) {
      try {
        load()[key] = { at: Date.now(), v };
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify(entries));
      } catch {
        // an unwritable cache only costs a repeat lookup
      }
    },
  };
}

// ---- lookup ---------------------------------------------------------------

function cacheKey(provider: string, e: Entity): string {
  const zip = (e.address.zip ?? "").trim().slice(0, 5);
  const place = zip !== "" ? zip : (e.address.city ?? "").trim().toUpperCase();
  return `${provider}|${normalizeName(e.name)}|${place}`;
}

// Sets `lead.found` on the first `limit` leads. looked = leads not skipped
// (cache hits included), found = leads whose status is "found" or
// "directory", costDollars = what the provider reported for real requests.
export async function findContacts(
  leads: Lead[],
  provider: WebSearchProvider,
  opts: { limit: number; concurrency?: number | undefined; cache?: ContactCache | undefined; signal?: AbortSignal | undefined }
): Promise<{ looked: number; found: number; costDollars: number }> {
  const limiter = new Limiter(opts.concurrency ?? 3);
  const cache = opts.cache;
  let looked = 0;
  let found = 0;
  let costDollars = 0;

  await Promise.all(leads.slice(0, Math.max(0, opts.limit)).map(lead => limiter.run(async () => {
    const e = lead.entity;
    if (isLikelyIndividual(e)) {
      lead.found = {
        listings: [], sourceUrls: [], status: "skipped", provider: provider.name,
        reason: "individual's record — not searched",
      };
      return;
    }
    looked++;
    const key = cacheKey(provider.name, e);
    const cached = cache?.get(key);
    if (cached !== undefined) {
      lead.found = cached;
    } else {
      const name = e.name.replace(/"/g, "").trim();
      const city = (e.address.city ?? "").trim();
      const state = (e.address.state ?? "").trim();
      const query = [`"${name}"`, city, state].filter(p => p !== "").join(" ");
      const where = [city, state].filter(p => p !== "").join(", ");
      const objective = `Official website, phone number and email of the business "${name}"${where !== "" ? ` in ${where}` : ""}.`;
      try {
        const res = await provider.search(query, objective, opts.signal);
        costDollars += res.costDollars ?? 0;
        lead.found = extractContact(e, res.results, provider.name);
        cache?.set(key, lead.found);
      } catch (err) {
        lead.found = {
          listings: [], sourceUrls: [], status: "not-found", provider: provider.name,
          reason: `lookup failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
    if (lead.found.status === "found" || lead.found.status === "directory") found++;
  })));

  return { looked, found, costDollars };
}

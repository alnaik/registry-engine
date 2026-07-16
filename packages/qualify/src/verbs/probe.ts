import type { Entity } from "@registry-engine/registry-core";
import { normalizeName, Limiter } from "@registry-engine/registry-core";

// probe(): zero-token contact discovery. Published contacts win; otherwise
// guess domain slugs from the business name and check A + MX over
// Cloudflare's CORS-enabled DNS-over-HTTPS. An MX hit yields a pattern
// email guess — always marked unverified in evidence.

const DOH_BASE = "https://cloudflare-dns.com/dns-query";
const FREEMAIL = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com",
  "icloud.com", "msn.com", "comcast.net", "live.com", "protonmail.com",
]);
// Name tokens that never belong in a domain slug.
const SLUG_NOISE = new Set(["THE", "AND", "OF", "A", "AN"]);

export interface ProbeResult {
  entityId: string;
  domain: string | null;
  a: boolean;
  mx: boolean;
  emailGuess: string | null;
  published: boolean;    // domain came from a published contact, not a guess
  tried: string[];
}

export interface ProbeOptions {
  limit?: number | undefined;         // probe at most N entities (default 25)
  concurrency?: number | undefined;
  existenceSourceId?: string | undefined;  // flag entities missing this source
  fetchImpl?: typeof fetch | undefined;
}

export async function probeEntities(entities: Entity[], opts: ProbeOptions = {}): Promise<Map<string, ProbeResult>> {
  const limit = opts.limit ?? 25;
  const limiter = new Limiter(opts.concurrency ?? 4);
  const doFetch = opts.fetchImpl ?? fetch;
  const results = new Map<string, ProbeResult>();

  const jobs = entities.slice(0, limit).map(entity =>
    probeOne(entity, limiter, doFetch).then(r => {
      results.set(entity.id, r);
      applyToEntity(entity, r);
      if (opts.existenceSourceId !== undefined && !entity.source_ids.includes(opts.existenceSourceId)) {
        entity.evidence.push({
          source: "probe",
          field: "existence",
          value: opts.existenceSourceId,
          note: `no ${opts.existenceSourceId} match — may be registered under a different legal name`,
        });
      }
    })
  );
  await Promise.all(jobs);
  return results;
}

async function probeOne(entity: Entity, limiter: Limiter, doFetch: typeof fetch): Promise<ProbeResult> {
  const result: ProbeResult = {
    entityId: entity.id, domain: null, a: false, mx: false,
    emailGuess: null, published: false, tried: [],
  };

  const published = publishedDomain(entity);
  const candidates = published !== null ? [published] : slugCandidates(entity);

  for (const domain of candidates) {
    result.tried.push(domain);
    const [a, mx] = await Promise.all([
      hasRecords(domain, "A", limiter, doFetch),
      hasRecords(domain, "MX", limiter, doFetch),
    ]);
    if (a || mx) {
      result.domain = domain;
      result.a = a;
      result.mx = mx;
      result.published = published !== null;
      if (mx && !hasEmail(entity)) result.emailGuess = `info@${domain}`;
      break;
    }
  }
  return result;
}

function applyToEntity(entity: Entity, r: ProbeResult): void {
  if (r.domain === null) {
    entity.evidence.push({
      source: "probe", field: "dns", value: r.tried.join(", ") || "(no candidates)",
      note: "no live domain found from name-based guesses",
    });
    return;
  }
  const site = `https://${r.domain}`;
  if (!entity.contacts.some(c => c.includes(r.domain!))) entity.contacts.push(site);
  entity.evidence.push({
    source: "probe", field: "dns", value: r.domain,
    note: `${r.published ? "published domain" : "name-derived guess"} — A:${r.a ? "yes" : "no"} MX:${r.mx ? "yes" : "no"}`,
  });
  if (r.emailGuess !== null) {
    entity.contacts.push(r.emailGuess);
    entity.evidence.push({
      source: "probe", field: "email", value: r.emailGuess,
      note: "pattern guess from MX record — UNVERIFIED",
    });
  }
}

// A published email/website contact beats any guess — extract its domain.
export function publishedDomain(entity: Entity): string | null {
  for (const c of entity.contacts) {
    const email = c.match(/^[^@\s]+@([a-z0-9.-]+\.[a-z]{2,})$/i)?.[1]?.toLowerCase();
    if (email !== undefined && !FREEMAIL.has(email)) return email;
    const host = c.match(/^(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i)?.[1]?.toLowerCase();
    if (host !== undefined && c.includes(".") && !c.includes("@") && !FREEMAIL.has(host)) return host;
  }
  return null;
}

export function slugCandidates(entity: Entity): string[] {
  const tokens = normalizeName(entity.name).split(" ").filter(t => !SLUG_NOISE.has(t) && /^[A-Z0-9]+$/.test(t));
  const joined = tokens.join("").toLowerCase();
  const firstTwo = tokens.slice(0, 2).join("").toLowerCase();
  const out: string[] = [];
  for (const slug of [joined, firstTwo]) {
    if (slug.length >= 4 && slug.length <= 40 && !out.includes(slug)) out.push(slug);
  }
  return out.map(s => `${s}.com`);
}

function hasEmail(entity: Entity): boolean {
  return entity.contacts.some(c => c.includes("@"));
}

async function hasRecords(domain: string, type: "A" | "MX", limiter: Limiter, doFetch: typeof fetch): Promise<boolean> {
  try {
    const resp = await limiter.run(() =>
      doFetch(`${DOH_BASE}?name=${encodeURIComponent(domain)}&type=${type}`, {
        headers: { accept: "application/dns-json" },
      })
    );
    if (!resp.ok) return false;
    const data = (await resp.json()) as { Status?: number; Answer?: unknown[] };
    return data.Status === 0 && Array.isArray(data.Answer) && data.Answer.length > 0;
  } catch {
    return false;
  }
}

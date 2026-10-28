import type { Entity } from "@registry-engine/registry-core";
import { Limiter } from "@registry-engine/registry-core";

// probe(): zero-token contact verification. A published website contact
// is checked A + MX over Cloudflare's CORS-enabled DNS-over-HTTPS; there is
// no name-based domain guessing. An email address is not a website: its
// host is never probed and never makes the web label "verified" (the email
// stays in contacts as filed). An MX hit on a published website domain
// yields a pattern email guess — always marked unverified in evidence.
// Entities with no published website to verify are left for the web-search
// link generated downstream in brief().

const DOH_BASE = "https://cloudflare-dns.com/dns-query";
const FREEMAIL = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com",
  "icloud.com", "msn.com", "comcast.net", "live.com", "protonmail.com",
]);

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
  wasChecked?: ((entity: Entity) => boolean) | undefined;  // false = its name was never looked up in that source
  inactiveStatus?: ((entity: Entity) => string | null) | undefined;  // the registry's status when it has this name but not in good standing
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
        if (opts.wasChecked !== undefined && !opts.wasChecked(entity)) {
          entity.evidence.push({
            source: "probe",
            field: "existence",
            value: opts.existenceSourceId,
            note: `not checked against ${opts.existenceSourceId} — beyond the names looked up this search`,
          });
          return;
        }
        const inactive = opts.inactiveStatus?.(entity) ?? null;
        if (inactive !== null) {
          entity.evidence.push({
            source: "probe",
            field: "existence",
            value: opts.existenceSourceId,
            note: `on ${opts.existenceSourceId} as "${inactive}" — not in good standing; confirm it still operates`,
          });
          return;
        }
        entity.evidence.push({
          source: "probe",
          field: "existence",
          value: opts.existenceSourceId,
          note: `not found in ${opts.existenceSourceId} — sole proprietors and DBAs often aren't registered there, or it's under another legal name`,
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
  const candidates = published !== null ? [published] : [];

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
      source: "probe", field: "dns",
      value: r.tried.join(", ") || "(no published domain)",
      note: r.tried.length > 0
        ? "published domain did not resolve (A/MX both empty)"
        : "no published domain to verify — use the web-search link",
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

// A published website contact beats any guess — extract its host. Only
// URL-shaped contacts yield a domain; an email address never does.
export function publishedDomain(entity: Entity): string | null {
  for (const c of entity.contacts) {
    const host = c.match(/^(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})/i)?.[1]?.toLowerCase();
    if (host !== undefined && c.includes(".") && !c.includes("@") && !FREEMAIL.has(host)) return host;
  }
  return null;
}

function hasEmail(entity: Entity): boolean {
  return entity.contacts.some(c => c.includes("@"));
}

async function hasRecords(domain: string, type: "A" | "MX", limiter: Limiter, doFetch: typeof fetch): Promise<boolean> {
  try {
    const resp = await limiter.run(() =>
      doFetch(`${DOH_BASE}?name=${encodeURIComponent(domain)}&type=${type}`, {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(5_000),
      })
    );
    if (!resp.ok) return false;
    const data = (await resp.json()) as { Status?: number; Answer?: unknown[] };
    return data.Status === 0 && Array.isArray(data.Answer) && data.Answer.length > 0;
  } catch {
    return false;
  }
}

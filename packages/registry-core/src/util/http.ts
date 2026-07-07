export interface FetchRetryOptions {
  headers?: Record<string, string> | undefined;
  appToken?: string | undefined;  // Socrata app token -> X-App-Token header
  maxRetries?: number | undefined;
}

export class Limiter {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly maxConcurrent: number) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const attempt = () => {
        this.running++;
        fn().then(
          (val) => {
            this.running--;
            this.next();
            resolve(val);
          },
          (err) => {
            this.running--;
            this.next();
            reject(err as unknown);
          }
        );
      };

      if (this.running < this.maxConcurrent) {
        attempt();
      } else {
        this.queue.push(attempt);
      }
    });
  }

  private next(): void {
    const next = this.queue.shift();
    if (next !== undefined) {
      next();
    }
  }
}

function jitteredBackoff(attempt: number): number {
  const base = 1000;
  const max = 30000;
  const exp = Math.min(base * 2 ** attempt, max);
  // ±50% jitter
  const jitter = exp * 0.5 * (Math.random() * 2 - 1);
  return Math.max(0, exp + jitter);
}

export async function fetchWithRetry(
  url: string,
  opts: FetchRetryOptions = {}
): Promise<Response> {
  const maxRetries = opts.maxRetries ?? 4;
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.appToken !== undefined) {
    headers["X-App-Token"] = opts.appToken;
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let resp: Response;
    try {
      resp = await fetch(url, { headers });
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await sleep(jitteredBackoff(attempt));
        continue;
      }
      throw err;
    }

    if (resp.status === 429 || resp.status >= 500) {
      if (attempt < maxRetries) {
        let delay = jitteredBackoff(attempt);
        if (resp.status === 429) {
          const retryAfter = resp.headers.get("Retry-After");
          if (retryAfter !== null) {
            const parsed = parseFloat(retryAfter);
            if (!isNaN(parsed)) {
              delay = parsed * 1000;
            }
          }
        }
        await sleep(delay);
        continue;
      }
    }

    return resp;
  }

  throw lastError ?? new Error(`fetchWithRetry: max retries exceeded for ${url}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildSoqlUrl(base: string, params: Record<string, string>): string {
  // Keep SoQL $param keys unencoded — Socrata expects literal $where=, $limit=, etc.
  const queryParts = Object.entries(params).map(
    ([key, value]) => `${key}=${encodeURIComponent(value)}`
  );
  const separator = base.includes("?") ? "&" : "?";
  return queryParts.length > 0 ? `${base}${separator}${queryParts.join("&")}` : base;
}

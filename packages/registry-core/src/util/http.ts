export interface FetchRetryOptions {
  headers?: Record<string, string> | undefined;
  appToken?: string | undefined;  // Socrata app token -> X-App-Token header
  maxRetries?: number | undefined;
  timeoutMs?: number | undefined;  // per-attempt deadline (default 20_000)
  signal?: AbortSignal | undefined;  // caller's cancel: never retried, ends backoff sleeps early
}

const MAX_BACKOFF_MS = 30_000;

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
  const exp = Math.min(base * 2 ** attempt, MAX_BACKOFF_MS);
  // ±50% jitter
  const jitter = exp * 0.5 * (Math.random() * 2 - 1);
  return Math.max(0, exp + jitter);
}

export async function fetchWithRetry(
  url: string,
  opts: FetchRetryOptions = {}
): Promise<Response> {
  const maxRetries = opts.maxRetries ?? 4;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.appToken !== undefined) {
    headers["X-App-Token"] = opts.appToken;
  }

  const callerSignal = opts.signal;
  let lastError: unknown;
  // No response at all (refused, DNS, timeout) means the source is probably
  // down: one retry for the whole call, not the full 429/5xx budget.
  let networkRetried = false;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    callerSignal?.throwIfAborted();
    let resp: Response;
    try {
      const deadline = AbortSignal.timeout(timeoutMs);
      resp = await fetch(url, { headers, signal: callerSignal === undefined ? deadline : AbortSignal.any([callerSignal, deadline]) });
    } catch (err) {
      // A cancel from the caller is final, whatever the fetch threw.
      callerSignal?.throwIfAborted();
      lastError = err;
      if (attempt < maxRetries && !networkRetried) {
        networkRetried = true;
        await sleep(jitteredBackoff(attempt), callerSignal);
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
              delay = Math.min(parsed * 1000, MAX_BACKOFF_MS);
            }
          }
        }
        await sleep(delay, callerSignal);
        continue;
      }
    }

    return resp;
  }

  throw lastError ?? new Error(`fetchWithRetry: max retries exceeded for ${url}`);
}

// Resolves after ms; rejects with the signal's reason as soon as it aborts.
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(signal.reason as unknown);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal!.reason as unknown);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function buildSoqlUrl(base: string, params: Record<string, string>): string {
  // Keep SoQL $param keys unencoded — Socrata expects literal $where=, $limit=, etc.
  const queryParts = Object.entries(params).map(
    ([key, value]) => `${key}=${encodeURIComponent(value)}`
  );
  const separator = base.includes("?") ? "&" : "?";
  return queryParts.length > 0 ? `${base}${separator}${queryParts.join("&")}` : base;
}

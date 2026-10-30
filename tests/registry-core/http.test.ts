import { describe, it, expect, vi, afterEach } from "vitest";
import { Limiter, buildSoqlUrl, fetchWithRetry } from "../../packages/registry-core/src/util/http.js";

describe("Limiter", () => {
  it("runs tasks concurrently up to maxConcurrent", async () => {
    const limiter = new Limiter(2);
    const started: number[] = [];
    const tasks = [0, 1, 2, 3].map(i =>
      limiter.run(() => {
        started.push(i);
        return new Promise<number>(resolve => setTimeout(() => resolve(i), 20));
      })
    );
    // Tasks 0 and 1 start immediately; 2 and 3 wait
    await new Promise<void>(r => setTimeout(r, 5));
    expect(started).toContain(0);
    expect(started).toContain(1);
    const results = await Promise.all(tasks);
    expect(results).toEqual([0, 1, 2, 3]);
  });

  it("resolves all tasks sequentially when maxConcurrent=1", async () => {
    const limiter = new Limiter(1);
    const order: number[] = [];
    const tasks = [0, 1, 2].map(i =>
      limiter.run(async () => {
        order.push(i);
        return i;
      })
    );
    const results = await Promise.all(tasks);
    expect(results).toEqual([0, 1, 2]);
    expect(order).toEqual([0, 1, 2]);
  });

  it("handles a single task", async () => {
    const limiter = new Limiter(3);
    const result = await limiter.run(async () => 42);
    expect(result).toBe(42);
  });
});

describe("buildSoqlUrl", () => {
  it("builds a valid SoQL URL", () => {
    const url = buildSoqlUrl("https://data.colorado.gov/resource/4ykn-tg5h.json", {
      $where: "entitystatus='Good Standing'",
      $limit: "10",
    });
    expect(url).toContain("4ykn-tg5h.json");
    expect(url).toContain("$where=");
    expect(url).toContain("$limit=10");
  });

  it("URL-encodes special characters in params", () => {
    const url = buildSoqlUrl("https://data.colorado.gov/resource/4ykn-tg5h.json", {
      $where: "entitystatus='Good Standing' AND principalzipcode='80202'",
    });
    expect(url).toContain("$where=");
    // URL should be parseable
    expect(() => new URL(url)).not.toThrow();
  });

  it("handles multiple params", () => {
    const url = buildSoqlUrl("https://data.colorado.gov/resource/4ykn-tg5h.json", {
      $where: "entitystatus='Good Standing'",
      $limit: "1000",
      $offset: "0",
      $order: "entityid ASC",
    });
    expect(url).toContain("$limit=1000");
    expect(url).toContain("$offset=0");
    expect(url).toContain("$order=");
  });
});

describe("fetchWithRetry deadlines", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("rejects when an attempt exceeds timeoutMs", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      })
    ));
    const started = Date.now();
    await expect(fetchWithRetry("https://example.test/slow", { timeoutMs: 20, maxRetries: 0 })).rejects.toBeDefined();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("caps Retry-After at 30 s", async () => {
    vi.useFakeTimers();
    const fetchStub = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "3600" } }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchStub);
    let settled = false;
    const p = fetchWithRetry("https://example.test/limited", { maxRetries: 1 }).then(r => { settled = true; return r; });
    await vi.advanceTimersByTimeAsync(29_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    const resp = await p;
    expect(resp.status).toBe(200);
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it("retries a fetch that throws once, then gives up", async () => {
    vi.useFakeTimers();
    const fetchStub = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchStub);
    const p = fetchWithRetry("https://example.test/down");
    const assertion = expect(p).rejects.toThrow("fetch failed");
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it("returns the response when a thrown fetch succeeds on the retry", async () => {
    vi.useFakeTimers();
    const fetchStub = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchStub);
    const p = fetchWithRetry("https://example.test/flaky");
    await vi.advanceTimersByTimeAsync(60_000);
    const resp = await p;
    expect(resp.status).toBe(200);
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it("keeps the full retry budget for 503 responses", async () => {
    vi.useFakeTimers();
    const fetchStub = vi.fn().mockImplementation(() => Promise.resolve(new Response("", { status: 503 })));
    vi.stubGlobal("fetch", fetchStub);
    const p = fetchWithRetry("https://example.test/busy");
    await vi.advanceTimersByTimeAsync(120_000);
    const resp = await p;
    expect(resp.status).toBe(503);
    expect(fetchStub).toHaveBeenCalledTimes(5);
  });

  it("an aborted signal rejects without a call and without retries", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchStub);
    const ctl = new AbortController();
    ctl.abort();
    await expect(fetchWithRetry("https://example.test/x", { signal: ctl.signal })).rejects.toBeDefined();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("an abort during a request is not retried", async () => {
    const fetchStub = vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      }));
    vi.stubGlobal("fetch", fetchStub);
    const ctl = new AbortController();
    const p = fetchWithRetry("https://example.test/slow", { signal: ctl.signal });
    const assertion = expect(p).rejects.toBeDefined();
    ctl.abort();
    await assertion;
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("an abort during a backoff sleep ends the wait and the retries", async () => {
    vi.useFakeTimers();
    const fetchStub = vi.fn().mockImplementation(() => Promise.resolve(new Response("", { status: 503 })));
    vi.stubGlobal("fetch", fetchStub);
    const ctl = new AbortController();
    const p = fetchWithRetry("https://example.test/busy", { signal: ctl.signal });
    const assertion = expect(p).rejects.toBeDefined();
    await vi.advanceTimersByTimeAsync(10);   // first 503 seen, now sleeping
    ctl.abort();
    await assertion;
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect } from "vitest";
import { Limiter, buildSoqlUrl } from "../../packages/registry-core/src/util/http.js";

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

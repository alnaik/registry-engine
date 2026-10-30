import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Bulk files in a public repo are a harvest target (SECURITY.md Threat 5): no
// shard or fixture may carry a mailbox at a consumer provider. Business
// domains (a company's own site) are not personal and are not checked.
const ROOT = join(import.meta.dirname, "../..");
const PERSONAL = /[A-Za-z0-9._%+-]+@(?:[a-z0-9-]+\.)*(?:gmail|yahoo|aol|hotmail|outlook|msn|icloud|comcast|verizon|optonline|att|sbcglobal)(?:\.[a-z]{2,}|\s+(?:com|net)\b)/i;

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe("no personal emails in tracked data", () => {
  it("shards/ and tests/fixtures/ hold no address at a consumer mail provider", () => {
    const files = [...filesUnder(join(ROOT, "shards")), ...filesUnder(join(ROOT, "tests/fixtures"))];
    expect(files.length).toBeGreaterThan(0);
    const hits: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf-8").split("\n");
      lines.forEach((line, i) => {
        if (PERSONAL.test(line)) hits.push(`${relative(ROOT, file)}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});

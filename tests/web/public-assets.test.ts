import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Static guards on the shipped UI files: the CSP allows 'self' only, and data
// never goes through innerHTML (CLAUDE.md UI rule, SECURITY.md Threat 8).
const PUBLIC = join(import.meta.dirname, "../../apps/web/public");
const files = readdirSync(PUBLIC);

describe("web public assets", () => {
  it("no script uses innerHTML, outerHTML assignment, insertAdjacentHTML or document.write", () => {
    for (const f of files.filter(f => f.endsWith(".js"))) {
      const src = readFileSync(join(PUBLIC, f), "utf8");
      expect(src, f).not.toMatch(/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write/);
    }
  });

  it("HTML pages load only same-origin scripts and styles, with no inline script or style attribute", () => {
    for (const f of files.filter(f => f.endsWith(".html"))) {
      const html = readFileSync(join(PUBLIC, f), "utf8");
      expect(html, f).not.toMatch(/<script(?![^>]*\bsrc="\/)[^>]*>/);
      expect(html, f).not.toMatch(/\s(src|href)="https?:\/\//);
      expect(html, f).not.toMatch(/\sstyle="/);
      expect(html, f).not.toMatch(/<style/);
    }
  });
});

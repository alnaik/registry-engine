// Finds a Chromium for the browser scripts (a11y, smoke): $CHROME when set,
// else the newest chromium_headless_shell in the Playwright cache.
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HINT = "Set CHROME to a Chromium or Chrome executable, or run npx playwright install chromium-headless-shell.";

function playwrightCache(): string {
  if (process.platform === "darwin") return join(homedir(), "Library/Caches/ms-playwright");
  if (process.platform === "win32") return join(process.env["LOCALAPPDATA"] ?? join(homedir(), "AppData/Local"), "ms-playwright");
  return join(homedir(), ".cache/ms-playwright");
}

// Exits 1 with the hint when nothing is found.
export function findChromium(): string {
  const set = process.env["CHROME"];
  if (set !== undefined && set !== "") return set;
  const cache = playwrightCache();
  const exe = process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell";
  const builds = existsSync(cache)
    ? readdirSync(cache).flatMap(name => {
        const m = /^chromium_headless_shell-(\d+)$/.exec(name);
        return m ? [{ name, n: Number(m[1]) }] : [];
      }).sort((a, b) => b.n - a.n)
    : [];
  for (const b of builds) {
    // <build>/chrome-headless-shell-<platform>/chrome-headless-shell
    for (const sub of readdirSync(join(cache, b.name))) {
      const path = join(cache, b.name, sub, exe);
      if (existsSync(path)) return path;
    }
  }
  console.error(HINT);
  process.exit(1);
}

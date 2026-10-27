// Hermetic accessibility check: axe-core over the real web app pages, served
// by the real server with a fictional search outcome (no network, no AI).
//
//   npm run a11y                 # exits 1 on any serious or critical violation
//   CHROME=/path/to/chrome npm run a11y
//
// Pages: /design (component sheet), / after a Skip AI search with a row open
// and every group expanded, and the My calls tab with one logged call. Each
// at 390 and 1280 px, light and dark. Driven over the Chrome DevTools
// Protocol (headless Chromium, Node's built-in WebSocket).
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createApp } from "../../apps/web/src/server.js";
import { sheetSearch } from "../../tests/web/fixtures/sheet-outcome.js";

const CHROME = process.env["CHROME"]
  ?? join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const WIDTHS = [390, 1280];
const SCHEMES = ["light", "dark"] as const;
const BLOCKING = new Set(["serious", "critical"]);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ---- the app, with the fixture search ------------------------------------------------
const server = createServer();
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const appPort = (server.address() as AddressInfo).port;
server.on("request", createApp({
  search: sheetSearch,
  llmAvailable: async () => false,
  contactsProvider: () => null,
  port: appPort,
  publicDir: fileURLToPath(new URL("../../apps/web/public", import.meta.url)),
}));
const BASE = `http://localhost:${appPort}`;

// ---- headless Chromium over CDP ------------------------------------------------------
const profile = mkdtempSync(join(tmpdir(), "re-axe-"));
const debugPort = 9300 + Math.floor(Math.random() * 600);
const chrome = spawn(CHROME, [`--remote-debugging-port=${debugPort}`, "--no-first-run", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
chrome.on("error", err => { console.error(`Could not start Chromium (${CHROME}): ${err.message}. Set CHROME=…`); process.exit(2); });

let wsUrl = "";
for (let i = 0; i < 60 && !wsUrl; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json() as { type: string; webSocketDebuggerUrl: string }[];
    wsUrl = targets.find(t => t.type === "page")?.webSocketDebuggerUrl ?? "";
  } catch { /* not up yet */ }
  if (!wsUrl) await sleep(200);
}
if (!wsUrl) { console.error("Chromium did not expose a page target."); process.exit(2); }

const ws = new WebSocket(wsUrl);
await new Promise(resolve => ws.addEventListener("open", resolve));
let nextId = 0;
const pending = new Map<number, (m: { result?: unknown; error?: unknown }) => void>();
ws.addEventListener("message", ev => {
  const m = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: unknown };
  if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); }
});
function send(method: string, params: Record<string, unknown> = {}): Promise<{ result?: unknown; error?: unknown }> {
  return new Promise(resolve => { const id = ++nextId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
}
async function js<T = unknown>(expression: string): Promise<T> {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }) as
    { result?: { result?: { value?: T }; exceptionDetails?: unknown } };
  if (r.result?.exceptionDetails) throw new Error(`page error: ${JSON.stringify(r.result.exceptionDetails).slice(0, 400)}`);
  return r.result?.result?.value as T;
}
async function waitFor(expression: string, what: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (await js<boolean>(expression)) return;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}`);
}
async function go(url: string): Promise<void> {
  await send("Page.navigate", { url });
  await waitFor(`document.readyState === "complete"`, `${url} to load`);
  await sleep(150);
}

await send("Page.enable");
await send("Runtime.enable");

// ---- page states ---------------------------------------------------------------------
async function searchPage(): Promise<void> {
  await go(`${BASE}/`);
  await js(`localStorage.clear(), true`);
  await go(`${BASE}/`);
  await js(`(() => {
    document.getElementById("query").value = "Someone to sew 500 custom tote bags";
    document.getElementById("near").value = "Denver";
    document.getElementById("more-toggle").click();
    document.getElementById("no-llm").checked = true;
    document.getElementById("no-llm").dispatchEvent(new Event("change", { bubbles: true }));
    document.getElementById("naics").value = "314910, 315210";
    document.getElementById("go").click();
    return true; })()`);
  await waitFor(`!document.getElementById("results-area").hidden && !document.getElementById("go").disabled`, "search results");
  await js(`(() => {
    document.querySelector("#bands .lr-head").click();
    for (const d of document.querySelectorAll("#groups details, #about")) d.open = true;
    return true; })()`);
  await sleep(100);
}

async function callsPage(): Promise<void> {
  await searchPage();
  await js(`(() => {
    const reached = [...document.querySelectorAll(".lead-row.open .call-box button")].find(b => b.textContent === "Reached");
    reached.click();
    document.getElementById("tab-calls").click();
    return true; })()`);
  await waitFor(`!document.getElementById("panel-calls").hidden`, "My calls");
}

const PAGES: { name: string; open: () => Promise<void> }[] = [
  { name: "/design", open: () => go(`${BASE}/design`) },
  { name: "/ search (Skip AI)", open: searchPage },
  { name: "/ My calls", open: callsPage },
];

// ---- run -----------------------------------------------------------------------------
interface AxeNode { target: string[]; failureSummary?: string }
interface AxeViolation { id: string; impact: string | null; help: string; nodes: AxeNode[] }

let blocking = 0;
let minor = 0;
try {
  for (const width of WIDTHS) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    for (const scheme of SCHEMES) {
      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
      for (const page of PAGES) {
        await page.open();
        await js(`${AXE_SOURCE}\n;true`);   // DevTools evaluation, so the page CSP still applies to the page itself
        const violations = await js<AxeViolation[]>(`axe.run(document, { resultTypes: ["violations"] })
          .then(r => r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help,
            nodes: v.nodes.map(n => ({ target: n.target, failureSummary: n.failureSummary })) })))`);
        const label = `${page.name} @ ${width}px ${scheme}`;
        if (violations.length === 0) { console.log(`ok    ${label}`); continue; }
        for (const v of violations) {
          const isBlocking = BLOCKING.has(v.impact ?? "");
          if (isBlocking) blocking++; else minor++;
          console.log(`${isBlocking ? "FAIL " : "note "} ${label}: [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length})`);
          for (const n of v.nodes.slice(0, 4)) console.log(`        ${n.target.join(" ")}`);
        }
      }
    }
  }
} finally {
  ws.close();
  chrome.kill();
  server.close();
  rmSync(profile, { recursive: true, force: true });
}
console.log(`\n${blocking} serious/critical, ${minor} moderate/minor violation(s).`);
process.exit(blocking > 0 ? 1 : 0);

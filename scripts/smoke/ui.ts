// Hermetic UI smoke run: the real web app, served by the real server with a
// fictional search outcome (no network, no AI), driven in headless Chromium.
//
//   npm run smoke                 # exits 1 at the first failing step
//   CHROME=/path/to/chrome npm run smoke
//
// Steps: the empty page renders; a search streams and shows result rows; the
// CSV link returns text/csv; the history list shows the search; a server error
// shows the error box. Same harness as scripts/a11y/axe.ts (Chrome DevTools
// Protocol, Node's built-in WebSocket).
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../../apps/web/src/server.js";
import type { search } from "../../packages/qualify/src/index.js";
import { sheetSearch } from "../../tests/web/fixtures/sheet-outcome.js";
import { findChromium } from "../lib/chromium.js";

const CHROME = findChromium();
const QUERY = "Someone to sew 500 custom tote bags";
const FORCE_ERROR = "smoke forced error";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ---- the app: the fixture search, except one query that throws ------------------------
const failing = (async (query: string, cfg?: Parameters<typeof search>[1]) => {
  if (query === FORCE_ERROR) throw new Error("Forced smoke error");
  return sheetSearch(query, cfg);
}) as typeof search;

// The server logs the forced error; keep that expected line out of the output.
const logError = console.error.bind(console);
console.error = (...args: unknown[]) => { if (!args.some(a => String(a).includes("Forced smoke error"))) logError(...args); };

const server = createServer();
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const appPort = (server.address() as AddressInfo).port;
const historyDir = mkdtempSync(join(tmpdir(), "re-smoke-history-"));
server.on("request", createApp({
  search: failing,
  llm: async () => null,
  contactsProvider: () => null,
  port: appPort,
  publicDir: fileURLToPath(new URL("../../apps/web/public", import.meta.url)),
  historyDir,
}));
const BASE = `http://localhost:${appPort}`;

// ---- headless Chromium over CDP ------------------------------------------------------
const profile = mkdtempSync(join(tmpdir(), "re-smoke-"));
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
const pageErrors: string[] = [];
ws.addEventListener("message", ev => {
  const m = JSON.parse(String(ev.data)) as { id?: number; method?: string; params?: { exceptionDetails?: { text?: string; exception?: { description?: string } } }; result?: unknown; error?: unknown };
  if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params?.exceptionDetails;
    pageErrors.push(d?.exception?.description ?? d?.text ?? "unknown page error");
  }
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
function expect(ok: boolean, what: string): void {
  if (!ok) throw new Error(what);
}

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

// ---- steps ---------------------------------------------------------------------------
// Fills the form and clicks Find businesses, then waits for the run to finish.
async function runSearch(query: string, done: string): Promise<void> {
  await js(`(() => {
    document.getElementById("query").value = ${JSON.stringify(query)};
    document.getElementById("near").value = "Denver";
    document.getElementById("more-toggle").click();
    document.getElementById("no-llm").checked = true;
    document.getElementById("no-llm").dispatchEvent(new Event("change", { bubbles: true }));
    document.getElementById("naics").value = "314910, 315210";
    document.getElementById("go").click();
    return true; })()`);
  await waitFor(`${done} && !document.getElementById("go").disabled`, "the search to finish");
}

const STEPS: { name: string; run: () => Promise<void> }[] = [
  {
    name: "the empty page renders",
    run: async () => {
      await go(`${BASE}/`);
      await js(`localStorage.clear(), true`);
      await go(`${BASE}/`);
      expect(await js<string>(`document.title`) === "Registry Engine", "page title is not Registry Engine");
      expect(await js<boolean>(`Boolean(document.getElementById("query")) && Boolean(document.getElementById("go"))`), "the ask form is missing");
      expect(await js<boolean>(`document.getElementById("results-area").hidden`), "results show before any search");
    },
  },
  {
    name: "a search streams and shows result rows",
    run: async () => {
      await runSearch(QUERY, `!document.getElementById("results-area").hidden`);
      const rows = await js<number>(`document.querySelectorAll("#bands .lead-row").length`);
      expect(rows >= 8, `expected at least 8 result rows, saw ${rows}`);
      const sum = await js<string>(`document.getElementById("sum").textContent`);
      expect(/businesses/.test(sum), `the summary sentence is missing: "${sum}"`);
    },
  },
  {
    name: "the CSV link returns text/csv",
    run: async () => {
      const r = await js<{ status: number; type: string; lines: number }>(`fetch(document.getElementById("csv").href).then(async r =>
        ({ status: r.status, type: r.headers.get("content-type") || "", lines: (await r.text()).trim().split("\\n").length }))`);
      expect(r.status === 200, `CSV status ${r.status}`);
      expect(r.type.startsWith("text/csv"), `CSV content-type "${r.type}"`);
      expect(r.lines > 1, "the CSV has no rows");
    },
  },
  {
    name: "the history list shows the search",
    run: async () => {
      await go(`${BASE}/`);
      await waitFor(`!document.getElementById("recent").hidden`, "Recent searches to appear");
      const items = await js<string[]>(`[...document.querySelectorAll("#recent-list .saved-item strong")].map(e => e.textContent)`);
      expect(items.includes(QUERY), `Recent searches lists ${JSON.stringify(items)}`);
    },
  },
  {
    name: "a server error shows the error box",
    run: async () => {
      await go(`${BASE}/`);
      await runSearch(FORCE_ERROR, `!document.getElementById("error-box").hidden`);
      const text = await js<string>(`document.getElementById("error-text").textContent`);
      expect(text.includes("Forced smoke error"), `error box says "${text}"`);
    },
  },
];

// ---- run -----------------------------------------------------------------------------
let failed: string | null = null;
try {
  for (const step of STEPS) {
    try {
      await step.run();
      expect(pageErrors.length === 0, `page threw: ${pageErrors[0]}`);
      console.log(`ok    ${step.name}`);
    } catch (err) {
      failed = step.name;
      console.log(`FAIL  ${step.name}: ${err instanceof Error ? err.message : String(err)}`);
      break;
    }
  }
} finally {
  ws.close();
  chrome.kill();
  server.close();
  rmSync(profile, { recursive: true, force: true });
  rmSync(historyDir, { recursive: true, force: true });
}
console.log(failed === null ? `\n${STEPS.length} steps passed.` : `\nSmoke run failed at: ${failed}`);
process.exit(failed === null ? 0 : 1);

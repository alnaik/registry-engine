// Drive headless Chromium over CDP: load the app, optionally run a search,
// and save screenshots. Usage: APP_URL=http://localhost:4317/ node shoot.mjs <outDir> <width> <query|-> [near] [codes]
// Passing codes also ticks "Skip AI". Selectors are loose; adjust them if the UI changes.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const [outDir, widthArg, query, near, codes] = process.argv.slice(2);
const APP = process.env.APP_URL ?? "http://localhost:4317/";
const width = Number(widthArg);
const BIN = `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(BIN, [`--remote-debugging-port=${port}`, "--no-first-run", `--user-data-dir=${outDir}/profile-${port}`, "about:blank"], { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch {}
  await sleep(200);
}
const page = targets.find(t => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener("open", r));
let id = 0; const pending = new Map();
ws.addEventListener("message", ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async expr => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async (name, full = true) => {
  const m = await send("Page.getLayoutMetrics");
  const h = full ? Math.min(Math.ceil(m.result.cssContentSize.height), 12000) : 900;
  await send("Emulation.setDeviceMetricsOverride", { width, height: h, deviceScaleFactor: 1, mobile: width < 600 });
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  writeFileSync(`${outDir}/${name}-${width}.png`, Buffer.from(r.result.data, "base64"));
};

await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
await send("Page.navigate", { url: APP });
await sleep(1500);
await shot("empty", false);
if (query && query !== "-") {
  await evalJs(`(() => {
    const inputs = [...document.querySelectorAll("input")];
    const q = inputs.find(i => /need|sell/i.test(i.getAttribute("aria-label") || "") || /tote/i.test(i.placeholder || "")) || inputs[0];
    q.value = ${JSON.stringify(query)}; q.dispatchEvent(new Event("input", { bubbles: true }));
    const loc = inputs.find(i => /ZIP/i.test(i.placeholder || ""));
    if (loc) { loc.value = ${JSON.stringify(near ?? "")}; loc.dispatchEvent(new Event("input", { bubbles: true })); }
    ${codes ? `const c = inputs.find(i => /code/i.test((i.id||"") + (i.name||"") + (i.placeholder||""))); if (c) { c.value = ${JSON.stringify(codes)}; c.dispatchEvent(new Event("input", { bubbles: true })); }
    const skip = [...document.querySelectorAll("input[type=checkbox]")].find(i => /ai/i.test(i.closest("label")?.textContent || "")); if (skip) skip.checked = true;` : ""}
    const btn = [...document.querySelectorAll("button")].find(b => /find businesses/i.test(b.textContent));
    btn.click(); return true;
  })()`);
  await sleep(4000);
  await shot("progress", false);
  for (let i = 0; i < 150; i++) {
    const done = await evalJs(`!![...document.querySelectorAll("button")].find(b => /find businesses/i.test(b.textContent) && !b.disabled) && document.body.innerText.includes("mi")`);
    if (done) break;
    await sleep(2000);
  }
  await sleep(1000);
  await shot("results", true);
  await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
  for (const [i, sel] of [[1, "h2, .band, [class*=band]"], [2, "article, .card, [class*=card]"]].entries()) {
    await evalJs(`(() => { const el = document.querySelectorAll(${JSON.stringify("x")}.length ? ${JSON.stringify(sel)} : "body")[${i === 0 ? 0 : 1}]; if (el) el.scrollIntoView(); window.scrollBy(0, -80); return true; })()`);
    await sleep(300);
    const r = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${outDir}/view${i}-${width}.png`, Buffer.from(r.result.data, "base64"));
  }
  writeFileSync(`${outDir}/results-${width}.txt`, String(await evalJs("document.body.innerText")));
}
ws.close(); chrome.kill();
process.exit(0);

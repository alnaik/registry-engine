// Capture README media from the running web app over the Chrome DevTools
// Protocol (headless Chromium, Node's built-in WebSocket, nothing to install).
//
//   PORT=4318 npm start &              # the app, with Claude Code logged in
//   node scripts/docs/capture.mjs http://localhost:4318/ docs/media <framesDir>
//   python3 -I scripts/docs/apng.py docs/media/search.png <framesDir>/frames.json
//
// One real search runs (2 AI calls). Individuals' records (sole proprietors
// in PPP) are hidden before any capture, and agent/principal names are
// withheld, so no person's name lands in docs.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const [APP = "http://localhost:4318/", OUT = "docs/media", FRAMES = "/tmp/re-frames"] = process.argv.slice(2);
const QUERY = "Someone to sew 500 custom tote bags";
const NEAR = "Denver";
const W = 1000, H = 640;
const CHROME = process.env.CHROME ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell`;

mkdirSync(OUT, { recursive: true });
mkdirSync(FRAMES, { recursive: true });
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, [`--remote-debugging-port=${port}`, "--no-first-run", `--user-data-dir=${FRAMES}/profile`, "about:blank"], { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets = [];
for (let i = 0; i < 50 && targets.length === 0; i++) {
  try { targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter(t => t.type === "page"); } catch { /* not up yet */ }
  await sleep(200);
}
const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener("open", r));
let nextId = 0;
const pending = new Map();
ws.addEventListener("message", ev => {
  const m = JSON.parse(ev.data);
  if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise(r => { const id = ++nextId; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const js = async expr => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const viewport = (w, h) => send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });

const frames = [];
async function frame(ms) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  const file = `${FRAMES}/f${String(frames.length).padStart(3, "0")}.png`;
  writeFileSync(file, Buffer.from(r.result.data, "base64"));
  frames.push({ file, ms });
}
async function element(selector, file, pad = 12, until = null) {
  const rect = await js(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null;
    const r = e.getBoundingClientRect(); const box = { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
    const u = ${JSON.stringify(until)} && document.querySelector(${JSON.stringify(until)});
    if (u) { const b = u.getBoundingClientRect(); box.h = b.bottom + scrollY - box.y; }
    return box; })()`);
  if (rect === null) throw new Error(`not found: ${selector}`);
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true,
    clip: { x: rect.x - pad, y: rect.y - pad, width: rect.w + 2 * pad, height: rect.h + 2 * pad, scale: 1 } });
  writeFileSync(`${OUT}/${file}`, Buffer.from(r.result.data, "base64"));
  console.log(`${OUT}/${file}`);
}

await send("Page.enable");
await viewport(W, H);
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
await send("Page.navigate", { url: APP });
await sleep(1500);
await js("localStorage.clear(), true");
await frame(1200);

// Type the request and the location like a person would.
for (let i = 1; i <= QUERY.length; i++) {
  await js(`document.getElementById("query").value = ${JSON.stringify(QUERY.slice(0, i))}`);
  if (i % 3 === 0 || i === QUERY.length) await frame(90);
}
for (let i = 1; i <= NEAR.length; i++) {
  await js(`document.getElementById("near").value = ${JSON.stringify(NEAR.slice(0, i))}`);
  await frame(90);
}
await frame(700);
await element(".ask", "search-form.png");
// SKIP_AI=1 dry-runs the script without spending AI calls (static codes).
if (process.env.SKIP_AI === "1") await js(`document.getElementById("no-llm").checked = true; document.getElementById("naics").value = "314910, 315210"; true`);

// Run it. A frame is kept only when the visible progress text changes, so
// the animation skips the waiting.
await js(`document.getElementById("go").click(), true`);
let progressShot = false;
let lastText = "";
for (let t = 0; t < 800; t++) {
  await sleep(400);
  const s = await js(`({ done: !document.getElementById("go").disabled,
    records: /Searching public records/.test(document.getElementById("steps").innerText) && /: \\d/.test(document.getElementById("steps").innerText),
    text: document.getElementById("reading").innerText })`);
  if (s.done) break;
  if (s.text !== lastText) {
    lastText = s.text;
    await frame(900);
  }
  if (s.records && !progressShot) {
    await element("#reading", "progress.png");
    progressShot = true;
  }
}
await sleep(800);

// Privacy: drop the individuals' records group, and withhold agent/principal
// names (registered agents and principals are often people).
const hidden = await js(`(() => {
  let n = 0;
  for (const g of document.querySelectorAll("#groups details.group")) {
    if (g.querySelector("summary").innerText.startsWith("INDIVIDUALS") || g.querySelector("summary").innerText.startsWith("Individuals")) { g.remove(); n++; }
  }
  for (const b of document.querySelectorAll(".lr-reach b")) if (/agent.principal/.test(b.parentElement.textContent)) b.textContent = "(name withheld in this screenshot)";
  return n; })()`);
console.log(`removed ${hidden} individuals' group(s)`);
const withhold = `for (const dt of document.querySelectorAll(".reach-dl dt")) if (dt.textContent === "Agent/principals") dt.nextElementSibling.textContent = "(name withheld in this screenshot)"; true`;

await js("window.scrollTo(0, 0)");
await element("#results-area", "summary.png", 12, "#bands .band .lead-row:nth-of-type(4)");

// Open the first row, as a person would.
await js(`document.querySelector("#bands .lr-head").click(), true`);
await js(withhold);
await js("window.scrollTo(0, 0)");
await frame(600);
const stops = await js(`["#reading", "#sum", ".lead-row.open"].map(s => { const e = document.querySelector(s); return e ? Math.max(0, e.getBoundingClientRect().top + scrollY - 16) : null; }).filter(v => v !== null)`);
let y = 0;
for (const target of stops) {
  while (y < target) {
    y = Math.min(target, y + 120);
    await js(`window.scrollTo(0, ${y})`);
    await frame(60);
  }
  await frame(1600);
}
writeFileSync(`${FRAMES}/frames.json`, JSON.stringify(frames));
console.log(`${frames.length} frames in ${FRAMES}`);

// Static shots of the results.
await js("window.scrollTo(0, 0)");
console.log("About:", await js(`[...document.querySelectorAll("#about-rows tr")].map(r => [...r.children].map(c => c.textContent).join(": ")).join(" | ")`));
await element(".lead-row.open", "lead-card.png");
const recent = await js(`(() => { const g = [...document.querySelectorAll("#groups details.group")].find(d => /registered in the last/i.test(d.querySelector("summary").innerText));
  if (!g) return false; g.open = true; g.id = "recent-group"; [...g.querySelectorAll(".lead-row")].slice(6).forEach(r => r.remove()); return true; })()`);
if (recent) await element("#recent-group", "recently-registered.png");

ws.close();
chrome.kill();
process.exit(0);

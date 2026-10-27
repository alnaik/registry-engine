// Capture README media from the running web app over the Chrome DevTools
// Protocol (headless Chromium, Node's built-in WebSocket, nothing to install).
//
//   PORT=4318 npm start &              # the app, with Claude Code logged in
//   node scripts/docs/capture.mjs http://localhost:4318/ docs/media <framesDir>
//   python3 -I scripts/docs/apng.py docs/media/search.png <framesDir>/frames.json
//
// One real search runs (2 AI calls). Individuals' records (sole proprietors
// in PPP) are hidden before any capture, so no person's name lands in docs.
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
async function element(selector, file, pad = 12) {
  const rect = await js(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null;
    const r = e.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; })()`);
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
await element(".search-card", "search-form.png");

// Run it. A frame is kept only when the visible progress text changes, so
// the animation skips the waiting.
await js(`document.getElementById("go").click(), true`);
let progressShot = false;
let lastText = "";
for (let t = 0; t < 800; t++) {
  await sleep(400);
  const s = await js(`({ done: !document.getElementById("go").disabled, ranking: document.getElementById("steps").innerText.includes("businesses to rank"),
    text: document.getElementById("interp").innerText + document.getElementById("progress").innerText })`);
  if (s.done) break;
  if (s.text !== lastText) {
    lastText = s.text;
    await frame(900);
  }
  if (s.ranking && !progressShot) {
    await element("#progress", "progress.png");
    progressShot = true;
  }
}
await sleep(800);

// Privacy: hide individuals' records and their map dots before capturing results.
const hiddenCount = await js(`(() => {
  const names = [];
  for (const el of document.querySelectorAll("article.lead, .row")) {
    if (!el.innerText.includes("Individual's record")) continue;
    el.hidden = true;
    const n = el.querySelector("h3, .row-name");
    if (n) names.push(n.innerText);
  }
  // Registered agents and principals are often people: keep their names out of the docs.
  for (const o of document.querySelectorAll(".officers")) o.textContent = "Agent/principals: (name withheld in this screenshot)";
  for (const d of document.querySelectorAll("#distmap-plot .lead-dot")) {
    const t = d.querySelector("title");
    if (t && names.some(n => t.textContent.startsWith(n + " · "))) d.remove();
  }
  return names.length; })()`);
console.log(`hid ${hiddenCount} individual record(s)`);

await js("window.scrollTo(0, 0)");
await frame(600);
const stops = await js(`["#interp", "#summary", "#distmap", "article.lead"].map(s => { const e = document.querySelector(s); return e ? Math.max(0, e.getBoundingClientRect().top + scrollY - 16) : null; }).filter(v => v !== null)`);
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
await element("#summary", "summary.png");
console.log("AI usage:", await js(`[...document.querySelectorAll("#summary [title]")].map(e => e.innerText.replace(/\\s+/g, " ") + " | " + e.title).join("; ")`));
await element("article.lead:not([hidden])", "lead-card.png");
await js(`[...document.querySelectorAll("#recent-rows .row")].slice(6).forEach(r => { r.hidden = true; }), true`);
await element("#recent", "recently-registered.png");

// The distance map, exported as a standalone SVG that follows the reader's theme.
const colors = async () => js(`(() => {
  const css = (sel, ...props) => { const e = document.querySelector(sel); const s = getComputedStyle(e); return Object.fromEntries(props.map(p => [p, s.getPropertyValue(p)])); };
  return { ring: css("#distmap-plot .ring", "stroke"), label: css("#distmap-plot .ring-label", "fill"), origin: css("#distmap-plot .origin-dot", "fill"),
           coded: css("#distmap-plot .lead-dot.coded", "fill", "stroke"),
           nameOnly: document.querySelector("#distmap-plot .lead-dot.name-only") ? css("#distmap-plot .lead-dot.name-only", "fill", "stroke") : null }; })()`);
const light = await colors();
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
const dark = await colors();
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
const svg = await js(`(() => {
  const clone = document.querySelector("#distmap-plot svg").cloneNode(true);
  for (const t of clone.querySelectorAll("title")) t.remove();     // no business or person names in the file
  clone.removeAttribute("width");
  const n = clone.querySelectorAll(".lead-dot").length;
  clone.setAttribute("aria-label", clone.getAttribute("aria-label").replace(/^Map of \\d+ businesses/, "Map of " + n + " businesses").replace(/ The list below has the same results\\.$/, ""));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return { markup: clone.outerHTML, dots: clone.querySelectorAll(".lead-dot").length };
})()`);
const rules = c => `.ring{fill:none;stroke:${c.ring.stroke};stroke-width:.6}.ring-label{fill:${c.label.fill};font:6px system-ui,-apple-system,sans-serif;text-anchor:middle}.origin-dot{fill:${c.origin.fill}}.lead-dot{stroke-width:.6}.lead-dot.coded{fill:${c.coded.fill};stroke:${c.coded.stroke}}${c.nameOnly ? `.lead-dot.name-only{fill:${c.nameOnly.fill};stroke:${c.nameOnly.stroke}}` : ""}`;
const style = `<style>${rules(light)}@media (prefers-color-scheme: dark){${rules(dark)}}</style>`;
writeFileSync(`${OUT}/distance-map.svg`, svg.markup.replace(/^<svg([^>]*)>/, `<svg$1 width="420" height="420">${style}`) + "\n");
console.log(`${OUT}/distance-map.svg (${svg.dots} dots)`);

ws.close();
chrome.kill();
process.exit(0);

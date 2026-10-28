import { createServer } from "node:http";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { join } from "node:path";
import { search, providerFromEnv } from "@registry-engine/qualify";
import { createApp } from "./server.js";

// Local web app: `npm start`, then open http://localhost:4317. Listens on
// loopback only — it can spend LLM and contact-API credits, so it must never
// be reachable from the network.

const port = Number(process.env["PORT"]) || 4317;
const publicDir = fileURLToPath(new URL("../public", import.meta.url));

function llmAvailable(): Promise<boolean> {
  return new Promise(resolve => {
    execFile("claude", ["--version"], { timeout: 5000 }, err => resolve(err === null));
  });
}

const app = createApp({
  search,
  llmAvailable,
  contactsProvider: () => providerFromEnv()?.name ?? null,
  port,
  publicDir,
  // Finished searches, next to the contacts cache.
  historyDir: join(homedir(), ".cache", "registry-engine", "searches"),
});

const server = createServer(app);
server.on("error", err => {
  console.error(`Could not start on port ${port}: ${err.message}`);
  process.exit(1);
});
server.listen(port, "127.0.0.1", () => {
  const url = `http://localhost:${port}`;
  console.log(`Registry Engine running at ${url}`);
  if (process.argv.includes("--open")) {
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    try {
      const child = process.platform === "win32"
        ? spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true })
        : spawn(cmd, [url], { stdio: "ignore", detached: true });
      child.on("error", () => { /* no browser available: the URL is printed above */ });
      child.unref();
    } catch {
      // ignore: the URL is printed above
    }
  }
});

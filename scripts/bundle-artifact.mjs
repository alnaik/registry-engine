import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_FILE = join(ROOT, "dist", "artifact.jsx");

const BANNED = [
  "localStorage",
  "sessionStorage",
  "process.env",
  "require(",
  "__dirname",
  "__filename",
];

async function main() {
  mkdirSync(join(ROOT, "dist"), { recursive: true });

  console.log("Bundling artifact...");

  const result = await esbuild.build({
    entryPoints: [join(ROOT, "apps/artifact/src/App.jsx")],
    bundle: true,
    format: "esm",
    platform: "browser",
    external: ["react", "react-dom"],
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
    outfile: OUT_FILE,
    loader: {
      ".ts": "ts",
      ".tsx": "tsx",
      ".jsx": "jsx",
      ".json": "json",
    },
    resolveExtensions: [".tsx", ".ts", ".jsx", ".js", ".json"],
    logLevel: "info",
    metafile: false,
  });

  if (result.errors.length > 0) {
    console.error("Build errors:", result.errors);
    process.exit(1);
  }

  // Check for banned imports
  const output = readFileSync(OUT_FILE, "utf-8");
  const violations = [];
  for (const banned of BANNED) {
    const idx = output.indexOf(banned);
    if (idx !== -1) {
      const line = output.slice(0, idx).split("\n").length;
      violations.push(`  BANNED: "${banned}" found at line ${line}`);
    }
  }

  if (violations.length > 0) {
    console.error("Bundle contains banned imports:");
    violations.forEach(v => console.error(v));
    process.exit(1);
  }

  const sizeKb = Math.round(output.length / 1024);
  const MAX_KB = 100;
  if (sizeKb >= MAX_KB) {
    console.error(`Bundle is ${sizeKb}kb — hard limit is <${MAX_KB}kb. Trim configs/tables.`);
    process.exit(1);
  }
  console.log(`Bundle written to dist/artifact.jsx (${sizeKb}kb, limit <${MAX_KB}kb)`);
  console.log("No banned imports found");
  console.log("\nPaste dist/artifact.jsx into claude.ai to run.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

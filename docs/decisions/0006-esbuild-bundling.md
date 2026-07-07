# ADR 0006 — esbuild for Artifact Bundling with Banned-Import Checks

**Status:** Accepted

## Context

The primary deployment target is a Claude Artifact: a single .jsx file pasted into `claude.ai`. Constraints: no imports (all code must be inlined), no Node builtins, no `localStorage`/`sessionStorage` (the artifact platform provides `window.storage` instead), no `process.env`.

The monorepo has multiple packages that need to be tree-shaken into one file. The bundle script must FAIL if banned APIs slip through — not just warn.

## Options Considered

1. **esbuild** — extremely fast (< 1s for this codebase), tree-shaking, ESM output, easily scriptable in `bundle-artifact.mjs`.
2. **webpack** — more configurable, but much slower and heavier.
3. **Rollup** — good tree-shaking, but slower than esbuild for this use case.
4. **Vite** — wraps Rollup; adds dev-server features not needed here.

## Decision

esbuild (option 1). The bundle script (`scripts/bundle-artifact.mjs`) does three things:
1. Calls esbuild with `bundle: true`, `format: "esm"`, entry point `apps/artifact/src/App.jsx`.
2. Scans the output text for banned strings: `localStorage`, `sessionStorage`, `process.env`, `require(`, `import(` (dynamic imports), `__dirname`, `__filename`.
3. Exits with code 1 if any banned string is found, printing the offending lines.

## Consequences

- Build is fast enough to run on every save during development.
- Banned-import check is a simple string scan, not an AST analysis. It has false positives (a string literal `"localStorage"` in a comment would trigger it). This is intentional: err on the side of caution for security reasons.
- The `.jsx` output file is human-readable (esbuild's default is unminified) — useful for debugging what got bundled.

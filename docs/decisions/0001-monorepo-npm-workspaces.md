# ADR 0001 — Monorepo with npm Workspaces

**Status:** Accepted

## Context

The product has three distinct deployment targets: a Claude Artifact (browser, single .jsx file), a Node CLI (dev harness and future digest backend), and potentially a future hosted service. The data library (`registry-core`) will be open-sourced separately from the LLM pipeline (`qualify`). These need to share types and utilities without copy-pasting.

## Options Considered

1. **npm workspaces monorepo** — built into npm, no extra tooling, packages share a root `node_modules`.
2. **Turborepo or Nx** — adds a build orchestration layer on top of workspaces; useful for large teams and caching CI builds.
3. **Single flat package** — simpler, but makes the MIT/proprietary boundary impossible to enforce cleanly; bundler would need manual exclusions.

## Decision

npm workspaces (option 1). The project is small enough that Turborepo's build graph caching is not worth the complexity. The workspace structure enforces package boundaries without tooling overhead: `registry-core` never imports from `qualify`; the artifact imports both.

## Consequences

- `npm install` at the root hoists shared deps; each package can declare its own devDeps.
- TypeScript `paths` or package `exports` resolve cross-package imports.
- A future move to Turborepo is non-breaking — just add `turbo.json`.
- The license boundary is structural: `packages/registry-core/package.json` declares `"license": "MIT"`; `qualify` and `artifact` are `"private": true` with no license field.

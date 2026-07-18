# 0012 — remove the artifact app

Status: accepted
Date: 2026-07-18

## Context

ADR 0011 found that `dist/artifact.jsx` pasted directly into a claude.ai
chat message runs inside a sandbox that blocks all outbound `fetch`/XHR to
external hosts. `route()`/`fetch()`/`probe()` — the live-registry half of
the pipeline — cannot work there; only the LLM verbs (`map()`/`brief()`,
via `window.claude.complete`) survive the sandbox. That ADR was parked
without a code change, pending a follow-up decision on delivery model. The
artifact, as shipped, is a dead end for its core purpose: a search tool
that can't reach the registries it searches.

## Decision

Remove `apps/artifact/` entirely, along with everything that exists only to
support it:

- `apps/artifact/` (package.json, `src/App.jsx`)
- `scripts/bundle-artifact.mjs`, the esbuild bundler script
- the root `bundle` npm script
- the `esbuild` devDependency (its only consumers were the bundler and the
  artifact package)
- the `window.claude` LLM backend fallback in
  `packages/qualify/src/llm/adapter.ts` (`windowClaudeBackend()`) — with no
  artifact runtime, there is no environment left that provides
  `window.claude.complete`

Git history retains all removed code; nothing here is unrecoverable.

## Consequences

The CLI (`apps/cli/`) is now the sole delivery surface: it already runs the
full pipeline against live registries, via either an Anthropic API key or a
headless `claude -p` backend, with no sandbox restrictions.

A standalone search page (ADR 0011's option 1, an unsandboxed local page)
remains possible later, but it would need a real hosted API for the search
agent to call rather than a `window.claude` bridge — that work is
deliberately deferred, not ruled out.

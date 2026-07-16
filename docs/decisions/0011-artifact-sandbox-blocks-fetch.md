# 0011 — claude.ai artifact sandbox blocks all live registry fetches

Status: open — documented, not yet resolved
Date: 2026-07-16

## Finding

Pasting `dist/artifact.jsx` into a claude.ai chat and running it as a React
artifact produces "Failed to fetch" for **every** `fetch()` call to an
external host — `data.colorado.gov` (co_sos), the gist-hosted PACA shard, and
Cloudflare DoH all failed identically. Screenshot: query "tomato suppliers
in denver" → `map()` resolved correctly (produce/wholesale/agriculture,
Denver, buy, 1/2 LLM calls, caveats rendered) → `route()` picked co_sos +
paca correctly → both `fetch()` calls failed → zero leads.

This is not a CORS or data problem — both endpoints were independently
verified to send `Access-Control-Allow-Origin: *` and return valid JSON (see
ADR 0010's PACA probe and the live CLI runs in this branch's history).
"Failed to fetch" is the browser reporting a request that never left the
sandbox.

**Root cause:** claude.ai wraps pasted/rendered artifacts in a strict CSP
that blocks all outbound `fetch`/`XHR`/`WebSocket` to external hosts, with a
single whitelisted exception (`cdnjs.cloudflare.com`, irrelevant here). This
is a deliberate security boundary — an artifact can't exfiltrate data or
stage requests from inside an authenticated browser session — not a bug or
a misconfiguration on our side.

Sources: [Claude Artifacts 2026 — What It Can Build (And Where It Breaks)](https://p0stman.com/guides/claude-artifacts-limitations),
[Claude AI Artifacts Not Working — 2026 Solutions](https://devradar.dev/guides/claude-ai-artifacts-not-working)

## What still works inside the sandbox

`window.claude.complete` is a bridged API, not a network fetch, so it is
**not** blocked. Confirmed by the same screenshot: `map()`'s LLM fallback
ran (1/2 LLM calls, correct JSON parse, caveats rendered), meaning the
`createLlm()` adapter's `windowClaudeBackend()` path works exactly as
designed. Only the registry-core `Driver.fetch()` calls (`route()` → socrata
/ static_shard) and `probe()`'s DNS-over-HTTPS calls are affected.

## Impact

The v3 spec's goal — "Zero cost to operator — runs as a Claude Artifact
using your own Claude subscription" — does not hold for the live-registry
half of the pipeline when the artifact is *pasted directly into a claude.ai
chat message*. `map()` and `brief()` (the two LLM verbs) are fine anywhere.
`route()`/`fetch()`/`probe()` need a JS runtime with unrestricted network
access — which the CLI already has (validated repeatedly this session
against the real APIs) — but a chat-pasted artifact does not.

## Options considered

1. **Run the artifact as a local page, not pasted into chat.** Serve
   `apps/artifact/src/App.jsx` from a plain local dev server (e.g. a small
   Vite/esbuild-serve setup) and open it in an ordinary browser tab. No CSP
   sandbox applies there, so every line of the existing engine — drivers,
   probe, merge — runs completely unmodified. Keeps the live "type a query,
   get ranked leads" UX; costs a small `npm run dev`-style script and loses
   the "just paste into claude.ai, no local setup" distribution story.

2. **CLI-first, one-shot report artifact.** Keep the Node CLI as the real
   search engine (already works end-to-end, no sandbox). For a given
   result set, render a static HTML report and publish *that* as a
   claude.ai Artifact for viewing/sharing — no live search box inside
   claude.ai, just a snapshot of results the CLI already fetched. Loses the
   interactive query box inside chat; keeps "zero cost, your subscription"
   for the LLM portion and makes registry fetching an explicit CLI step.

3. **(Not recommended) A hosted proxy.** Stand up a small backend that
   proxies registry calls, and have the artifact fetch that instead of the
   registries directly. Doesn't actually solve anything — the CSP blocks
   fetch to *any* non-whitelisted host, including a proxy you control — so
   this only works if the proxy is deployed behind `cdnjs.cloudflare.com`
   itself, which isn't a real option. Ruled out; listed only so it isn't
   re-discovered later.

## Recommendation

Option 1 (local page) preserves the most work as-is and keeps the product's
actual UX (live query box, streaming results, click-to-expand evidence) —
it just changes *where* the artifact runs, not what it does. Option 2 is
the fallback if a chat-native experience is a hard requirement, but it
changes the product shape from "search tool" to "report generator."

No code changes made under this ADR — parked for a follow-up session per
user request (2026-07-16).

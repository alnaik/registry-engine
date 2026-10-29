# 0018 — Public repo as a run-it-yourself tool, env-only credentials

## Context

The owner is making the repository public (2026-10-28). Every user runs the
app on their own machine. The AI step worked only through `claude -p`; the
adapter had an Anthropic Messages backend that nothing wired up.

## Decision

- **Run it yourself.** No hosted version. The server stays single-user and
  bound to localhost (SECURITY Threat 8).
- **Credentials from the environment only.** `ANTHROPIC_API_KEY`,
  `EXA_API_KEY` and `PARALLEL_API_KEY` are read from the shell at start.
  `llmBackendFromEnv` is the one place that picks the AI backend: the
  Anthropic API when the key is set, otherwise the Claude Code login
  (`claude -p`). The page says which path is billed.
- **No key field in the page and no hosted mode.** Keys never touch the page
  or the disk; the server's threat model assumes one local user; holding
  other people's keys is a different product.
- **Data shipped as filed.** The PPP and PACA shards are public federal
  records that name individuals, published as filed (SECURITY Threat 5);
  shipping them in the repo is a deliberate choice.

## Consequences

- `.env.example` documents the variables; nothing loads it automatically.
- With an API key the sheet shows tokens only; the bill is on the user's
  Anthropic console.

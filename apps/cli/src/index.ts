// Validation harness for the v3 socket pipeline. The search command returns
// in Phase 3/4 once map/route/fetch/probe/brief are wired; until then this
// is a placeholder so the workspace stays green.

function printHelp(): void {
  console.log(`Registry Engine CLI (v3 socket refactor in progress)

The query pipeline (map -> route -> fetch -> probe -> brief) lands in
Phases 2-4. LLM calls will run through the Claude Code CLI (claude -p),
billing your subscription — no API key needed.
`);
}

printHelp();

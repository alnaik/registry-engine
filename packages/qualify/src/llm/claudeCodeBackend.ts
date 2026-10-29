import { spawn } from "node:child_process";
import type { RawLlm, RawCompleteOptions } from "./adapter.js";

// RawLlm backend that shells out to the Claude Code CLI in headless mode
// (`claude -p --output-format json`). Runs on the user's Claude Code login —
// no API key needed here. Node-only: spawns a child process.
export class ClaudeCodeBackend implements RawLlm {
  // Optional override pins every tier to one CLI model alias (e.g. "sonnet").
  constructor(private readonly modelOverride?: string | undefined) {}

  async complete(prompt: string, opts: RawCompleteOptions): Promise<string> {
    // The prompt goes via stdin: flag values with spaces are fragile as
    // positional arguments.
    const args = [
      "-p",
      "--output-format", "json",
      "--model", this.modelOverride ?? opts.model,
      // No tools (they cost ~15k input tokens per call and our calls never use
      // them), no MCP servers, no session files in the user's history.
      "--tools", "",
      "--strict-mcp-config",
      "--no-session-persistence",
      ...(opts.system !== undefined ? ["--system-prompt", opts.system] : []),
    ];

    const stdout = await run("claude", args, prompt);

    let result: {
      result?: string;
      total_cost_usd?: unknown;
      usage?: {
        input_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
        output_tokens?: number;
      };
    };
    try {
      result = JSON.parse(stdout) as typeof result;
    } catch {
      throw new Error(`claude CLI returned unparseable output: ${stdout.slice(0, 200)}`);
    }
    const u = result.usage;
    if (u !== undefined && u !== null && typeof u === "object") {
      const cost = result.total_cost_usd;
      opts.onUsage?.({
        inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
        outputTokens: u.output_tokens ?? 0,
        costUsd: typeof cost === "number" && Number.isFinite(cost) ? cost : null,
      });
    }
    return result.result ?? "";
  }
}

function run(cmd: string, args: string[], stdin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { timeout: 300_000 });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("error", err => reject(new Error(`claude CLI failed to start: ${err.message}`)));
    child.on("close", code => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`claude CLI exited ${code}${stderr ? `: ${stderr.slice(0, 300)}` : ""}`));
      }
    });
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

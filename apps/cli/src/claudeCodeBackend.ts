import { spawn } from "node:child_process";
import type { LlmBackend, LlmRequest, LlmResponse } from "@registry-engine/qualify";

// LlmBackend that shells out to the Claude Code CLI in headless mode
// (`claude -p --output-format json`). Bills the user's Claude subscription —
// no API key needed. Node-only: never bundle this into the artifact.
//
// When the request asks for web search, headless Claude Code's own WebSearch
// tool is allowed; otherwise tools are disabled for a plain completion.
export class ClaudeCodeBackend implements LlmBackend {
  constructor(private readonly model: string = "sonnet") {}

  async call(req: LlmRequest): Promise<LlmResponse> {
    const wantsWebSearch = (req.tools ?? []).some(t => t.name === "web_search");
    const prompt = req.messages.map(m => m.content).join("\n\n");

    // The prompt goes via stdin: --allowedTools is variadic and would
    // swallow a positional prompt argument.
    const args = [
      "-p",
      "--output-format", "json",
      "--model", this.model,
      ...(req.system !== undefined ? ["--system-prompt", req.system] : []),
      // Headless mode denies any tool not explicitly allowed, so plain
      // completions need no tool flags at all.
      ...(wantsWebSearch ? ["--allowedTools", "WebSearch"] : []),
    ];

    const stdout = await run("claude", args, prompt);

    let result: { result?: string; usage?: { input_tokens?: number; output_tokens?: number } };
    try {
      result = JSON.parse(stdout) as typeof result;
    } catch {
      throw new Error(`claude CLI returned unparseable output: ${stdout.slice(0, 200)}`);
    }

    const content = result.result ?? "";
    return {
      content,
      usage: {
        inputTokens: result.usage?.input_tokens ?? Math.ceil(prompt.length / 4),
        outputTokens: result.usage?.output_tokens ?? Math.ceil(content.length / 4),
      },
      stopReason: "end_turn",
    };
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

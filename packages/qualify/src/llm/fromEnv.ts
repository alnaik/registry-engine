import { anthropicApiBackend } from "./adapter.js";
import type { RawLlm } from "./adapter.js";
import { ClaudeCodeBackend } from "./claudeCodeBackend.js";

// Which path pays for the AI calls: an Anthropic API key, or the user's
// Claude Code login (claude -p), which may itself be a subscription, a key,
// Bedrock or Vertex.
export type LlmBilling = "claude-code" | "api-key";

// The one place that picks the LLM backend. The key is read here, once, and
// lives only inside the backend closure: never logged, never in an event,
// never written to history.
export function llmBackendFromEnv(
  env: Record<string, string | undefined> = process.env,
  modelOverride?: string | undefined
): { backend: RawLlm; billing: LlmBilling } {
  const key = env["ANTHROPIC_API_KEY"];
  if (key !== undefined && key !== "") {
    return { backend: anthropicApiBackend(key, modelOverride), billing: "api-key" };
  }
  // Fails at call time if `claude` is missing.
  return { backend: new ClaudeCodeBackend(modelOverride), billing: "claude-code" };
}

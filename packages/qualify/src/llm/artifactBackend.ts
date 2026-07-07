import type { LlmBackend, LlmRequest, LlmResponse } from "./LlmBackend.js";

export class ArtifactBackend implements LlmBackend {
  async call(req: LlmRequest): Promise<LlmResponse> {
    const body: Record<string, unknown> = {
      model: "claude-sonnet-4-6",
      max_tokens: req.maxTokens,
      messages: req.messages,
    };
    if (req.system) body["system"] = req.system;
    if (req.tools && req.tools.length > 0) body["tools"] = req.tools;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      throw new Error(`Anthropic API error ${resp.status}: ${await resp.text()}`);
    }

    const data = await resp.json() as {
      content: Array<{ type: string; text?: string }>;
      usage: { input_tokens: number; output_tokens: number };
      stop_reason: string;
    };

    const content = data.content
      .filter(b => b.type === "text")
      .map(b => b.text ?? "")
      .join("");

    return {
      content,
      usage: { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens },
      stopReason: data.stop_reason,
    };
  }
}

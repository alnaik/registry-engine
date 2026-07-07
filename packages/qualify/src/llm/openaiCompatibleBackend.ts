import type { LlmBackend, LlmRequest, LlmResponse } from "./LlmBackend.js";

export interface OpenAICompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export class OpenAICompatibleBackend implements LlmBackend {
  constructor(private config: OpenAICompatibleConfig) {}

  async call(req: LlmRequest): Promise<LlmResponse> {
    const messages: Array<{ role: string; content: string }> = [];
    if (req.system) {
      messages.push({ role: "system", content: req.system });
    }
    messages.push(...req.messages);

    const resp = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: req.maxTokens,
        messages,
      }),
    });

    if (!resp.ok) {
      throw new Error(`OpenAI-compatible API error ${resp.status}: ${await resp.text()}`);
    }

    const data = await resp.json() as {
      choices: Array<{ message: { content: string }; finish_reason: string }>;
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    const choice = data.choices[0];
    if (!choice) throw new Error("No choices in OpenAI-compatible response");

    return {
      content: choice.message.content,
      usage: { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens },
      stopReason: choice.finish_reason,
    };
  }
}

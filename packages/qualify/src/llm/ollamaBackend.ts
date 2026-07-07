import type { LlmBackend, LlmRequest, LlmResponse } from "./LlmBackend.js";

export interface OllamaConfig {
  baseUrl?: string | undefined;
  model: string;
}

export class OllamaBackend implements LlmBackend {
  private baseUrl: string;

  constructor(private config: OllamaConfig) {
    this.baseUrl = config.baseUrl ?? "http://localhost:11434";
  }

  async call(req: LlmRequest): Promise<LlmResponse> {
    const messages: Array<{ role: string; content: string }> = [];
    if (req.system) {
      messages.push({ role: "system", content: req.system });
    }
    messages.push(...req.messages);

    const resp = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        stream: false,
        options: { num_predict: req.maxTokens },
      }),
    });

    if (!resp.ok) {
      throw new Error(`Ollama API error ${resp.status}: ${await resp.text()}`);
    }

    const data = await resp.json() as {
      message: { content: string };
      done_reason: string;
      prompt_eval_count?: number | undefined;
      eval_count?: number | undefined;
    };

    return {
      content: data.message.content,
      usage: {
        inputTokens: data.prompt_eval_count ?? Math.ceil(req.messages.reduce((s, m) => s + m.content.length, 0) / 4),
        outputTokens: data.eval_count ?? Math.ceil(data.message.content.length / 4),
      },
      stopReason: data.done_reason,
    };
  }
}

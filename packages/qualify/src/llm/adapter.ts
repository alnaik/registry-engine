// The single LLM entry point. Every call site in the engine goes through
// createLlm(...).call(prompt, {tier}) — which is what makes the ≤2-calls-per-
// search budget enforceable with one counter.

export type Tier = "cheap" | "best";

export const TIER_MODELS: Record<Tier, string> = {
  cheap: "claude-haiku-4-5-20251001",
  best: "claude-sonnet-5",
};

export interface RawCompleteOptions {
  model: string;
  maxTokens: number;
  system?: string | undefined;
}

// The one thing a backend must do. With an API key the tier picks the
// model; the CLI injects a `claude -p` backend.
export interface RawLlm {
  complete(prompt: string, opts: RawCompleteOptions): Promise<string>;
}

export interface LlmConfig {
  apiKey?: string | undefined;
  backend?: RawLlm | undefined;
  maxCalls?: number | undefined;   // hard ceiling per Llm instance (per search)
}

export interface LlmCallOptions {
  tier: Tier;
  maxTokens?: number | undefined;
  system?: string | undefined;
}

export class LlmCallBudgetError extends Error {
  constructor(maxCalls: number) {
    super(`LLM call budget exceeded: this search already made ${maxCalls} call(s). The pipeline allows at most ${maxCalls} — a code path is making per-candidate calls.`);
    this.name = "LlmCallBudgetError";
  }
}

export class Llm {
  private used = 0;

  constructor(
    private readonly raw: RawLlm,
    private readonly maxCalls?: number | undefined
  ) {}

  get calls(): number {
    return this.used;
  }

  reset(): void {
    this.used = 0;
  }

  async call(prompt: string, opts: LlmCallOptions): Promise<string> {
    if (this.maxCalls !== undefined && this.used >= this.maxCalls) {
      throw new LlmCallBudgetError(this.maxCalls);
    }
    this.used++;
    return this.raw.complete(prompt, {
      model: TIER_MODELS[opts.tier],
      maxTokens: opts.maxTokens ?? 1000,
      system: opts.system,
    });
  }
}

export function createLlm(cfg: LlmConfig = {}): Llm {
  const raw =
    cfg.backend ??
    (cfg.apiKey !== undefined && cfg.apiKey !== ""
      ? anthropicApiBackend(cfg.apiKey)
      : (() => {
          throw new Error("No LLM backend available: set cfg.apiKey or inject cfg.backend");
        })());
  return new Llm(raw, cfg.maxCalls);
}

function anthropicApiBackend(apiKey: string): RawLlm {
  return {
    async complete(prompt, opts) {
      const body: Record<string, unknown> = {
        model: opts.model,
        max_tokens: opts.maxTokens,
        messages: [{ role: "user", content: prompt }],
      };
      if (opts.system !== undefined) body["system"] = opts.system;

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": apiKey,
          // Required for direct browser use; harmless in Node.
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        throw new Error(`Anthropic API error ${resp.status}: ${await resp.text()}`);
      }
      const data = (await resp.json()) as { content: Array<{ type: string; text?: string }> };
      return data.content.filter(b => b.type === "text").map(b => b.text ?? "").join("");
    },
  };
}

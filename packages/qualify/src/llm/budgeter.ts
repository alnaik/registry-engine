import type { LlmBackend, LlmRequest, LlmResponse } from "./LlmBackend.js";

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

export interface BudgetConfig {
  maxInputTokensPerRun?: number | undefined;
  maxOutputTokensPerRun?: number | undefined;
}

export class TokenBudgeter {
  private inputUsed = 0;
  private outputUsed = 0;

  constructor(
    private readonly backend: LlmBackend,
    private readonly config: BudgetConfig = {}
  ) {}

  estimateInputTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  checkBudget(estimatedInputTokens: number): void {
    if (
      this.config.maxInputTokensPerRun !== undefined &&
      this.inputUsed + estimatedInputTokens > this.config.maxInputTokensPerRun
    ) {
      throw new BudgetExceededError(
        `Input token budget exceeded: used ${this.inputUsed}, need ${estimatedInputTokens}, limit ${this.config.maxInputTokensPerRun}. Raise the budget or narrow the search.`
      );
    }
  }

  async call(req: LlmRequest): Promise<LlmResponse> {
    const allText = (req.system ?? "") + req.messages.map(m => m.content).join("");
    const estimated = this.estimateInputTokens(allText);

    this.checkBudget(estimated);

    const response = await this.backend.call(req);
    this.inputUsed += response.usage.inputTokens;
    this.outputUsed += response.usage.outputTokens;

    if (
      this.config.maxOutputTokensPerRun !== undefined &&
      this.outputUsed > this.config.maxOutputTokensPerRun
    ) {
      console.warn(`[TokenBudgeter] Output token budget exceeded: ${this.outputUsed} > ${this.config.maxOutputTokensPerRun}`);
    }

    return response;
  }

  get totals(): { input: number; output: number } {
    return { input: this.inputUsed, output: this.outputUsed };
  }

  reset(): void {
    this.inputUsed = 0;
    this.outputUsed = 0;
  }
}

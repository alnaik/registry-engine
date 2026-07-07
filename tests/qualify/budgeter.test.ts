import { describe, it, expect } from "vitest";
import { TokenBudgeter, BudgetExceededError } from "../../packages/qualify/src/llm/budgeter.js";
import type { LlmBackend, LlmRequest, LlmResponse } from "../../packages/qualify/src/llm/LlmBackend.js";

function mockBackend(responseContent: string): LlmBackend {
  return {
    async call(_req: LlmRequest): Promise<LlmResponse> {
      return {
        content: responseContent,
        usage: { inputTokens: 50, outputTokens: 20 },
        stopReason: "end_turn",
      };
    },
  };
}

describe("TokenBudgeter", () => {
  it("records usage from responses", async () => {
    const budgeter = new TokenBudgeter(mockBackend("hello"), {});
    await budgeter.call({ messages: [{ role: "user", content: "test" }], maxTokens: 100 });
    expect(budgeter.totals.input).toBe(50);
    expect(budgeter.totals.output).toBe(20);
  });

  it("throws BudgetExceededError when input limit exceeded", async () => {
    const budgeter = new TokenBudgeter(mockBackend("hi"), { maxInputTokensPerRun: 10 });
    await expect(
      budgeter.call({ messages: [{ role: "user", content: "a".repeat(100) }], maxTokens: 100 })
    ).rejects.toThrow(BudgetExceededError);
  });

  it("resets usage", async () => {
    const budgeter = new TokenBudgeter(mockBackend("hi"), {});
    await budgeter.call({ messages: [{ role: "user", content: "test" }], maxTokens: 10 });
    budgeter.reset();
    expect(budgeter.totals.input).toBe(0);
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { createLlm, LlmCallBudgetError, TIER_MODELS, type RawLlm, type RawCompleteOptions } from "../../packages/qualify/src/llm/adapter.js";

function recordingBackend(): { backend: RawLlm; seen: Array<{ prompt: string; opts: RawCompleteOptions }> } {
  const seen: Array<{ prompt: string; opts: RawCompleteOptions }> = [];
  return {
    seen,
    backend: {
      complete: async (prompt, opts) => {
        seen.push({ prompt, opts });
        return "ok";
      },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createLlm", () => {
  it("routes tiers to the configured models with an injected backend", async () => {
    const { backend, seen } = recordingBackend();
    const llm = createLlm({ backend });
    await llm.call("cheap prompt", { tier: "cheap" });
    await llm.call("best prompt", { tier: "best" });
    expect(seen[0]!.opts.model).toBe(TIER_MODELS.cheap);
    expect(seen[1]!.opts.model).toBe(TIER_MODELS.best);
  });

  it("counts every call", async () => {
    const { backend } = recordingBackend();
    const llm = createLlm({ backend });
    expect(llm.calls).toBe(0);
    await llm.call("a", { tier: "cheap" });
    await llm.call("b", { tier: "best" });
    expect(llm.calls).toBe(2);
    llm.reset();
    expect(llm.calls).toBe(0);
  });

  // The hard budget: ≤2 LLM calls per search, zero per-candidate.
  it("throws LlmCallBudgetError on the call after maxCalls", async () => {
    const { backend, seen } = recordingBackend();
    const llm = createLlm({ backend, maxCalls: 2 });
    await llm.call("map", { tier: "cheap" });
    await llm.call("brief", { tier: "best" });
    await expect(llm.call("sneaky per-candidate call", { tier: "cheap" })).rejects.toThrow(LlmCallBudgetError);
    expect(seen).toHaveLength(2); // the third call never reached the backend
  });

  it("throws immediately when no backend is available", () => {
    expect(() => createLlm()).toThrow(/No LLM backend/);
  });

  it("hits the Anthropic API with the tier model when apiKey is set", async () => {
    const fetchMock = vi.fn(async (_url: string, init: { body: string; headers: Record<string, string> }) => {
      return {
        ok: true,
        json: async () => ({ content: [{ type: "text", text: "api says hi" }] }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const llm = createLlm({ apiKey: "sk-test" });
    const out = await llm.call("ping", { tier: "best", system: "sys" });
    expect(out).toBe("api says hi");
    const call = fetchMock.mock.calls[0]!;
    expect(call[0]).toBe("https://api.anthropic.com/v1/messages");
    const body = JSON.parse(call[1].body) as Record<string, unknown>;
    expect(body["model"]).toBe(TIER_MODELS.best);
    expect(body["system"]).toBe("sys");
    expect(call[1].headers["x-api-key"]).toBe("sk-test");
  });
});

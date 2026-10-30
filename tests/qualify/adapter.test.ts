import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { ClaudeCodeBackend } from "../../packages/qualify/src/llm/claudeCodeBackend.js";
import { createLlm, LlmCallBudgetError, TIER_MODELS, type RawLlm, type RawCompleteOptions } from "../../packages/qualify/src/llm/adapter.js";
import { llmBackendFromEnv } from "../../packages/qualify/src/llm/fromEnv.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

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
        json: async () => ({
          content: [{ type: "text", text: "api says hi" }],
          usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 20, cache_read_input_tokens: 30 },
        }),
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
    expect(llm.usage).toEqual({ inputTokens: 60, outputTokens: 5, costUsd: null, calls: 1 });
  });
});

describe("usage tracking", () => {
  function usageBackend(reports: Array<{ inputTokens: number; outputTokens: number; costUsd: number | null } | null>): RawLlm {
    let i = 0;
    return {
      complete: async (_p, opts) => {
        const r = reports[i++];
        if (r) opts.onUsage?.(r);
        return "ok";
      },
    };
  }

  it("is null until a call reports usage", async () => {
    const llm = createLlm({ backend: usageBackend([null]) });
    await llm.call("a", { tier: "cheap" });
    expect(llm.usage).toBeNull();
    expect(llm.usageLog).toEqual([]);
  });

  it("sums usage, labels entries (default: tier), and reset() clears", async () => {
    const llm = createLlm({ backend: usageBackend([
      { inputTokens: 100, outputTokens: 10, costUsd: 0.001 },
      { inputTokens: 200, outputTokens: 20, costUsd: 0.002 },
    ]) });
    await llm.call("a", { tier: "cheap", label: "map" });
    await llm.call("b", { tier: "best" });
    expect(llm.usageLog.map(e => e.label)).toEqual(["map", "best"]);
    expect(llm.usageLog[0]!.model).toBe(TIER_MODELS.cheap);
    const u = llm.usage!;
    expect(u.calls).toBe(2);
    expect(u.inputTokens).toBe(300);
    expect(u.outputTokens).toBe(30);
    expect(u.costUsd).toBeCloseTo(0.003);
    llm.reset();
    expect(llm.usage).toBeNull();
    expect(llm.usageLog).toHaveLength(0);
  });

  it("a null cost on any entry makes the total cost null", async () => {
    const llm = createLlm({ backend: usageBackend([
      { inputTokens: 1, outputTokens: 1, costUsd: 0.001 },
      { inputTokens: 1, outputTokens: 1, costUsd: null },
    ]) });
    await llm.call("a", { tier: "cheap" });
    await llm.call("b", { tier: "best" });
    expect(llm.usage!.costUsd).toBeNull();
  });
});

describe("ClaudeCodeBackend", () => {
  function mockSpawn(stdout: string) {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    vi.mocked(spawn).mockImplementation(((cmd: string, args: string[]) => {
      calls.push({ cmd, args });
      const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; stdin: { on: () => void; write: () => void; end: () => void } };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = {
        on: () => undefined,
        write: () => undefined,
        end: () => {
          setImmediate(() => {
            child.stdout.emit("data", Buffer.from(stdout));
            child.emit("close", 0);
          });
        },
      };
      return child;
    }) as unknown as typeof spawn);
    return calls;
  }

  it("runs without tools, MCP servers or session files, and reports usage", async () => {
    const calls = mockSpawn('{"result":"ok","total_cost_usd":0.0007,"usage":{"input_tokens":478,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":39}}');
    const onUsage = vi.fn();
    const out = await new ClaudeCodeBackend().complete("hi", { model: "m", maxTokens: 10, system: "sys", onUsage });
    expect(out).toBe("ok");
    const args = calls[0]!.args;
    const t = args.indexOf("--tools");
    expect(t).toBeGreaterThanOrEqual(0);
    expect(args[t + 1]).toBe("");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--no-session-persistence");
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 478, outputTokens: 39, costUsd: 0.0007 });
  });

  it("sums cache tokens into input and does not report usage when absent", async () => {
    mockSpawn('{"result":"x","usage":{"input_tokens":9,"cache_creation_input_tokens":3753,"cache_read_input_tokens":11991,"output_tokens":4}}');
    const onUsage = vi.fn();
    await new ClaudeCodeBackend().complete("hi", { model: "m", maxTokens: 10, onUsage });
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 15753, outputTokens: 4, costUsd: null });

    mockSpawn('{"result":"x"}');
    const none = vi.fn();
    await new ClaudeCodeBackend().complete("hi", { model: "m", maxTokens: 10, onUsage: none });
    expect(none).not.toHaveBeenCalled();
  });
});

describe("llmBackendFromEnv", () => {
  function apiFetch(reply: { ok: boolean; status?: number; json: () => Promise<unknown> }) {
    const fetchMock = vi.fn(async (_url: string, _init: { body: string; headers: Record<string, string>; signal?: unknown }) => reply);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("picks the API backend when ANTHROPIC_API_KEY is set, Claude Code otherwise", () => {
    expect(llmBackendFromEnv({ ANTHROPIC_API_KEY: "sk-test" }).billing).toBe("api-key");
    const cc = llmBackendFromEnv({});
    expect(cc.billing).toBe("claude-code");
    expect(cc.backend).toBeInstanceOf(ClaudeCodeBackend);
  });

  it("treats an empty key as unset", () => {
    const picked = llmBackendFromEnv({ ANTHROPIC_API_KEY: "" });
    expect(picked.billing).toBe("claude-code");
    expect(picked.backend).toBeInstanceOf(ClaudeCodeBackend);
  });

  it("sends the key, the model override and the live-safe request shape", async () => {
    const fetchMock = apiFetch({ ok: true, json: async () => ({ content: [{ type: "text", text: "hi" }], stop_reason: "end_turn" }) });
    const { backend } = llmBackendFromEnv({ ANTHROPIC_API_KEY: "sk-test" }, "claude-opus-5-5");
    const out = await createLlm({ backend }).call("ping", { tier: "cheap", maxTokens: 500 });
    expect(out).toBe("hi");
    const init = fetchMock.mock.calls[0]![1];
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body["model"]).toBe("claude-opus-5-5");
    expect(body["max_tokens"]).toBe(4000);
    expect(body["output_config"]).toEqual({ effort: "low" });
    expect(init.headers["x-api-key"]).toBe("sk-test");
    expect(init.headers["anthropic-dangerous-direct-browser-access"]).toBeUndefined();
    expect(init.signal).toBeDefined();
  });

  it("reduces API errors to status and error type, never the raw body", async () => {
    apiFetch({ ok: false, status: 401, json: async () => ({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" }, secret: "RAW-BODY" }) });
    const { backend } = llmBackendFromEnv({ ANTHROPIC_API_KEY: "sk-test" });
    await expect(backend.complete("p", { model: "m", maxTokens: 10 })).rejects.toThrow(/^Anthropic API error 401 \(authentication_error: invalid x-api-key\)$/);

    apiFetch({ ok: false, status: 500, json: async () => { throw new Error("not json"); } });
    await expect(backend.complete("p", { model: "m", maxTokens: 10 })).rejects.toThrow(/^Anthropic API error 500$/);
  });

  it("throws when the answer stopped at max_tokens or was refused", async () => {
    const { backend } = llmBackendFromEnv({ ANTHROPIC_API_KEY: "sk-test" });
    for (const stop of ["max_tokens", "refusal"]) {
      apiFetch({ ok: true, json: async () => ({ content: [{ type: "text", text: "partial" }], stop_reason: stop }) });
      await expect(backend.complete("p", { model: "m", maxTokens: 10 })).rejects.toThrow(stop);
    }
  });
});

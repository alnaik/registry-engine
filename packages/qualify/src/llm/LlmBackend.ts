export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmTool {
  type: string;
  name: string;
}

export interface LlmRequest {
  system?: string | undefined;
  messages: LlmMessage[];
  maxTokens: number;
  tools?: LlmTool[] | undefined;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmResponse {
  content: string;
  usage: LlmUsage;
  stopReason: string;
}

export interface LlmBackend {
  call(req: LlmRequest): Promise<LlmResponse>;
}

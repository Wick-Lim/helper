// LLM abstraction types

import type { ToolDeclaration, ChatMessage } from "../core/types.js";

export interface ChatParams {
  messages: ChatMessage[];
  tools?: ToolDeclaration[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  thinkingBudget?: number;
}

export interface ChatResponse {
  text?: string;
  thinking?: string;
  functionCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
  }>;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    thinkingTokens?: number;
  };
  finishReason: string;
}

export interface LLMClient {
  chat(params: ChatParams): Promise<ChatResponse>;
  readonly model: string;
}

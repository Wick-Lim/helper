// Core type definitions shared across the entire system

export interface ImageData {
  mimeType: string;  // "image/png" | "image/jpeg"
  data: string;      // base64
  id?: string;       // filename for HTTP serving
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  executionTime?: number;
  images?: ImageData[];
}

export interface ToolParameter {
  type: string;
  description: string;
  enum?: string[];
  items?: { type: string };
  default?: unknown;
}

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
}

export interface Tool {
  declaration: ToolDeclaration;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}

// LLM-related types
export interface ChatMessage {
  role: "user" | "model" | "system";
  content: string;
  images?: ImageData[];
  functionCalls?: FunctionCall[];
  functionResponses?: FunctionResponse[];
}

export interface FunctionCall {
  name: string;
  args: Record<string, unknown>;
  thoughtSignature?: string;
}

export interface FunctionResponse {
  name: string;
  response: ToolResult;
}

// Agent event types for streaming
export type AgentEvent =
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; result: ToolResult }
  | { type: "error"; error: string }
  | { type: "stuck_warning"; message: string }
  | { type: "done"; summary: string };

// Database row types
export interface MemoryRow {
  id: number;
  key: string;
  value: string;
  category: string;
  importance: number;
  access_count: number;
  created_at: string;
  updated_at: string;
}

export interface TaskRow {
  id: number;
  session_id: string;
  description: string;
  status: "running" | "completed" | "failed" | "stuck";
  result?: string;
  iterations: number;
  created_at: string;
  completed_at?: string;
}

export interface ToolCallRow {
  id: number;
  task_id: number;
  tool_name: string;
  input: string;
  output: string;
  success: boolean;
  execution_time_ms: number;
  created_at: string;
}

export interface ConversationRow {
  id: number;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
}

export interface ConfigRow {
  key: string;
  value: string;
  updated_at: string;
}

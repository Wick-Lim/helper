// Core type definitions shared across the entire system
// All types are strictly defined to ensure type safety

/** Supported MIME types for images */
export type ImageMimeType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

/** Supported MIME types for files */
export type FileMimeType =
  | "video/mp4"
  | "video/webm"
  | "video/x-msvideo"
  | "video/x-matroska"
  | "video/quicktime"
  | "audio/mpeg"
  | "audio/wav"
  | "audio/ogg"
  | "audio/mp4"
  | "application/pdf"
  | "application/zip"
  | "application/x-tar"
  | "application/gzip"
  | "application/json"
  | "text/csv"
  | "text/plain"
  | "application/octet-stream";

/** Image data for multimodal inputs */
export interface ImageData {
  mimeType: ImageMimeType;
  data: string; // base64 encoded
  id?: string; // filename for HTTP serving
}

/** File attachment for sending to users */
export interface FileAttachment {
  path: string;
  mimeType: FileMimeType;
}

/** Result of a tool execution */
export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  executionTime?: number;
  images?: ImageData[];
  files?: FileAttachment[];
}

/** Parameter types for tool declarations */
export type ToolParameterType = "string" | "number" | "integer" | "boolean" | "array" | "object";

/** Parameter definition for tools */
export interface ToolParameter {
  type: ToolParameterType;
  description: string;
  enum?: string[];
  items?: { type: ToolParameterType };
  default?: unknown;
}

/** Tool declaration for LLM function calling */
export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
}

/** Tool interface - implementation and declaration */
export interface Tool {
  declaration: ToolDeclaration;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}

/** Chat message roles */
export type ChatRole = "user" | "model" | "system";

/** Chat message for conversation */
export interface ChatMessage {
  role: ChatRole;
  content: string;
  images?: ImageData[];
  functionCalls?: FunctionCall[];
  functionResponses?: FunctionResponse[];
}

/** LLM function call */
export interface FunctionCall {
  name: string;
  args: Record<string, unknown>;
  thoughtSignature?: string;
}

/** LLM function response */
export interface FunctionResponse {
  name: string;
  response: ToolResult;
}

/** Agent event types for streaming responses */
export type AgentEventType =
  | "thinking"
  | "text"
  | "tool_call"
  | "tool_result"
  | "error"
  | "stuck_warning"
  | "done";

/** Base agent event */
interface BaseAgentEvent {
  type: AgentEventType;
}

/** Thinking event - shows LLM reasoning */
export interface ThinkingEvent extends BaseAgentEvent {
  type: "thinking";
  text: string;
}

/** Text event - LLM response text */
export interface TextEvent extends BaseAgentEvent {
  type: "text";
  text: string;
}

/** Tool call event - tool is being invoked */
export interface ToolCallEvent extends BaseAgentEvent {
  type: "tool_call";
  name: string;
  args: Record<string, unknown>;
}

/** Tool result event - tool execution completed */
export interface ToolResultEvent extends BaseAgentEvent {
  type: "tool_result";
  name: string;
  result: ToolResult;
}

/** Error event - something went wrong */
export interface ErrorEvent extends BaseAgentEvent {
  type: "error";
  error: string;
}

/** Stuck warning event - agent might be stuck */
export interface StuckWarningEvent extends BaseAgentEvent {
  type: "stuck_warning";
  message: string;
}

/** Done event - agent run completed */
export interface DoneEvent extends BaseAgentEvent {
  type: "done";
  summary: string;
}

/** Union type for all agent events */
export type AgentEvent =
  | ThinkingEvent
  | TextEvent
  | ToolCallEvent
  | ToolResultEvent
  | ErrorEvent
  | StuckWarningEvent
  | DoneEvent;

/** Task status in database */
export type TaskStatus = "running" | "completed" | "failed" | "stuck";

/** Memory row from database */
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

/** Task row from database */
export interface TaskRow {
  id: number;
  session_id: string;
  description: string;
  status: TaskStatus;
  result?: string;
  iterations: number;
  created_at: string;
  completed_at?: string;
}

/** Tool call log row from database */
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

/** Conversation history row from database */
export interface ConversationRow {
  id: number;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
}

/** Configuration row from database */
export interface ConfigRow {
  key: string;
  value: string;
  updated_at: string;
}

/** Browser wait conditions */
export type BrowserWaitCondition = "load" | "domcontentloaded" | "networkidle0" | "networkidle2";

/** Shell command options */
export interface ShellCommandOptions {
  command: string;
  timeout_ms?: number;
  working_directory?: string;
}

/** File operation options */
export interface FileOperationOptions {
  action: "read" | "write" | "append" | "list" | "delete" | "exists" | "stat" | "send";
  path: string;
  content?: string;
  pattern?: string;
}

/** Web request options */
export interface WebRequestOptions {
  url: string;
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  headers?: string;
  body?: string;
  timeout_ms?: number;
}

/** Browser action options */
export interface BrowserActionOptions {
  action: "navigate" | "screenshot" | "click" | "type" | "evaluate" | "content";
  url?: string;
  selector?: string;
  text?: string;
  script?: string;
  full_page?: boolean;
  wait_until?: BrowserWaitCondition;
}

/** Code execution options */
export interface CodeExecutionOptions {
  language: "python" | "javascript" | "bash";
  code: string;
  timeout_ms?: number;
}

/** Memory operation options */
export interface MemoryOperationOptions {
  action: "get" | "set" | "list" | "search" | "delete";
  key?: string;
  value?: string;
  category?: string;
  query?: string;
}

/** API usage statistics */
export interface ApiUsageStats {
  totalRequests: number;
  totalTokens: number;
  errors: number;
  lastRequestTime: number;
}

/** Request context for logging */
export interface RequestContext {
  requestId: string;
  sessionId?: string;
}

/** LLM token usage */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens?: number;
}

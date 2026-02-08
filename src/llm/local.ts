// Local LLM client (llama.cpp server)
// Full-featured LLM client with function calling support
// Replaces Gemini as the primary reasoning engine

import { logger } from "../core/logger.js";
import { classifyHttpError } from "./retry.js";
import { parseFunctionCalls } from "./function-parser.ts";
import { rateLimiters, recordApiUsage } from "../core/ratelimit.js";
import type { LLMClient, ChatParams, ChatResponse } from "./types.js";
import type { ToolDeclaration, ChatMessage } from "../core/types.js";

// Ollama endpoint for DeepSeek R1 Distill Qwen (local reasoning engine)
const OLLAMA_ENDPOINT = process.env.OLLAMA_ENDPOINT || "http://localhost:11434";
const MODEL_NAME = "deepseek-r1:7b";

/**
 * Convert our tool declarations to OpenAI-compatible function format
 */
function toOpenAIFunctions(tools: ToolDeclaration[]): Array<{
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}> {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: {
      type: "object",
      properties: tool.parameters.properties,
      required: tool.parameters.required || [],
    },
  }));
}

/**
 * Convert our chat messages to OpenAI-compatible format
 */
function toOpenAIMessages(
  messages: ChatMessage[],
  systemPrompt?: string
): Array<{
  role: string;
  content: string;
}> {
  const converted: Array<{ role: string; content: string }> = [];

  // Add system message first
  if (systemPrompt) {
    converted.push({ role: "system", content: systemPrompt });
  }

  for (const msg of messages) {
    if (msg.role === "system") {
      converted.push({ role: "system", content: msg.content });
    } else if (msg.role === "user") {
      // User messages
      let content = msg.content;

      // Handle images by mentioning them (llama.cpp doesn't support vision yet)
      if (msg.images && msg.images.length > 0) {
        content += `\n\n[Note: User provided ${msg.images.length} image(s)]`;
      }

      // Handle function responses
      if (msg.functionResponses && msg.functionResponses.length > 0) {
        const results = msg.functionResponses
          .map((fr) => {
            const output = fr.response.success
              ? fr.response.output
              : `Error: ${fr.response.error}`;
            return `Tool "${fr.name}" result:\n${output}`;
          })
          .join("\n\n");
        content = results;
      }

      converted.push({ role: "user", content });
    } else if (msg.role === "model") {
      // Model messages (including function calls)
      let content = msg.content || "";

      if (msg.functionCalls && msg.functionCalls.length > 0) {
        // Format function calls as text
        const calls = msg.functionCalls
          .map(
            (fc) =>
              `Function call: ${fc.name}\nArguments: ${JSON.stringify(fc.args, null, 2)}`
          )
          .join("\n\n");
        content = calls;
      }

      if (content) {
        converted.push({ role: "assistant", content });
      }
    }
  }

  return converted;
}

/**
 * Build a system prompt that encourages function calling
 */
function buildFunctionCallingPrompt(tools: ToolDeclaration[]): string {
  const toolList = tools
    .map((t, idx) => {
      const params = Object.entries(t.parameters.properties)
        .map(([name, schema]) => `  - **"${name}"** (${schema.type}): ${schema.description || schema.type}`)
        .join("\n");
      const required = t.parameters.required || [];
      const requiredStr = required.length > 0 ? `\n   Required: ${required.map(r => `"${r}"`).join(", ")}` : "";
      return `${idx + 1}. **${t.name}**: ${t.description}\n   Parameters:\n${params}${requiredStr}`;
    })
    .join("\n\n");

  return `You are a tool-calling agent. Respond ONLY with a JSON tool call. No text before or after.

RESPONSE FORMAT (ONLY THIS):
\`\`\`json
{"name": "tool_name", "args": {"param": "value"}}
\`\`\`

AVAILABLE TOOLS:
${toolList}

QUICK REFERENCE - EXACT PARAMETER NAMES:

browser: action="navigate"|"content"|"click"|"type"|"evaluate"|"screenshot", url="https://...", selector="CSS", text="..."
file: action="write"|"read"|"append"|"list"|"delete", path="/workspace/...", content="..."
shell: command="...", timeout=number
memory: action="save"|"search"|"list"|"delete", key="...", value="...", query="...", category="..."

RULES:
- "예시 데이터", "가상 데이터", "example.com" 사용 금지
- 설명/가이드/조언 금지, 오직 JSON 도구 호출만
- 실제 웹사이트를 실제로 방문하고 실제 작업을 수행하세요`;
}

/**
 * Create a local LLM client that implements the LLMClient interface
 */
export function createLocalClient(): LLMClient {
  logger.info(`Local LLM client initialized: ${MODEL_NAME}`);

  return {
    get model() {
      return MODEL_NAME;
    },

    async chat(params: ChatParams): Promise<ChatResponse> {
      const startTime = Date.now();
      let totalTokens = 0;
      let success = false;

      // Rate limiting
      logger.debug(`Waiting for rate limiter... (${rateLimiters.localLLM.getAvailableTokens()} tokens available)`);
      await rateLimiters.localLLM.acquire(1);
      logger.debug("Rate limiter acquired");

      try {
        // Build system prompt
        let systemPrompt = params.systemPrompt || "";

        if (params.tools && params.tools.length > 0) {
          const functionPrompt = buildFunctionCallingPrompt(params.tools);
          systemPrompt = systemPrompt
            ? `${systemPrompt}\n\n${functionPrompt}`
            : functionPrompt;
        }

        // Convert messages
        const messages = toOpenAIMessages(params.messages, systemPrompt);

        // Call Modal.com endpoint (or Ollama OpenAI-compatible API)
        const response = await fetch(`${OLLAMA_ENDPOINT}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "deepseek-r1:7b",
            messages,
            temperature: params.temperature ?? 0.1, // Very low temperature for precise function calling
            max_tokens: params.maxTokens ?? 4096,
            stream: false,
            stop: [
              "```\n\n",  // Stop after code block closes
              "User:",
              "<|im_end|>",
              "<|endoftext|>",
              "\n\n이",  // Common Korean sentence starters
              "\n\n먼저",
              "\n\n다음",
              "\n\n실제",
              "\n\n작업",
              "Step 1:",
              "### Step",
              "1. **",
              "2. **",
              "[Using"
            ],
          }),
        });

        if (!response.ok) {
          throw classifyHttpError(response.status, await response.text());
        }

        const json = (await response.json()) as {
          choices?: Array<{
            message?: { content?: string; role?: string };
            finish_reason?: string;
          }>;
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
          };
        };

        const choice = json.choices?.[0];
        const content = choice?.message?.content || "";

        // Track usage
        totalTokens = json.usage?.total_tokens || 0;
        const inputTokens = json.usage?.prompt_tokens || 0;
        const outputTokens = json.usage?.completion_tokens || 0;

        // Parse function calls from response
        let functionCalls: Array<{
          name: string;
          args: Record<string, unknown>;
        }> | undefined;

        if (params.tools && params.tools.length > 0) {
          const parsed = parseFunctionCalls(content);
          if (parsed.length > 0) {
            functionCalls = parsed;
            logger.debug(`Parsed ${parsed.length} function call(s) from response`);
          }
        }

        // If we found function calls, don't include the raw JSON in text
        let text: string | undefined;
        if (functionCalls && functionCalls.length > 0) {
          // Extract any text before the JSON block
          const beforeJson = content.split("```")[0].trim();
          text = beforeJson.length > 0 ? beforeJson : undefined;
        } else {
          text = content;
        }

        success = true;
        const duration = Date.now() - startTime;
        logger.debug(
          `Local LLM call completed in ${duration}ms, ${totalTokens} tokens`
        );

        return {
          text,
          functionCalls,
          usage: {
            inputTokens,
            outputTokens,
          },
          finishReason: choice?.finish_reason ?? "stop",
        };
      } catch (err) {
        success = false;
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`Local LLM call failed: ${msg}`);
        throw err;
      } finally {
        recordApiUsage("local-llm", totalTokens, success);
      }
    },
  };
}

// Legacy interface for simple chat
export const localLLM = {
  async chat(params: {
    messages: Array<{ role: string; content: string }>;
    temperature?: number;
    maxTokens?: number;
  }): Promise<{ text: string }> {
    try {
      const response = await fetch(`${OLLAMA_ENDPOINT}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "deepseek-r1:7b",
          messages: params.messages,
          temperature: params.temperature ?? 0.7,
          max_tokens: params.maxTokens ?? 1024,
          stream: false,
        }),
      });

      if (!response.ok) {
        throw classifyHttpError(response.status, await response.text());
      }

      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = json.choices?.[0]?.message?.content || "";

      return { text };
    } catch (err) {
      logger.error(
        `Local LLM call failed: ${err instanceof Error ? err.message : String(err)}`
      );
      throw err;
    }
  },

  async summarize(text: string): Promise<string> {
    try {
      const result = await this.chat({
        messages: [
          {
            role: "system",
            content:
              "You are an expert at concisely summarizing AI thoughts. Summarize in under 50 characters. Use English only.",
          },
          { role: "user", content: `Summarize this thought: ${text}` },
        ],
        temperature: 0.3,
        maxTokens: 50,
      });

      // Remove Chinese characters (CJK Ideographs)
      const cleaned = result.text
        .replace(/[\u4E00-\u9FFF\u3400-\u4DBF]/g, '') // Remove Han characters
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();

      return cleaned || "Processing thought";
    } catch {
      return "Thinking...";
    }
  },
};

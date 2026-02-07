// Gemini API client with function calling, thinking support, and rate limiting

import {
  GoogleGenerativeAI,
  type FunctionDeclaration,
  type FunctionDeclarationSchema,
  type Content,
  SchemaType,
} from "@google/generative-ai";
import { withRetry, classifyHttpError } from "./retry.js";
import { logger } from "../core/logger.js";
import { rateLimiters, recordApiUsage } from "../core/ratelimit.js";
import type { LLMClient, ChatParams, ChatResponse } from "./types.js";
import type { ToolDeclaration, ChatMessage } from "../core/types.js";

// Maximum tokens per request for cost control
const MAX_INPUT_TOKENS = 100000;
const MAX_OUTPUT_TOKENS = 8192;

function mapSchemaType(type: string): SchemaType {
  switch (type) {
    case "string": return SchemaType.STRING;
    case "number": return SchemaType.NUMBER;
    case "integer": return SchemaType.INTEGER;
    case "boolean": return SchemaType.BOOLEAN;
    case "array": return SchemaType.ARRAY;
    case "object": return SchemaType.OBJECT;
    default: return SchemaType.STRING;
  }
}

function toGeminiFunctionDeclarations(
  tools: ToolDeclaration[]
): FunctionDeclaration[] {
  return tools.map((tool) => {
    const properties: Record<string, FunctionDeclarationSchema> = {};
    for (const [key, param] of Object.entries(tool.parameters.properties)) {
      const schema: FunctionDeclarationSchema = {
        type: mapSchemaType(param.type),
        description: param.description,
      };
      if (param.enum) {
        (schema as FunctionDeclarationSchema & { enum?: string[] }).enum = param.enum;
      }
      if (param.items) {
        (schema as FunctionDeclarationSchema & { items?: { type: SchemaType } }).items = { 
          type: mapSchemaType(param.items.type) 
        };
      }
      properties[key] = schema;
    }
    return {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: SchemaType.OBJECT,
        properties,
        required: tool.parameters.required ?? [],
      },
    };
  });
}

function estimateTokens(messages: ChatMessage[]): number {
  // Rough estimation: 4 chars ≈ 1 token
  let charCount = 0;
  for (const msg of messages) {
    charCount += msg.content?.length ?? 0;
    if (msg.images) {
      // Images typically count as 258 tokens each
      charCount += msg.images.length * 1000;
    }
  }
  return Math.ceil(charCount / 4);
}

function toGeminiContents(messages: ChatMessage[]): Content[] {
  return messages
    .filter((m) => m.role !== "system")
    .map((msg) => {
      if (msg.functionCalls && msg.functionCalls.length > 0) {
        return {
          role: "model",
          parts: msg.functionCalls.map((fc) => ({
            functionCall: { name: fc.name, args: fc.args },
            ...(fc.thoughtSignature ? { thoughtSignature: fc.thoughtSignature } : {}),
          })),
        };
      }
      if (msg.functionResponses && msg.functionResponses.length > 0) {
        const parts: Array<
          | { functionResponse: { name: string; response: { result: unknown } } }
          | { inlineData: { mimeType: string; data: string } }
        > = [];
        for (const fr of msg.functionResponses) {
          parts.push({
            functionResponse: {
              name: fr.name,
              response: { result: fr.response },
            },
          });
          if (fr.response.images) {
            for (const img of fr.response.images) {
              parts.push({
                inlineData: { mimeType: img.mimeType, data: img.data },
              });
            }
          }
        }
        return { role: "user", parts };
      }
      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
        { text: msg.content },
      ];
      if (msg.images) {
        for (const img of msg.images) {
          parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
        }
      }
      return {
        role: msg.role === "user" ? "user" : "model",
        parts,
      };
    });
}

export function createGeminiClient(
  apiKey: string,
  modelName?: string
): LLMClient {
  const model = modelName ?? process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const genAI = new GoogleGenerativeAI(apiKey);

  logger.info(`LLM client initialized: ${model}`);

  return {
    get model() {
      return model;
    },

    async chat(params: ChatParams): Promise<ChatResponse> {
      // Check token limit
      const estimatedTokens = estimateTokens(params.messages);
      if (estimatedTokens > MAX_INPUT_TOKENS) {
        logger.warn(`Input too large: ~${estimatedTokens} tokens (max: ${MAX_INPUT_TOKENS})`);
        return {
          text: "Error: Input too large. Please reduce the message size.",
          finishReason: "error",
        };
      }

      // Rate limiting
      logger.debug(`Waiting for rate limiter... (${rateLimiters.gemini.getAvailableTokens()} tokens available)`);
      await rateLimiters.gemini.acquire(1);
      logger.debug("Rate limiter acquired");

      const startTime = Date.now();
      let success = false;
      let totalTokens = 0;

      try {
        const result = await withRetry(async () => {
          const generativeModel = genAI.getGenerativeModel({
            model,
            systemInstruction: params.systemPrompt
              ? { role: "user", parts: [{ text: params.systemPrompt }] }
              : undefined,
            tools: params.tools
              ? [{ functionDeclarations: toGeminiFunctionDeclarations(params.tools) }]
              : undefined,
            generationConfig: {
              temperature: params.temperature ?? 0,
              maxOutputTokens: Math.min(params.maxTokens ?? MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS),
              ...(params.thinkingBudget
                ? { thinkingConfig: { thinkingBudget: params.thinkingBudget } as Record<string, number> }
                : {}),
            },
          });

          const contents = toGeminiContents(params.messages);

          let generateResult;
          try {
            generateResult = await generativeModel.generateContent({ contents });
          } catch (err: unknown) {
            // Classify HTTP errors from the API
            const error = err as { status?: number; message?: string };
            if (error?.status) {
              throw classifyHttpError(error.status, error.message);
            }
            throw err;
          }

          const response = generateResult.response;
          const candidate = response.candidates?.[0];

          if (!candidate) {
            return {
              text: "No response generated.",
              finishReason: "unknown",
            };
          }

          let text: string | undefined;
          let thinking: string | undefined;
          const functionCalls: Array<{
            name: string;
            args: Record<string, unknown>;
            thoughtSignature?: string;
          }> = [];

          for (const part of candidate.content?.parts ?? []) {
            const textPart = part as { text?: string; thought?: boolean };
            if ("text" in part && textPart.text) {
              if (textPart.thought) {
                thinking = (thinking ?? "") + textPart.text;
              } else {
                text = (text ?? "") + textPart.text;
              }
            }
            const functionCallPart = part as {
              functionCall?: { name: string; args: Record<string, unknown> };
              thoughtSignature?: string;
            };
            if ("functionCall" in part && functionCallPart.functionCall) {
              functionCalls.push({
                name: functionCallPart.functionCall.name,
                args: functionCallPart.functionCall.args ?? {},
                ...(functionCallPart.thoughtSignature ? { thoughtSignature: functionCallPart.thoughtSignature } : {}),
              });
            }
          }

          const usage = response.usageMetadata;
          totalTokens = (usage?.promptTokenCount ?? 0) + (usage?.candidatesTokenCount ?? 0);

          return {
            text,
            thinking,
            functionCalls: functionCalls.length > 0 ? functionCalls : undefined,
            usage: usage
              ? {
                  inputTokens: usage.promptTokenCount ?? 0,
                  outputTokens: usage.candidatesTokenCount ?? 0,
                  thinkingTokens: (usage as { thoughtsTokenCount?: number }).thoughtsTokenCount,
                }
              : undefined,
            finishReason: candidate.finishReason ?? "unknown",
          };
        });

        success = true;
        const duration = Date.now() - startTime;
        logger.debug(`Gemini API call completed in ${duration}ms, ~${totalTokens} tokens`);

        return result;
      } catch (err) {
        success = false;
        logger.error(`Gemini API call failed: ${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        recordApiUsage("gemini", totalTokens, success);
      }
    },
  };
}

// Export rate limiter status for monitoring
export function getGeminiRateLimiterStatus(): {
  availableTokens: number;
  maxTokens: number;
} {
  return {
    availableTokens: rateLimiters.gemini.getAvailableTokens(),
    maxTokens: 30,
  };
}

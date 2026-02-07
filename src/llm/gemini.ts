// Gemini API client with function calling and thinking support

import {
  GoogleGenerativeAI,
  type FunctionDeclaration,
  type FunctionDeclarationSchema,
  type Content,
  SchemaType,
} from "@google/generative-ai";
import { withRetry, classifyHttpError } from "./retry.js";
import { logger } from "../core/logger.js";
import type { LLMClient, ChatParams, ChatResponse } from "./types.js";
import type { ToolDeclaration, ChatMessage } from "../core/types.js";

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
        (schema as any).enum = param.enum;
      }
      if (param.items) {
        (schema as any).items = { type: mapSchemaType(param.items.type) };
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

function toGeminiContents(messages: ChatMessage[]): Content[] {
  return messages
    .filter((m) => m.role !== "system")
    .map((msg) => {
      if (msg.functionCalls && msg.functionCalls.length > 0) {
        return {
          role: "model",
          parts: msg.functionCalls.map((fc) => ({
            functionCall: { name: fc.name, args: fc.args },
          })),
        };
      }
      if (msg.functionResponses && msg.functionResponses.length > 0) {
        const parts: any[] = [];
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
      const parts: any[] = [{ text: msg.content }];
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
      return withRetry(async () => {
        const generativeModel = genAI.getGenerativeModel({
          model,
          systemInstruction: params.systemPrompt
            ? { role: "user", parts: [{ text: params.systemPrompt }] }
            : undefined,
          tools: params.tools
            ? [{ functionDeclarations: toGeminiFunctionDeclarations(params.tools) }]
            : undefined,
          generationConfig: {
            temperature: params.temperature ?? 0.7,
            maxOutputTokens: params.maxTokens ?? 8192,
            ...(params.thinkingBudget
              ? { thinkingConfig: { thinkingBudget: params.thinkingBudget } as any }
              : {}),
          },
        });

        const contents = toGeminiContents(params.messages);

        let result;
        try {
          result = await generativeModel.generateContent({ contents });
        } catch (err: any) {
          // Classify HTTP errors from the API
          if (err?.status) {
            throw classifyHttpError(err.status, err.message);
          }
          throw err;
        }

        const response = result.response;
        const candidate = response.candidates?.[0];

        if (!candidate) {
          return {
            text: "No response generated.",
            finishReason: "unknown",
          };
        }

        let text: string | undefined;
        let thinking: string | undefined;
        const functionCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

        for (const part of candidate.content?.parts ?? []) {
          if ("text" in part && part.text) {
            if ((part as any).thought) {
              thinking = (thinking ?? "") + part.text;
            } else {
              text = (text ?? "") + part.text;
            }
          }
          if ("functionCall" in part && part.functionCall) {
            functionCalls.push({
              name: part.functionCall.name,
              args: (part.functionCall.args as Record<string, unknown>) ?? {},
            });
          }
        }

        const usage = response.usageMetadata;

        return {
          text,
          thinking,
          functionCalls: functionCalls.length > 0 ? functionCalls : undefined,
          usage: usage
            ? {
                inputTokens: usage.promptTokenCount ?? 0,
                outputTokens: usage.candidatesTokenCount ?? 0,
                thinkingTokens: (usage as any).thoughtsTokenCount,
              }
            : undefined,
          finishReason: candidate.finishReason ?? "unknown",
        };
      });
    },
  };
}

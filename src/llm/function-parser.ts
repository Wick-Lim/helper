// Robust function call parser for local LLM responses
// Handles various output formats and recovers from parsing errors

import { logger } from "../core/logger.js";

export interface ParsedFunctionCall {
  name: string;
  args: Record<string, unknown>;
}

/**
 * Extract and parse function calls from LLM response text
 * Supports multiple formats:
 * 1. Direct JSON: {"name": "tool_name", "args": {...}}
 * 2. Tool calls array: {"tool_calls": [{"name": "...", "arguments": {...}}]}
 * 3. Markdown code blocks: ```json\n{...}\n```
 */
export function parseFunctionCalls(text: string): ParsedFunctionCall[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const calls: ParsedFunctionCall[] = [];

  // Try 1: Direct JSON parsing
  try {
    const parsed = JSON.parse(text);
    if (parsed.name && parsed.args) {
      calls.push({ name: parsed.name, args: parsed.args });
      return calls;
    }
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item.name && item.args) {
          calls.push({ name: item.name, args: item.args });
        }
      }
      if (calls.length > 0) return calls;
    }
  } catch {
    // Not direct JSON, continue
  }

  // Try 2: Extract JSON from markdown code blocks
  const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)```/g;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.name && (parsed.args || parsed.arguments)) {
        calls.push({
          name: parsed.name,
          args: parsed.args || parsed.arguments || {},
        });
      } else if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item.name && (item.args || item.arguments)) {
            calls.push({
              name: item.name,
              args: item.args || item.arguments || {},
            });
          }
        }
      }
    } catch (err) {
      logger.warn(`Failed to parse code block JSON: ${err}`);
    }
  }

  if (calls.length > 0) return calls;

  // Try 3: Extract tool_calls format (OpenAI-compatible)
  try {
    const toolCallsMatch = text.match(/"tool_calls"\s*:\s*(\[[\s\S]*?\])/);
    if (toolCallsMatch) {
      const toolCalls = JSON.parse(toolCallsMatch[1]);
      for (const tc of toolCalls) {
        if (tc.function?.name) {
          calls.push({
            name: tc.function.name,
            args: tc.function.arguments
              ? typeof tc.function.arguments === "string"
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments
              : {},
          });
        }
      }
    }
  } catch (err) {
    logger.warn(`Failed to parse tool_calls format: ${err}`);
  }

  if (calls.length > 0) return calls;

  // Try 4: Find any JSON object with "name" field
  const jsonObjectRegex = /\{[^{}]*"name"\s*:\s*"([^"]+)"[^{}]*\}/g;
  while ((match = jsonObjectRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[0]);
      if (parsed.name) {
        calls.push({
          name: parsed.name,
          args: parsed.args || parsed.arguments || parsed.parameters || {},
        });
      }
    } catch {
      // Skip invalid JSON
    }
  }

  return calls;
}

/**
 * Validate function call arguments against expected schema
 */
export function validateFunctionCall(
  call: ParsedFunctionCall,
  expectedParams?: string[]
): boolean {
  if (!call.name || typeof call.name !== "string") {
    logger.warn("Invalid function call: missing or invalid name");
    return false;
  }

  if (!call.args || typeof call.args !== "object") {
    logger.warn(`Invalid function call ${call.name}: args must be an object`);
    return false;
  }

  // Check for required parameters
  if (expectedParams && expectedParams.length > 0) {
    for (const param of expectedParams) {
      if (!(param in call.args)) {
        logger.warn(
          `Invalid function call ${call.name}: missing required parameter "${param}"`
        );
        return false;
      }
    }
  }

  return true;
}

/**
 * Recover from common JSON errors
 */
export function repairJSON(text: string): string {
  let repaired = text.trim();

  // Remove trailing commas
  repaired = repaired.replace(/,(\s*[}\]])/g, "$1");

  // Fix unquoted keys
  repaired = repaired.replace(/(\{|,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');

  // Fix single quotes to double quotes
  repaired = repaired.replace(/'/g, '"');

  return repaired;
}

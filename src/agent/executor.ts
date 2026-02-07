// Function call executor — executes tool calls and collects results

import { registry } from "../tools/registry.js";
import { logger } from "../core/logger.js";
import type { ToolResult, FunctionCall, FunctionResponse } from "../core/types.js";
import * as config from "../db/config.js";
import { LIMITS, LENGTHS } from "../core/constants.js";

/**
 * Execute a list of tool calls and collect their results
 * Handles output truncation and result formatting
 * 
 * @param calls - Array of function calls to execute
 * @returns Array of function responses with results
 * @throws Error if execution fails critically
 */
export async function executeToolCalls(
  calls: FunctionCall[]
): Promise<FunctionResponse[]> {
  const responses: FunctionResponse[] = [];

  for (const call of calls) {
    // Log the call with truncated arguments for readability
    const argsPreview = JSON.stringify(call.args).slice(0, LENGTHS.LOG_PREVIEW);
    logger.tool(call.name, `args: ${argsPreview}`);

    // Execute the tool
    const result = await registry.execute(call.name, call.args);

    // Truncate output if necessary (skip for image results)
    const truncatedResult = truncateResultIfNeeded(result);

    responses.push({ name: call.name, response: truncatedResult });

    // Log the result
    if (truncatedResult.success) {
      logger.tool(call.name, `✓ (${truncatedResult.executionTime ?? 0}ms)`);
    } else {
      logger.tool(call.name, `✗ ${truncatedResult.error}`);
    }
  }

  return responses;
}

/**
 * Truncate tool result output if it exceeds limits
 * Preserves images and doesn't truncate them
 * 
 * @param result - Tool execution result
 * @returns Result with truncated output if needed
 */
function truncateResultIfNeeded(result: ToolResult): ToolResult {
  // Skip truncation for results with images
  if (result.images && result.images.length > 0) {
    return result;
  }

  const maxChars = config.getNumber("max_output_chars") || LIMITS.OUTPUT_CHARS.DEFAULT;
  
  if (result.output.length > maxChars) {
    const truncated = result.output.slice(0, maxChars);
    const remaining = result.output.length - maxChars;
    
    return {
      ...result,
      output: `${truncated}\n... [truncated ${remaining} chars]`,
    };
  }

  return result;
}

/**
 * Execute a single tool call with error handling
 * Wraps errors in a proper ToolResult format
 * 
 * @param call - Function call to execute
 * @returns Function response with result or error
 */
export async function executeToolCall(
  call: FunctionCall
): Promise<FunctionResponse> {
  try {
    const result = await registry.execute(call.name, call.args);
    return { name: call.name, response: truncateResultIfNeeded(result) };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to execute tool ${call.name}: ${errorMessage}`);
    
    return {
      name: call.name,
      response: {
        success: false,
        output: "",
        error: `Execution failed: ${errorMessage}`,
      },
    };
  }
}

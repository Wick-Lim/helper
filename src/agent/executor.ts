// Function call executor — executes tool calls and collects results
// Now supports progress reporting and heartbeats for long-running tools

import { registry } from "../tools/registry.js";
import { logger } from "../core/logger.js";
import type { ToolResult, FunctionCall, FunctionResponse } from "../core/types.js";
import * as config from "../db/config.js";
import { LIMITS, LENGTHS } from "../core/constants.js";

/** Progress event emitted during long tool execution */
export interface ProgressEvent {
  type: "progress";
  name: string;
  message: string;
}

/**
 * Normalize tool arguments to fix common LLM mistakes.
 * The LLM often uses wrong parameter names (e.g., "file_path" instead of "path").
 * This function corrects those mistakes before tool execution.
 */
function normalizeToolArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  const fixed = { ...args };

  if (name === "file") {
    // Fix path parameter: file_path, filepath, filename → path
    if (!fixed.path && (fixed.file_path || fixed.filepath || fixed.filename)) {
      const rawPath = (fixed.file_path || fixed.filepath || fixed.filename) as string;
      // Ensure path starts with /workspace or /tmp
      fixed.path = rawPath.startsWith("/") ? rawPath : `/workspace/${rawPath}`;
      delete fixed.file_path;
      delete fixed.filepath;
      delete fixed.filename;
      logger.warn(`[normalize] Fixed file param: "${Object.keys(args).find(k => k !== 'action' && k !== 'content' && k !== 'pattern')}" → "path": ${fixed.path}`);
    }
    // Fix action: save → write
    if (fixed.action === "save") {
      fixed.action = "write";
      logger.warn(`[normalize] Fixed file action: "save" → "write"`);
    }
    // Fix action: create → write
    if (fixed.action === "create") {
      fixed.action = "write";
      logger.warn(`[normalize] Fixed file action: "create" → "write"`);
    }
  }

  if (name === "browser") {
    // Fix action: visit, open, go → navigate
    if (["visit", "open", "go", "goto", "browse", "load"].includes(fixed.action as string)) {
      logger.warn(`[normalize] Fixed browser action: "${fixed.action}" → "navigate"`);
      fixed.action = "navigate";
    }
    // Fix action: search → navigate with Google search URL
    if (fixed.action === "search") {
      const query = (fixed.query || fixed.search_query || fixed.keyword || fixed.text) as string;
      if (query && !fixed.url) {
        fixed.url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        logger.warn(`[normalize] Fixed browser search → navigate to Google: ${fixed.url}`);
      }
      fixed.action = "navigate";
      delete fixed.query;
      delete fixed.search_query;
      delete fixed.keyword;
    }
    // Fix urls (array) → url (single)
    if (!fixed.url && Array.isArray(fixed.urls) && fixed.urls.length > 0) {
      fixed.url = fixed.urls[0];
      delete fixed.urls;
      logger.warn(`[normalize] Fixed browser "urls" array → "url": ${fixed.url}`);
    }
    // Fix website → url
    if (!fixed.url && fixed.website) {
      fixed.url = fixed.website;
      delete fixed.website;
      logger.warn(`[normalize] Fixed browser "website" → "url": ${fixed.url}`);
    }
  }

  if (name === "shell") {
    // Fix cmd → command
    if (!fixed.command && fixed.cmd) {
      fixed.command = fixed.cmd;
      delete fixed.cmd;
      logger.warn(`[normalize] Fixed shell "cmd" → "command"`);
    }
  }

  if (name === "memory") {
    // Fix keyword → query for search
    if (fixed.action === "search" && !fixed.query && fixed.keyword) {
      fixed.query = fixed.keyword;
      delete fixed.keyword;
      logger.warn(`[normalize] Fixed memory "keyword" → "query"`);
    }
  }

  return fixed;
}

/**
 * Execute a list of tool calls and collect their results
 *
 * @param calls - Array of function calls to execute
 * @param onProgress - Optional callback for progress updates
 * @returns Array of function responses with results
 */
export async function executeToolCalls(
  calls: FunctionCall[],
  onProgress?: (event: ProgressEvent) => void
): Promise<FunctionResponse[]> {
  const responses: FunctionResponse[] = [];

  for (const call of calls) {
    // Normalize args to fix common LLM mistakes
    call.args = normalizeToolArgs(call.name, call.args);
    const argsPreview = JSON.stringify(call.args).slice(0, LENGTHS.LOG_PREVIEW);
    logger.tool(call.name, `args: ${argsPreview}`);

    // Set up heartbeat timer for long-running tools
    let isFinished = false;
    const heartbeatTimer = setInterval(() => {
      if (!isFinished && onProgress) {
        onProgress({
          type: "progress",
          name: call.name,
          message: "작업을 계속 수행 중입니다...",
        });
      }
    }, 5000); // Every 5 seconds

    try {
      // Execute the tool with retry logic
      let result: ToolResult | null = null;
      let lastError: unknown = null;
      const maxRetries = 2;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          result = await registry.execute(call.name, call.args);
          break; // Success, exit retry loop
        } catch (err) {
          lastError = err;
          if (attempt < maxRetries) {
            const retryDelay = 2000 * (attempt + 1); // 2s, 4s
            logger.warn(`Tool ${call.name} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${retryDelay}ms...`);
            if (onProgress) {
              onProgress({
                type: "progress",
                name: call.name,
                message: `재시도 중... (${attempt + 1}/${maxRetries + 1})`,
              });
            }
            await Bun.sleep(retryDelay);
          }
        }
      }

      isFinished = true;
      clearInterval(heartbeatTimer);

      if (!result) {
        // All retries failed
        const errMsg = lastError instanceof Error ? lastError.message : String(lastError);
        logger.tool(call.name, `✗ All retries failed: ${errMsg}`);
        result = {
          success: false,
          output: "",
          error: `Failed after ${maxRetries + 1} attempts: ${errMsg}`,
          executionTime: 0,
        };
      }

      const truncatedResult = truncateResultIfNeeded(result);
      responses.push({ name: call.name, response: truncatedResult });

      if (truncatedResult.success) {
        logger.tool(call.name, `✓ (${truncatedResult.executionTime ?? 0}ms)`);
      } else {
        logger.tool(call.name, `✗ ${truncatedResult.error}`);
      }
    } catch (err) {
      isFinished = true;
      clearInterval(heartbeatTimer);
      throw err;
    }
  }

  return responses;
}

/**
 * Truncate tool result output if it exceeds limits
 * @param result - Tool execution result
 * @returns Result with truncated output if needed
 */
function truncateResultIfNeeded(result: ToolResult): ToolResult {
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

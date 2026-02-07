// Function call executor — executes tool calls and collects results

import { registry } from "../tools/registry.js";
import { logger } from "../core/logger.js";
import type { ToolResult, FunctionCall, FunctionResponse } from "../core/types.js";
import * as config from "../db/config.js";

export async function executeToolCalls(
  calls: FunctionCall[]
): Promise<FunctionResponse[]> {
  const responses: FunctionResponse[] = [];

  for (const call of calls) {
    logger.tool(call.name, `args: ${JSON.stringify(call.args).slice(0, 200)}`);

    const result = await registry.execute(call.name, call.args);

    // Truncate output if necessary (skip for image results)
    if (!result.images || result.images.length === 0) {
      const maxChars = config.getNumber("max_output_chars") || 10000;
      if (result.output.length > maxChars) {
        result.output =
          result.output.slice(0, maxChars) +
          `\n... [truncated ${result.output.length - maxChars} chars]`;
      }
    }

    responses.push({ name: call.name, response: result });

    if (result.success) {
      logger.tool(call.name, `✓ (${result.executionTime ?? 0}ms)`);
    } else {
      logger.tool(call.name, `✗ ${result.error}`);
    }
  }

  return responses;
}

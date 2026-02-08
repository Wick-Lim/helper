// Wait tool — allows the agent to pause for a specified duration
// Useful for waiting for background processes, animations, or specific events

import type { Tool, ToolResult } from "../core/types.js";
import { registry } from "./registry.js";
import { logger } from "../core/logger.js";
import { TIMEOUTS } from "../core/constants.js";

const waitTool: Tool = {
  declaration: {
    name: "wait",
    description: "Pause execution for a specific amount of time. Use this when waiting for a website to load, a background process to finish, or before retrying a failed operation.",
    parameters: {
      type: "object",
      properties: {
        seconds: {
          type: "number",
          description: "Number of seconds to wait (1-60)",
        },
        reason: {
          type: "string",
          description: "Reason for waiting (e.g., 'Waiting for deployment to finish')",
        }
      },
      required: ["seconds"],
    },
  },

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const seconds = Math.min(Math.max(Number(args.seconds) || 1, 1), 60);
    const reason = (args.reason as string) || "No reason provided";

    logger.tool("wait", `Waiting for ${seconds}s. Reason: ${reason}`);

    await Bun.sleep(seconds * 1000);

    return {
      success: true,
      output: `Waited for ${seconds} seconds. Finished at ${new Date().toLocaleTimeString()}.`,
    };
  },
};

registry.register(waitTool);

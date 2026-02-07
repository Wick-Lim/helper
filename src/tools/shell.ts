// Shell command execution tool with timeout and SIGKILL fallback

import type { Tool, ToolResult } from "../core/types.js";
import { registry } from "./registry.js";
import { logger } from "../core/logger.js";
import * as config from "../db/config.js";

const MAX_OUTPUT = 10000;

const shellTool: Tool = {
  declaration: {
    name: "shell",
    description:
      "Execute a shell command. Use for system operations, file listing, git commands, package management, etc. Commands run in a bash shell with timeout protection.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute",
        },
        timeout_ms: {
          type: "number",
          description: "Timeout in milliseconds (default: 30000)",
        },
        working_directory: {
          type: "string",
          description: "Working directory for the command (default: /workspace)",
        },
      },
      required: ["command"],
    },
  },

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const command = args.command as string;
    const timeoutMs = (args.timeout_ms as number) ?? config.getNumber("tool_timeout_ms");
    const cwd = (args.working_directory as string) ?? process.cwd();

    logger.tool("shell", `$ ${command}`);

    try {
      const proc = Bun.spawn(["bash", "-c", command], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env },
      });

      // Timeout handling
      const timer = setTimeout(() => {
        proc.kill("SIGTERM");
        setTimeout(() => {
          try { proc.kill("SIGKILL"); } catch {}
        }, 3000);
      }, timeoutMs);

      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);

      const exitCode = await proc.exited;
      clearTimeout(timer);

      let output = stdout;
      if (stderr) {
        output += (output ? "\n" : "") + `STDERR: ${stderr}`;
      }

      // Truncate if necessary
      const maxChars = config.getNumber("max_output_chars") || MAX_OUTPUT;
      if (output.length > maxChars) {
        output = output.slice(0, maxChars) + `\n... [truncated ${output.length - maxChars} chars]`;
      }

      return {
        success: exitCode === 0,
        output,
        error: exitCode !== 0 ? `Exit code: ${exitCode}` : undefined,
      };
    } catch (err) {
      return {
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

registry.register(shellTool);

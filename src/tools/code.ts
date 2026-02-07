// Code execution tool — JavaScript/TypeScript/Python/Bash via temp files + subprocess

import type { Tool, ToolResult } from "../core/types.js";
import { registry } from "./registry.js";
import { logger } from "../core/logger.js";
import * as config from "../db/config.js";
import { join } from "path";

const LANG_CONFIG: Record<string, { ext: string; cmd: (file: string) => string[] }> = {
  javascript: { ext: ".js", cmd: (f) => ["bun", "run", f] },
  typescript: { ext: ".ts", cmd: (f) => ["bun", "run", f] },
  python: { ext: ".py", cmd: (f) => ["python3", f] },
  bash: { ext: ".sh", cmd: (f) => ["bash", f] },
};

const codeTool: Tool = {
  declaration: {
    name: "code",
    description:
      "Execute code in JavaScript, TypeScript, Python, or Bash. Code is written to a temp file and executed as a subprocess with timeout protection.",
    parameters: {
      type: "object",
      properties: {
        language: {
          type: "string",
          description: "Programming language",
          enum: ["javascript", "typescript", "python", "bash"],
        },
        code: {
          type: "string",
          description: "The code to execute",
        },
        timeout_ms: {
          type: "number",
          description: "Timeout in milliseconds (default: 60000)",
        },
      },
      required: ["language", "code"],
    },
  },

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const language = args.language as string;
    const code = args.code as string;
    const timeoutMs = (args.timeout_ms as number) ?? config.getNumber("code_timeout_ms");

    const langConf = LANG_CONFIG[language];
    if (!langConf) {
      return { success: false, output: "", error: `Unsupported language: ${language}` };
    }

    logger.tool("code", `Executing ${language} (${code.length} chars)`);

    // Write to temp file
    const tmpFile = join("/tmp/agent", `exec_${Date.now()}${langConf.ext}`);
    await Bun.write(tmpFile, code);

    try {
      const proc = Bun.spawn(langConf.cmd(tmpFile), {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env },
      });

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

      const maxChars = config.getNumber("max_output_chars") || 10000;
      if (output.length > maxChars) {
        output = output.slice(0, maxChars) + `\n... [truncated]`;
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
    } finally {
      // Cleanup temp file
      try {
        const { unlinkSync } = await import("fs");
        unlinkSync(tmpFile);
      } catch {}
    }
  },
};

registry.register(codeTool);

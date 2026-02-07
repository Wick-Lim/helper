// Shell command execution tool with timeout and SIGKILL fallback
// SECURITY: Blocks dangerous commands and restricts directory access

import type { Tool, ToolResult } from "../core/types.js";
import { registry } from "./registry.js";
import { logger } from "../core/logger.js";
import * as config from "../db/config.js";
import { resolve, normalize } from "path";

const MAX_OUTPUT = 10000;

// Allowed working directories (security boundary)
const ALLOWED_DIRECTORIES = ["/workspace", "/tmp/agent", "/tmp"];

// Dangerous command patterns to block
const DANGEROUS_PATTERNS = [
  // System destruction
  /rm\s+-[a-zA-Z]*rf\s+\//,
  />\s*\/dev\/null/,
  /:\(\)\s*\{\s*:\|:&\s*\};:/, // fork bomb
  /mkfs\.[a-z]+\s+/,
  /dd\s+if=.*of=\/dev\/[a-z]+/,
  // Network attacks
  /ping\s+-[a-zA-Z]*f\s+/,
  // Privilege escalation
  /sudo\s+/,
  /su\s+-/,
  // Dangerous file operations
  /chmod\s+-R?\s*777\s+\//,
  /chown\s+-R?\s+root/,
  // Shell escapes
  /`.*`/,
  /\$\(.*\)/,
  // Download and execute
  /curl.*\|\s*bash/,
  /wget.*\|\s*bash/,
  /curl.*\|\s*sh/,
  /wget.*\|\s*sh/,
];

// Sensitive environment variables to mask
const SENSITIVE_ENV_VARS = [
  "GEMINI_API_KEY",
  "TELEGRAM_TOKEN",
  "API_KEY",
  "TOKEN",
  "SECRET",
  "PASSWORD",
  "PRIVATE_KEY",
];

function validateCommand(command: string): { valid: boolean; reason?: string } {
  const normalizedCommand = command.trim().toLowerCase();

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(normalizedCommand)) {
      return {
        valid: false,
        reason: `Dangerous command pattern detected: ${pattern.source}`,
      };
    }
  }

  return { valid: true };
}

function validateWorkingDirectory(cwd: string): { valid: boolean; resolved: string; reason?: string } {
  const resolvedPath = normalize(resolve(cwd));

  const isAllowed = ALLOWED_DIRECTORIES.some((allowed) =>
    resolvedPath === allowed || resolvedPath.startsWith(allowed + "/")
  );

  if (!isAllowed) {
    return {
      valid: false,
      resolved: resolvedPath,
      reason: `Access denied: ${resolvedPath}. Allowed directories: ${ALLOWED_DIRECTORIES.join(", ")}`,
    };
  }

  return { valid: true, resolved: resolvedPath };
}

function maskSensitiveInfo(text: string): string {
  let masked = text;
  for (const envVar of SENSITIVE_ENV_VARS) {
    const value = process.env[envVar];
    if (value && value.length > 4) {
      const maskedValue = value.slice(0, 4) + "****";
      masked = masked.replace(new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), maskedValue);
    }
  }
  return masked;
}

function filterEnvironment(): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      if (SENSITIVE_ENV_VARS.some((sensitive) => key.toUpperCase().includes(sensitive))) {
        filtered[key] = "***REDACTED***";
      } else {
        filtered[key] = value;
      }
    }
  }
  return filtered;
}

const shellTool: Tool = {
  declaration: {
    name: "shell",
    description:
      "Execute a shell command. Use for system operations, file listing, git commands, package management, etc. Commands run in a bash shell with timeout protection. Restricted to /workspace and /tmp directories. Dangerous commands are blocked.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute",
        },
        timeout_ms: {
          type: "number",
          description: "Timeout in milliseconds (default: 30000, max: 300000)",
        },
        working_directory: {
          type: "string",
          description: "Working directory for the command (default: /workspace, allowed: /workspace, /tmp, /tmp/agent)",
        },
      },
      required: ["command"],
    },
  },

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const command = args.command as string;
    const timeoutMs = Math.min(
      (args.timeout_ms as number) ?? config.getNumber("tool_timeout_ms"),
      300000 // Max 5 minutes
    );
    const cwd = (args.working_directory as string) ?? "/workspace";

    // Validate command
    const commandCheck = validateCommand(command);
    if (!commandCheck.valid) {
      logger.warn(`Blocked dangerous command: ${maskSensitiveInfo(command)}`);
      return {
        success: false,
        output: "",
        error: `Security violation: ${commandCheck.reason}`,
      };
    }

    // Validate working directory
    const dirCheck = validateWorkingDirectory(cwd);
    if (!dirCheck.valid) {
      logger.warn(`Blocked directory access: ${cwd}`);
      return {
        success: false,
        output: "",
        error: dirCheck.reason,
      };
    }

    const safeCommand = maskSensitiveInfo(command);
    logger.tool("shell", `$ ${safeCommand}`);

    try {
      const proc = Bun.spawn(["bash", "-c", command], {
        cwd: dirCheck.resolved,
        stdout: "pipe",
        stderr: "pipe",
        env: filterEnvironment(),
      });

      // Timeout handling
      const timer = setTimeout(() => {
        proc.kill("SIGTERM");
        setTimeout(() => {
          try {
            proc.kill("SIGKILL");
          } catch {}
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

      // Mask sensitive info in output
      output = maskSensitiveInfo(output);

      // Truncate if necessary
      const maxChars = config.getNumber("max_output_chars") || MAX_OUTPUT;
      if (output.length > maxChars) {
        output =
          output.slice(0, maxChars) +
          `\n... [truncated ${output.length - maxChars} chars]`;
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

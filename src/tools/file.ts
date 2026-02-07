// File operations tool with path validation and security restrictions

import type { Tool, ToolResult } from "../core/types.js";
import { registry } from "./registry.js";
import { logger } from "../core/logger.js";
import { resolve, normalize, dirname } from "path";

// Allowed base directories for file operations
const ALLOWED_DIRECTORIES = ["/workspace", "/tmp", "/data/screenshots"];

// Blocked paths (security sensitive)
const BLOCKED_PATHS = [
  "/",
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/lib",
  "/lib64",
  "/proc",
  "/root",
  "/run",
  "/sbin",
  "/sys",
  "/usr",
  "/var",
  "/app",
  "/.dockerenv",
];

// Blocked file patterns
const BLOCKED_FILE_PATTERNS = [
  /\.env$/i,
  /\.pem$/i,
  /\.key$/i,
  /id_rsa/i,
  /id_dsa/i,
  /id_ecdsa/i,
  /id_ed25519/i,
  /\.htaccess$/i,
  /\.htpasswd$/i,
  /credentials/i,
  /secrets?/i,
  /password/i,
  /token/i,
  /api_key/i,
  /private/i,
];

// Maximum file size (50MB)
const MAX_FILE_SIZE = 50 * 1024 * 1024;

// Maximum files in list operation
const MAX_LIST_RESULTS = 500;

function validatePath(filePath: string): { valid: boolean; resolved: string; reason?: string } {
  try {
    const resolvedPath = normalize(resolve(filePath));

    // Check for blocked system paths
    for (const blocked of BLOCKED_PATHS) {
      if (resolvedPath === blocked || resolvedPath.startsWith(blocked + "/")) {
        return {
          valid: false,
          resolved: resolvedPath,
          reason: `Access denied: System directory "${blocked}" is protected`,
        };
      }
    }

    // Check if path is within allowed directories
    const isAllowed = ALLOWED_DIRECTORIES.some((allowed) =>
      resolvedPath === allowed || resolvedPath.startsWith(allowed + "/")
    );

    if (!isAllowed) {
      return {
        valid: false,
        resolved: resolvedPath,
        reason: `Access denied: Path must be within ${ALLOWED_DIRECTORIES.join(", ")}`,
      };
    }

    // Check for path traversal attempts
    if (filePath.includes("..") || filePath.includes("~")) {
      return {
        valid: false,
        resolved: resolvedPath,
        reason: "Access denied: Path traversal detected",
      };
    }

    // Check for blocked file patterns
    const lowerPath = resolvedPath.toLowerCase();
    for (const pattern of BLOCKED_FILE_PATTERNS) {
      if (pattern.test(lowerPath)) {
        return {
          valid: false,
          resolved: resolvedPath,
          reason: `Access denied: File pattern "${pattern.source}" is blocked`,
        };
      }
    }

    return { valid: true, resolved: resolvedPath };
  } catch (err) {
    return {
      valid: false,
      resolved: filePath,
      reason: `Invalid path: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function sanitizeGlobPattern(pattern: string): string {
  // Remove potentially dangerous glob patterns
  return pattern
    .replace(/\.\./g, "")
    .replace(/^\//, "")
    .replace(/\/+/g, "/");
}

async function ensureDirectoryExists(filePath: string): Promise<void> {
  const dir = dirname(filePath);
  const { mkdirSync } = await import("fs");
  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    // Directory might already exist
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
      throw err;
    }
  }
}

const fileTool: Tool = {
  declaration: {
    name: "file",
    description:
      "Read, write, append, list, delete, or send files. Restricted to /workspace and /tmp directories. Cannot access system directories or sensitive files.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "The file operation to perform",
          enum: ["read", "write", "append", "list", "delete", "exists", "stat", "send"],
        },
        path: {
          type: "string",
          description: "File or directory path (must be within /workspace or /tmp)",
        },
        content: {
          type: "string",
          description: "Content to write (for write/append actions)",
        },
        pattern: {
          type: "string",
          description: "Glob pattern for list action (default: *, max 500 results)",
        },
      },
      required: ["action", "path"],
    },
  },

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const action = args.action as string;
    const filePath = args.path as string;
    const content = args.content as string | undefined;
    const pattern = args.pattern as string | undefined;

    // Validate path
    const pathCheck = validatePath(filePath);
    if (!pathCheck.valid) {
      logger.warn(`Blocked file access: ${filePath} - ${pathCheck.reason}`);
      return {
        success: false,
        output: "",
        error: pathCheck.reason,
      };
    }

    const resolvedPath = pathCheck.resolved;
    logger.tool("file", `${action} ${resolvedPath}`);

    try {
      switch (action) {
        case "read": {
          const file = Bun.file(resolvedPath);
          if (!(await file.exists())) {
            return { success: false, output: "", error: `File not found: ${resolvedPath}` };
          }

          // Check file size
          if (file.size > MAX_FILE_SIZE) {
            return {
              success: false,
              output: "",
              error: `File too large: ${file.size} bytes (max: ${MAX_FILE_SIZE} bytes)`,
            };
          }

          const text = await file.text();
          const maxChars = 10000;
          if (text.length > maxChars) {
            return {
              success: true,
              output:
                text.slice(0, maxChars) + `\n... [truncated ${text.length - maxChars} chars]`,
            };
          }
          return { success: true, output: text };
        }

        case "write": {
          await ensureDirectoryExists(resolvedPath);
          await Bun.write(resolvedPath, content ?? "");
          return { success: true, output: `Written to ${resolvedPath}` };
        }

        case "append": {
          await ensureDirectoryExists(resolvedPath);
          const file = Bun.file(resolvedPath);
          const existing = (await file.exists()) ? await file.text() : "";
          await Bun.write(resolvedPath, existing + (content ?? ""));
          return { success: true, output: `Appended to ${resolvedPath}` };
        }

        case "list": {
          const sanitizedPattern = sanitizeGlobPattern(pattern ?? "*");
          const glob = new Bun.Glob(sanitizedPattern);
          const entries: string[] = [];

          // Validate list directory
          const dirCheck = validatePath(filePath);
          if (!dirCheck.valid) {
            return {
              success: false,
              output: "",
              error: dirCheck.reason,
            };
          }

          for await (const entry of glob.scan({ cwd: dirCheck.resolved, onlyFiles: false })) {
            // Validate each entry path
            const entryPath = resolve(dirCheck.resolved, entry);
            if (validatePath(entryPath).valid) {
              entries.push(entry);
              if (entries.length >= MAX_LIST_RESULTS) {
                entries.push(`...(truncated at ${MAX_LIST_RESULTS} items)`);
                break;
              }
            }
          }

          return { success: true, output: entries.join("\n") || "(empty directory)" };
        }

        case "delete": {
          const file = Bun.file(resolvedPath);
          if (!(await file.exists())) {
            return { success: false, output: "", error: `File not found: ${resolvedPath}` };
          }

          // Prevent directory deletion
          const { statSync } = await import("fs");
          const stats = statSync(resolvedPath);
          if (stats.isDirectory()) {
            return {
              success: false,
              output: "",
              error: "Cannot delete directories. Use shell tool with rm -r instead.",
            };
          }

          const { unlinkSync } = await import("fs");
          unlinkSync(resolvedPath);
          return { success: true, output: `Deleted ${resolvedPath}` };
        }

        case "exists": {
          const exists = await Bun.file(resolvedPath).exists();
          return { success: true, output: String(exists) };
        }

        case "stat": {
          const file = Bun.file(resolvedPath);
          if (!(await file.exists())) {
            return { success: false, output: "", error: `File not found: ${resolvedPath}` };
          }

          const { statSync } = await import("fs");
          const stats = statSync(resolvedPath);

          return {
            success: true,
            output: JSON.stringify({
              size: file.size,
              type: file.type,
              isDirectory: stats.isDirectory(),
              isFile: stats.isFile(),
              modified: stats.mtime.toISOString(),
            }),
          };
        }

        case "send": {
          const file = Bun.file(resolvedPath);
          if (!(await file.exists())) {
            return { success: false, output: "", error: `File not found: ${resolvedPath}` };
          }

          if (file.size > MAX_FILE_SIZE) {
            return {
              success: false,
              output: "",
              error: `File too large: ${file.size} bytes (max: ${MAX_FILE_SIZE} bytes)`,
            };
          }

          const ext = resolvedPath.split(".").pop()?.toLowerCase() || "";
          const mimeMap: Record<string, string> = {
            mp4: "video/mp4",
            webm: "video/webm",
            avi: "video/x-msvideo",
            mkv: "video/x-matroska",
            mov: "video/quicktime",
            mp3: "audio/mpeg",
            wav: "audio/wav",
            ogg: "audio/ogg",
            m4a: "audio/mp4",
            pdf: "application/pdf",
            zip: "application/zip",
            tar: "application/x-tar",
            gz: "application/gzip",
            png: "image/png",
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            gif: "image/gif",
            webp: "image/webp",
            json: "application/json",
            csv: "text/csv",
            txt: "text/plain",
          };
          const mimeType = mimeMap[ext] || "application/octet-stream";

          return {
            success: true,
            output: `File ready to send: ${resolvedPath} (${mimeType}, ${file.size} bytes)`,
            files: [{ path: resolvedPath, mimeType }],
          };
        }

        default:
          return { success: false, output: "", error: `Unknown action: ${action}` };
      }
    } catch (err) {
      return {
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

registry.register(fileTool);

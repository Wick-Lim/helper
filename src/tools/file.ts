// File operations tool — unrestricted inside Docker container

import type { Tool, ToolResult } from "../core/types.js";
import { registry } from "./registry.js";
import { logger } from "../core/logger.js";


const fileTool: Tool = {
  declaration: {
    name: "file",
    description:
      "Read, write, append, list, delete, or send files. Use 'send' action to deliver files (video, audio, documents) to the user via Telegram.",
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
          description: "File or directory path",
        },
        content: {
          type: "string",
          description: "Content to write (for write/append actions)",
        },
        pattern: {
          type: "string",
          description: "Glob pattern for list action (default: *)",
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

    logger.tool("file", `${action} ${filePath}`);

    try {
      switch (action) {
        case "read": {
          const file = Bun.file(filePath);
          if (!(await file.exists())) {
            return { success: false, output: "", error: `File not found: ${filePath}` };
          }
          const text = await file.text();
          const maxChars = 10000;
          if (text.length > maxChars) {
            return {
              success: true,
              output: text.slice(0, maxChars) + `\n... [truncated ${text.length - maxChars} chars]`,
            };
          }
          return { success: true, output: text };
        }

        case "write": {
          await Bun.write(filePath, content ?? "");
          return { success: true, output: `Written to ${filePath}` };
        }

        case "append": {
          const file = Bun.file(filePath);
          const existing = (await file.exists()) ? await file.text() : "";
          await Bun.write(filePath, existing + (content ?? ""));
          return { success: true, output: `Appended to ${filePath}` };
        }

        case "list": {
          const glob = new Bun.Glob(pattern ?? "*");
          const entries: string[] = [];
          for await (const entry of glob.scan({ cwd: filePath, onlyFiles: false })) {
            entries.push(entry);
            if (entries.length >= 200) break;
          }
          return { success: true, output: entries.join("\n") || "(empty directory)" };
        }

        case "delete": {
          const { unlinkSync } = await import("fs");
          unlinkSync(filePath);
          return { success: true, output: `Deleted ${filePath}` };
        }

        case "exists": {
          const exists = await Bun.file(filePath).exists();
          return { success: true, output: String(exists) };
        }

        case "stat": {
          const file = Bun.file(filePath);
          if (!(await file.exists())) {
            return { success: false, output: "", error: `File not found: ${filePath}` };
          }
          return {
            success: true,
            output: JSON.stringify({
              size: file.size,
              type: file.type,
            }),
          };
        }

        case "send": {
          const file = Bun.file(filePath);
          if (!(await file.exists())) {
            return { success: false, output: "", error: `File not found: ${filePath}` };
          }
          const ext = filePath.split(".").pop()?.toLowerCase() || "";
          const mimeMap: Record<string, string> = {
            mp4: "video/mp4", webm: "video/webm", avi: "video/x-msvideo", mkv: "video/x-matroska", mov: "video/quicktime",
            mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4",
            pdf: "application/pdf", zip: "application/zip", tar: "application/x-tar", gz: "application/gzip",
            png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
            json: "application/json", csv: "text/csv", txt: "text/plain",
          };
          const mimeType = mimeMap[ext] || "application/octet-stream";
          return {
            success: true,
            output: `File ready to send: ${filePath} (${mimeType}, ${file.size} bytes)`,
            files: [{ path: filePath, mimeType }],
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

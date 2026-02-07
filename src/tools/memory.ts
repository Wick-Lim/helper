// Memory tool — wraps db/memory.ts for agent access

import type { Tool, ToolResult } from "../core/types.js";
import { registry } from "./registry.js";
import { logger } from "../core/logger.js";
import * as memory from "../db/memory.js";

const memoryTool: Tool = {
  declaration: {
    name: "memory",
    description:
      "Store, retrieve, search, list, and delete persistent memories. Memories survive across sessions and are used to build context for future interactions.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "Memory operation to perform",
          enum: ["save", "get", "search", "list", "delete"],
        },
        key: {
          type: "string",
          description: "Memory key (for save/get/delete)",
        },
        value: {
          type: "string",
          description: "Memory value (for save)",
        },
        category: {
          type: "string",
          description: "Category for organization (for save/list)",
        },
        importance: {
          type: "number",
          description: "Importance 1-10 (for save, default: 5)",
        },
        query: {
          type: "string",
          description: "Search query (for search)",
        },
      },
      required: ["action"],
    },
  },

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const action = args.action as string;
    const key = args.key as string | undefined;
    const value = args.value as string | undefined;
    const category = args.category as string | undefined;
    const importance = args.importance as number | undefined;
    const query = args.query as string | undefined;

    logger.tool("memory", `${action}${key ? ` key=${key}` : ""}${query ? ` query=${query}` : ""}`);

    try {
      switch (action) {
        case "save": {
          if (!key || !value) {
            return { success: false, output: "", error: "key and value are required for save" };
          }
          memory.saveMemory(key, value, category ?? "general", importance ?? 5);
          return { success: true, output: `Saved memory: ${key}` };
        }

        case "get": {
          if (!key) {
            return { success: false, output: "", error: "key is required for get" };
          }
          const row = memory.getMemory(key);
          if (!row) {
            return { success: true, output: `No memory found for key: ${key}` };
          }
          return {
            success: true,
            output: JSON.stringify({
              key: row.key,
              value: row.value,
              category: row.category,
              importance: row.importance,
              access_count: row.access_count,
              updated_at: row.updated_at,
            }, null, 2),
          };
        }

        case "search": {
          const results = memory.searchMemory(query ?? "", 10);
          if (results.length === 0) {
            return { success: true, output: "No memories found." };
          }
          const formatted = results.map(
            (r) => `[${r.category}] ${r.key}: ${r.value} (importance: ${r.importance})`
          );
          return { success: true, output: formatted.join("\n") };
        }

        case "list": {
          const results = memory.listMemory(category, 50);
          if (results.length === 0) {
            return { success: true, output: "No memories stored." };
          }
          const formatted = results.map(
            (r) => `[${r.category}] ${r.key}: ${r.value.slice(0, 100)}`
          );
          return { success: true, output: formatted.join("\n") };
        }

        case "delete": {
          if (!key) {
            return { success: false, output: "", error: "key is required for delete" };
          }
          const deleted = memory.deleteMemory(key);
          return {
            success: true,
            output: deleted ? `Deleted memory: ${key}` : `No memory found for key: ${key}`,
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

registry.register(memoryTool);

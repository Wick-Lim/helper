// Tool registry — registration, lookup, and Gemini format conversion

import type { Tool, ToolDeclaration, ToolResult } from "../core/types.js";
import { logger } from "../core/logger.js";

class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.declaration.name, tool);
    logger.debug(`Tool registered: ${tool.declaration.name}`);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  async execute(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        output: "",
        error: `Unknown tool: ${name}`,
      };
    }

    const start = Date.now();
    try {
      const result = await tool.execute(args);
      result.executionTime = Date.now() - start;
      return result;
    } catch (err) {
      return {
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
        executionTime: Date.now() - start,
      };
    }
  }

  getDeclarations(): ToolDeclaration[] {
    return Array.from(this.tools.values()).map((t) => t.declaration);
  }

  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  size(): number {
    return this.tools.size;
  }
}

// Singleton registry
export const registry = new ToolRegistry();

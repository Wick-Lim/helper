// Slash commands — /help, /memory, /history, /config, /tools, /clear, /exit

import * as memory from "../db/memory.js";
import * as tasks from "../db/tasks.js";
import * as dbConfig from "../db/config.js";
import { registry } from "../tools/registry.js";
import {
  renderInfo,
  renderTable,
  renderError,
  renderWarning,
} from "./render.js";

export interface CommandResult {
  handled: boolean;
  shouldExit?: boolean;
}

export function handleCommand(
  input: string,
  sessionId: string
): CommandResult {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return { handled: false };

  const [cmd, ...args] = trimmed.slice(1).split(/\s+/);
  const arg = args.join(" ");

  switch (cmd) {
    case "help":
      renderInfo(`
Available Commands:
  /help              - Show this help message
  /tools             - List available tools
  /memory [query]    - Search memories (or list all)
  /history           - Show recent task history
  /config [key=val]  - View or set configuration
  /clear             - Clear conversation history
  /exit, /quit       - Exit the agent
`);
      return { handled: true };

    case "tools":
      const toolDecls = registry.getDeclarations();
      const toolRows = toolDecls.map((t) => [
        t.name,
        t.description.slice(0, 60),
        Object.keys(t.parameters.properties).join(", "),
      ]);
      renderTable(["Name", "Description", "Parameters"], toolRows);
      return { handled: true };

    case "memory":
      if (arg) {
        const results = memory.searchMemory(arg, 10);
        if (results.length === 0) {
          renderInfo("No memories found.");
        } else {
          const rows = results.map((r) => [
            r.category,
            r.key,
            r.value.slice(0, 50),
            String(r.importance),
          ]);
          renderTable(["Category", "Key", "Value", "Imp"], rows);
        }
      } else {
        const results = memory.listMemory(undefined, 20);
        if (results.length === 0) {
          renderInfo("No memories stored.");
        } else {
          const rows = results.map((r) => [
            r.category,
            r.key,
            r.value.slice(0, 50),
            String(r.importance),
          ]);
          renderTable(["Category", "Key", "Value", "Imp"], rows);
        }
      }
      return { handled: true };

    case "history":
      const recentTasks = tasks.getRecentTasks(sessionId, 10);
      if (recentTasks.length === 0) {
        renderInfo("No task history.");
      } else {
        const rows = recentTasks.map((t) => [
          String(t.id),
          t.status,
          t.description.slice(0, 40),
          String(t.iterations),
          t.created_at,
        ]);
        renderTable(["ID", "Status", "Description", "Iter", "Created"], rows);
      }
      return { handled: true };

    case "config":
      if (arg && arg.includes("=")) {
        const [key, ...valParts] = arg.split("=");
        const value = valParts.join("=");
        dbConfig.set(key.trim(), value.trim());
        renderInfo(`Config set: ${key.trim()} = ${value.trim()}`);
      } else {
        const all = dbConfig.getAll();
        const rows = Object.entries(all).map(([k, v]) => [k, v]);
        renderTable(["Key", "Value"], rows);
      }
      return { handled: true };

    case "clear":
      console.clear();
      renderInfo("Conversation cleared.");
      return { handled: true };

    case "exit":
    case "quit":
      return { handled: true, shouldExit: true };

    default:
      renderWarning(`Unknown command: /${cmd}. Type /help for available commands.`);
      return { handled: true };
  }
}

// Task planner — context assembly from memory and task history

import { buildSystemPrompt } from "./prompts.js";
import { buildMemoryContext } from "../db/memory.js";
import { getRecentTasks } from "../db/tasks.js";
import { registry } from "../tools/registry.js";

export function assembleContext(
  userMessage: string,
  sessionId: string
): string {
  // Get memory context relevant to the user's message
  const memoryContext = buildMemoryContext(userMessage);

  // Get recent task history
  const recentTasks = getRecentTasks(sessionId, 5);
  const taskHistory = recentTasks.length > 0
    ? recentTasks
        .map(
          (t) =>
            `[${t.status}] ${t.description}${t.result ? `: ${t.result.slice(0, 100)}` : ""}`
        )
        .join("\n")
    : undefined;

  // Build system prompt with context
  return buildSystemPrompt({
    tools: registry.getDeclarations(),
    memoryContext: memoryContext || undefined,
    taskHistory,
  });
}

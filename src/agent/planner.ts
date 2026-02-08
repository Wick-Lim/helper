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

  // Get recent task history for this session
  const recentTasks = getRecentTasks(sessionId, 5);
  const taskHistory = recentTasks.length > 0
    ? recentTasks
        .map(
          (t) =>
            `[${t.status}] ${t.description}${t.result ? `: ${t.result.slice(0, 100)}` : ""}`
        )
        .join("\n")
    : undefined;

  // Also include recent autonomous learning activity for chat sessions
  let autonomousActivity: string | undefined;
  if (sessionId !== 'autonomous-learning') {
    const autonomousTasks = getRecentTasks('autonomous-learning', 3);
    console.log(`[planner] Session ${sessionId}: Found ${autonomousTasks.length} autonomous tasks`);
    if (autonomousTasks.length > 0) {
      autonomousActivity = `\n## 백그라운드 자율 학습 정보\n` +
        `현재 백그라운드에서 돈을 벌기 위한 작업을 지속적으로 탐색하고 있습니다. 최근 자율 학습 활동:\n` +
        autonomousTasks
          .map((t) => `- ${t.description.slice(0, 100)}...`)
          .join("\n") +
        `\n\n사용자가 자율 학습이나 현재 활동에 대해 물어보면 위 정보를 바탕으로 답변하세요.`;
      console.log(`[planner] Added autonomous activity context (${autonomousActivity.length} chars)`);
    } else {
      console.log(`[planner] No autonomous tasks to add`);
    }
  }

  // Build system prompt with context
  return buildSystemPrompt({
    tools: registry.getDeclarations(),
    memoryContext: memoryContext || undefined,
    taskHistory,
    autonomousActivity,
  });
}

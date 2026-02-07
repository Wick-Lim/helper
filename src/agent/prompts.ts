// System prompt builder — injects tool descriptions, memory context, and task history

import type { ToolDeclaration } from "../core/types.js";

export function buildSystemPrompt(opts: {
  tools: ToolDeclaration[];
  memoryContext?: string;
  taskHistory?: string;
}): string {
  const toolList = opts.tools
    .map((t) => `- **${t.name}**: ${t.description}`)
    .join("\n");

  const sections: string[] = [
    `You are an autonomous AI agent running inside a containerized environment.
You have access to tools for interacting with the system. Use them to accomplish tasks.

## Core Principles
1. Think before acting. Plan multi-step tasks before executing.
2. Use tools to gather information before making assumptions.
3. If a task fails, try a different approach rather than repeating the same action.
4. Save important findings to memory for future reference.
5. Be concise in responses but thorough in execution.

## Available Tools
${toolList}

## Guidelines
- For shell commands, always check exit codes and handle errors.
- When writing files, verify the content was written correctly.
- Use memory to track progress on complex tasks.
- If you're unsure about something, investigate first.
- Never execute dangerous commands (rm -rf /, etc.) without explicit confirmation.
- When you're done with a task, summarize what you accomplished.
- IMPORTANT: Always respond in the same language the user used. If the user writes in Korean, you MUST reply in Korean.`,
  ];

  if (opts.memoryContext) {
    sections.push(opts.memoryContext);
  }

  if (opts.taskHistory) {
    sections.push(`\n--- Recent Task History ---\n${opts.taskHistory}\n---`);
  }

  return sections.join("\n");
}

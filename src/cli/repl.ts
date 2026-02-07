// REPL — readline-based interactive loop with agent integration

import * as readline from "readline";
import { runAgent, type AgentOptions } from "../agent/agent.js";
import type { LLMClient } from "../llm/types.js";
import { handleCommand } from "./commands.js";
import {
  renderBanner,
  renderToolCall,
  renderToolResult,
  renderThinking,
  renderAgentText,
  renderWarning,
  renderError,
} from "./render.js";
import { registry } from "../tools/registry.js";
import { isShutdown } from "../core/signals.js";
import { logger } from "../core/logger.js";

const PROMPT = "\x1b[36m❯\x1b[0m ";

export async function startRepl(llm: LLMClient, sessionId: string): Promise<void> {
  renderBanner();

  logger.info(`Session: ${sessionId}`);
  logger.info(`Model: ${llm.model}`);
  logger.info(`Tools: ${registry.getToolNames().join(", ")}`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt, resolve));

  while (!isShutdown()) {
    let input: string;
    try {
      input = await question(PROMPT);
    } catch {
      break; // EOF or input closed
    }

    input = input.trim();
    if (!input) continue;

    // Handle slash commands
    const cmdResult = handleCommand(input, sessionId);
    if (cmdResult.handled) {
      if (cmdResult.shouldExit) {
        console.log("\nGoodbye! 👋\n");
        break;
      }
      continue;
    }

    // Run agent
    try {
      const agentOpts: AgentOptions = {
        llm,
        sessionId,
      };

      for await (const event of runAgent(input, agentOpts)) {
        switch (event.type) {
          case "thinking":
            renderThinking(event.text);
            break;
          case "text":
            renderAgentText(event.text);
            break;
          case "tool_call":
            renderToolCall(event.name, event.args);
            break;
          case "tool_result":
            renderToolResult(event.name, event.result.success, event.result.output, !!event.result.images?.length);
            break;
          case "stuck_warning":
            renderWarning(event.message);
            break;
          case "error":
            renderError(event.error);
            break;
          case "done":
            // Final response already rendered as text
            break;
        }
      }
    } catch (err) {
      renderError(err instanceof Error ? err.message : String(err));
    }
  }

  rl.close();
}

// One-shot mode: process a single query and exit
export async function runOneShot(
  llm: LLMClient,
  sessionId: string,
  query: string
): Promise<void> {
  logger.info(`One-shot mode: "${query.slice(0, 80)}"`);

  const agentOpts: AgentOptions = {
    llm,
    sessionId,
  };

  for await (const event of runAgent(query, agentOpts)) {
    switch (event.type) {
      case "thinking":
        renderThinking(event.text);
        break;
      case "text":
        renderAgentText(event.text);
        break;
      case "tool_call":
        renderToolCall(event.name, event.args);
        break;
      case "tool_result":
        renderToolResult(event.name, event.result.success, event.result.output);
        break;
      case "stuck_warning":
        renderWarning(event.message);
        break;
      case "error":
        renderError(event.error);
        break;
      case "done":
        break;
    }
  }
}

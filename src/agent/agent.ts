// ReAct loop core — LLM call → tool execution → result → repeat until done

import type { LLMClient, ChatParams, ChatResponse } from "../llm/types.js";
import type { ChatMessage, AgentEvent, FunctionCall, ImageData } from "../core/types.js";
import { StuckDetector } from "./stuck-detector.js";
import { executeToolCalls } from "./executor.js";
import { assembleContext } from "./planner.js";
import { registry } from "../tools/registry.js";
import { logger } from "../core/logger.js";
import { isShutdown } from "../core/signals.js";
import * as tasks from "../db/tasks.js";
import * as config from "../db/config.js";
import { StuckError } from "../core/errors.js";

export interface AgentOptions {
  llm: LLMClient;
  sessionId: string;
  images?: ImageData[];
  maxIterations?: number;
  thinkingBudget?: number;
  signal?: AbortSignal;
}

export async function* runAgent(
  userMessage: string,
  options: AgentOptions
): AsyncGenerator<AgentEvent> {
  const { llm, sessionId, signal } = options;
  const maxIterations = options.maxIterations ?? config.getNumber("max_iterations");
  const thinkingBudget = options.thinkingBudget ?? config.getNumber("thinking_budget");

  const detector = new StuckDetector(maxIterations);

  // Create task record
  const taskId = tasks.createTask(sessionId, userMessage);

  // Assemble system prompt with context
  const systemPrompt = assembleContext(userMessage, sessionId);

  // Load conversation history and build messages
  const history = tasks.getConversationHistory(sessionId);
  const messages: ChatMessage[] = [
    ...history.map(h => ({ role: h.role as "user" | "model", content: h.content })),
    { role: "user", content: userMessage, images: options.images },
  ];

  try {
    while (!isShutdown() && !signal?.aborted) {
      tasks.incrementIterations(taskId);

      // Call LLM
      const response: ChatResponse = await llm.chat({
        messages,
        tools: registry.getDeclarations(),
        systemPrompt,
        thinkingBudget,
        temperature: Number(config.get("temperature") ?? 0.7),
      });

      // Emit thinking
      if (response.thinking) {
        logger.thinking(response.thinking.slice(0, 200));
        yield { type: "thinking", text: response.thinking };
      }

      // Emit text response
      if (response.text) {
        logger.agent(response.text.slice(0, 200));
        yield { type: "text", text: response.text };
      }

      // If no function calls, we're done
      if (!response.functionCalls || response.functionCalls.length === 0) {
        const summary = response.text ?? "Task completed.";
        tasks.completeTask(taskId, summary.slice(0, 500));

        // Save conversation
        tasks.saveConversation(sessionId, "user", userMessage);
        tasks.saveConversation(sessionId, "model", summary);

        yield { type: "done", summary };
        return;
      }

      // Add model's function call message to conversation
      messages.push({
        role: "model",
        content: "",
        functionCalls: response.functionCalls,
      });

      // Execute function calls
      for (const fc of response.functionCalls) {
        yield { type: "tool_call", name: fc.name, args: fc.args };

        // Record for stuck detection
        detector.record(fc.name, JSON.stringify(fc.args));
      }

      const functionResponses = await executeToolCalls(response.functionCalls);

      // Check abort after tool execution
      if (signal?.aborted) break;

      // Emit results
      for (const fr of functionResponses) {
        yield { type: "tool_result", name: fr.name, result: fr.response };

        // Log tool call to DB (exclude base64 image data)
        const outputForLog = fr.response.images
          ? `[screenshot: ${fr.response.images.length} image(s)]`
          : fr.response.output.slice(0, 2000);
        tasks.logToolCall(
          taskId,
          fr.name,
          JSON.stringify(response.functionCalls.find((fc) => fc.name === fr.name)?.args ?? {}),
          outputForLog,
          fr.response.success,
          fr.response.executionTime ?? 0
        );
      }

      // Add function responses to conversation
      messages.push({
        role: "user",
        content: "",
        functionResponses,
      });

      // Check stuck detection
      const stuckCheck = detector.check();
      if (stuckCheck.isStuck) {
        if (stuckCheck.shouldTerminate) {
          tasks.markStuck(taskId, stuckCheck.message ?? "Stuck");
          yield { type: "stuck_warning", message: stuckCheck.message! };
          yield {
            type: "error",
            error: stuckCheck.message!,
          };
          throw new StuckError(stuckCheck.message!, detector.getIteration());
        }

        // Inject warning into conversation
        yield { type: "stuck_warning", message: stuckCheck.message! };
        messages.push({
          role: "user",
          content: `[SYSTEM WARNING] ${stuckCheck.message}`,
        });
      }
    }

    // Shutdown or abort requested
    const reason = signal?.aborted ? "Client disconnected" : "Shutdown requested";
    tasks.failTask(taskId, reason);
    yield { type: "done", summary: `Agent stopped: ${reason}.` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    tasks.failTask(taskId, msg);
    yield { type: "error", error: msg };
  }
}

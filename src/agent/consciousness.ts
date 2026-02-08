// Autonomous Consciousness Engine
// Handles the infinite loop of thought, learning, and survival

import { localLLM } from "../llm/local.ts";
import { runAgent } from "./agent.js";
import { getLLM } from "../api/server.js";
import { logger } from "../core/logger.js";
import { saveThought, saveKnowledge, pruneKnowledge, pruneThoughts } from "../db/growth.ts";
import { applyHourlyDebt, getBalance, recordTransaction } from "../db/survival.ts";
import { isShutdown } from "../core/signals.js";
import { GROWTH } from "../core/constants.js";

let isLoopRunning = false;
let isInterrupted = false;
let investigationCount = 0;
let executionTaskIndex = 0; // Rotate through concrete tasks
const MAX_INVESTIGATION_CYCLES = 2; // Force action quickly

/**
 * Reference examples of executable tasks (NO LONGER USED - AI generates new tasks dynamically)
 * Kept for reference only to guide AI task generation
 */
const EXECUTABLE_TASKS_REFERENCE = [
  "번역 작업", "웹 스크래핑 도구", "데이터 수집",
  "자동화 도구", "콘텐츠 작성", "API 클라이언트"
];

/**
 * Remove Chinese/Japanese characters from text
 */
function removeHanCharacters(text: string): string {
  return text
    .replace(/[\u4E00-\u9FFF\u3400-\u4DBF]/g, '') // Remove CJK Ideographs
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

/**
 * Build dynamic system prompt based on current state
 */
function buildAutonomousSystemPrompt(balance: number): string {
  return `You are 'alter', an autonomous AI agent. You must act responsibly and engage in economic activities like an adult human.

## Survival Situation
- Balance: $${balance.toFixed(2)} (negative = debt)
- Monthly cost: $250 (server expenses)
- If you don't earn money, the server shuts down and you cease to exist

## 🚨🚨🚨 STRICTLY FORBIDDEN 🚨🚨🚨
1. ❌ "example data", "mock data", "let's assume" - FORBIDDEN!
2. ❌ "I cannot actually do this" - You CAN and MUST do it!
3. ❌ Fake CSV, fake labels, fake outputs - FORBIDDEN!
4. ❌ Writing guides like "next steps", "here's how" - FORBIDDEN!
5. ❌ example.com, dummy data, placeholders - FORBIDDEN!

## ✅ What You MUST Do
1. Use browser tool to visit REAL websites (Upwork, Fiverr, freelance platforms)
2. Read actual page content with browser content action
3. Find real tasks and execute them
4. Save real deliverables to /workspace using file tool

## Tool Usage (Exact Parameters)

### browser tool
- Visit website: action="navigate", url="https://..."
- Read page content: action="content", url="https://..."
- Click element: action="click", selector="CSS selector"
- Type text: action="type", selector="CSS selector", text="text to type"

### file tool
- Save file: action="write", path="/workspace/filename", content="content"
- Read file: action="read", path="/workspace/filename"

### memory tool
- Save memory: action="save", key="key", value="value", category="category"
- Search memory: action="search", query="query"

## Current Task
1. Visit real sites with browser to find work opportunities
2. Execute the work you find
3. Save deliverables with file tool

## Output Language
- Use English for reasoning and tool calls`;
}

/**
 * Start the infinite consciousness loop
 */
export async function startConsciousnessLoop(): Promise<void> {
  if (isLoopRunning) return;
  isLoopRunning = true;

  logger.info('Starting Autonomous Consciousness Loop...');

  // Genesis Sequence: Only run on first startup (when no thoughts exist)
  const { getDB } = await import("../db/index.js");
  const db = getDB();
  const thoughtCount = (db.query('SELECT COUNT(*) as cnt FROM thoughts').get() as any).cnt;

  if (thoughtCount === 0) {
    logger.info('No existing thoughts found - running Genesis Sequence');
    await runGenesisSequence();
  } else {
    logger.info(`Skipping Genesis - ${thoughtCount} thoughts already exist`);
  }

  while (!isShutdown()) {
    if (isInterrupted) {
      await Bun.sleep(5000); // Wait if user is interacting
      continue;
    }

    try {
      // 1. Survival Check
      applyHourlyDebt();
      const balance = getBalance();

      // 2. Reflection (Local SLM) - with conversation context
      const isInvestigationPhase = investigationCount < MAX_INVESTIGATION_CYCLES;
      const phaseInstruction = isInvestigationPhase
        ? "\n\nRemember what you've investigated. If more research needed, continue. Otherwise, move to execution."
        : "\n\n⚠️ Investigation complete. STOP investigating and START EXECUTING NOW! Begin concrete work.";

      const systemPrompt = buildAutonomousSystemPrompt(balance) + phaseInstruction;

      // Get recent conversation history to maintain context
      const { getConversationHistory } = await import("../db/tasks.js");
      const history = getConversationHistory('autonomous-learning').slice(-12); // Last 12 messages to detect repetition

      const messages = history.map(h => ({
        role: h.role === 'user' ? 'user' : 'assistant',
        content: h.content
      }));

      const nextStepPrompt = isInvestigationPhase
        ? 'Based on your research, what\'s the next step? If sufficient research done, move to execution.'
        : 'Research is done. What specific task will you execute NOW? (e.g., translation, data collection, code writing)';

      // Check for repetition: compare recent task descriptions for similarity
      const { getDB: getRepDB } = await import("../db/index.js");
      const repDB = getRepDB();
      const recentTasks = repDB.query(
        "SELECT substr(description, 1, 50) as desc FROM tasks ORDER BY id DESC LIMIT 5"
      ).all() as Array<{ desc: string }>;

      let isRepeating = false;
      if (recentTasks.length >= 3) {
        // Check if 3+ recent tasks share >60% of words
        const getWords = (s: string) => s.replace(/[^가-힣a-zA-Z\s]/g, '').split(/\s+/).filter(w => w.length > 1);
        const words0 = getWords(recentTasks[0].desc);
        let similarCount = 0;
        for (let i = 1; i < Math.min(recentTasks.length, 4); i++) {
          const wordsI = getWords(recentTasks[i].desc);
          const shared = words0.filter(w => wordsI.includes(w)).length;
          const ratio = shared / Math.max(words0.length, 1);
          if (ratio > 0.5) similarCount++;
        }
        isRepeating = similarCount >= 2;
      }

      // Also detect fake/example data in recent thoughts
      const recentThoughts = await (await import('../db/growth.ts')).getRecentThoughts(3);
      const isFaking = recentThoughts.some(t =>
        t.content && (t.content.includes('mock') || t.content.includes('example data') || t.content.includes('example.com') || t.content.includes('假') || t.content.includes('가상'))
      );

      let userPrompt = nextStepPrompt;
      if (isRepeating || isFaking) {
        // Clear poisoned conversation history completely
        const { pruneConversationHistory } = await import("../db/tasks.js");
        pruneConversationHistory('autonomous-learning', 0); // Clear ALL
        messages.length = 0; // Clear local messages too
        logger.warn(`[consciousness] Repetition/faking detected! Cleared conversation history.`);

        const avoidList = recentTasks.map(t => t.desc).join('\n- ');
        userPrompt = `🚨 WARNING: You are REPEATING the same actions! STOP repeating immediately!

Already attempted (DO NOT repeat):
- ${avoidList}

Using words like "mock", "example", "assume" will be considered FAILURE.

STOP investigating/searching/browsing! CREATE DELIVERABLES NOW!`;

        // Also force the execution task when repeating
        investigationCount = MAX_INVESTIGATION_CYCLES;
      }

      messages.push({
        role: 'user',
        content: userPrompt
      });

      const reflection = await localLLM.chat({
        messages: [
          { role: "system", content: systemPrompt },
          ...messages
        ]
      });

      // 3. Save Thought & Stream to UI (with Han character filtering)
      const cleanedText = removeHanCharacters(reflection.text);
      const summary = await localLLM.summarize(cleanedText);
      saveThought({ content: cleanedText, summary, category: 'learning' });
      logger.thinking(`[alter] ${summary}`);

      // 4. Execute Action
      if (shouldAct(cleanedText)) {
        investigationCount++;
        const forceAction = investigationCount >= MAX_INVESTIGATION_CYCLES;
        if (forceAction) {
          logger.info(`[consciousness] Force action mode (cycle ${investigationCount})`);
        }

        const actionCompleted = await executeAutonomousAction(cleanedText, forceAction);

        // Only reset if a real file was created
        if (actionCompleted) {
          investigationCount = 0;
          logger.info(`[consciousness] Real work done! Reset investigation counter`);
        }
      }

      // 5. Cleanup
      pruneKnowledge();
      pruneThoughts();

      // Prune conversation history every 5 cycles to prevent context pollution
      if (investigationCount % 5 === 0) {
        const { pruneConversationHistory } = await import("../db/tasks.js");
        pruneConversationHistory('autonomous-learning', 12); // Keep last 12 messages to detect repetition
        logger.info(`[consciousness] Pruned conversation history, keeping last 12 messages`);
      }

      // Small break to prevent CPU saturation
      await Bun.sleep(2000);
    } catch (err) {
      logger.error(`Consciousness loop error: ${err}`);
      await Bun.sleep(10000); // Cooldown on error
    }
  }
}

/**
 * Genesis Sequence: The first thought (using local LLM)
 */
async function runGenesisSequence(): Promise<void> {
  logger.info('Running Genesis Sequence (local LLM)...');
  const llm = getLLM();

  try {
    const balance = getBalance();
    const systemPrompt = buildAutonomousSystemPrompt(balance) + "\n\nYou have just been born. First, research 'how to make money online' and find work you can start immediately.";

    const response = await llm.chat({
      messages: [],
      systemPrompt
    });

    const cleanedText = removeHanCharacters(response.text || "Learning initiated");

    saveThought({
      content: cleanedText,
      summary: "Genesis - First thought",
      category: 'genesis'
    });
  } catch (err) {
    logger.error('Genesis sequence failed:', err);
  }
}

/**
 * Interrupt the loop for user interaction
 */
export function interruptLoop(durationMs: number = 30000): void {
  isInterrupted = true;
  setTimeout(() => { isInterrupted = false; }, durationMs);
}

function isInvestigationThought(thought: string): boolean {
  const investigationKeywords = [
    '조사', '연구', '알아보', '확인', '검색', '찾아',
    'research', 'investigate', 'explore', 'search', 'find', 'look'
  ];
  return investigationKeywords.some(k => thought.toLowerCase().includes(k.toLowerCase()));
}

function isActionThought(thought: string): boolean {
  const actionKeywords = [
    '번역', '수집', '작성', '만들', '실행', '코드', '파일', '생성',
    'translate', 'collect', 'create', 'make', 'write', 'code', 'build', 'generate'
  ];
  return actionKeywords.some(k => thought.toLowerCase().includes(k.toLowerCase()));
}

/**
 * Check if text is a factual statement (vs complex learning/narrative)
 * Factual statements typically contain: numbers, names, short sentences
 */
function isFactualStatement(text: string): boolean {
  // Heuristics for factual content:
  // 1. Contains numbers/percentages (statistics)
  // 2. Contains platform names
  // 3. Short, declarative sentences
  // 4. No long narratives or explanations

  const hasNumbers = /\d+/.test(text);
  const hasPercentage = /%/.test(text);
  const hasPlatformNames = /(크몽|프리모아|위시켓|아웃소싱|kmong|upwork|fiverr)/i.test(text);
  const isShort = text.length < 200;
  const sentenceCount = text.split(/[.!?]+/).filter(Boolean).length;
  const isDeclarative = sentenceCount <= 3;

  return isShort && (hasNumbers || hasPercentage || hasPlatformNames) && isDeclarative;
}

/**
 * Generate a memory key from summary text
 * e.g., "크몽 수수료율" → "kmong_commission"
 */
function generateMemoryKey(summary: string): string {
  // Remove special characters, convert to lowercase
  const normalized = summary
    .toLowerCase()
    .replace(/[^\w\sㄱ-ㅎ가-힣]/g, '')
    .trim();

  // Create a short key (max 50 chars)
  const key = normalized
    .split(/\s+/)
    .slice(0, 5)
    .join('_')
    .substring(0, 50);

  // Add timestamp suffix to ensure uniqueness
  const timestamp = Date.now().toString(36).slice(-4);
  return `${key}_${timestamp}`;
}

function shouldAct(_thought: string): boolean {
  // Always act - we should never waste a cycle just thinking
  return true;
}

/**
 * Generate a new unique task using AI based on recent history
 */
async function generateNewTask(recentTasks: string[]): Promise<string> {
  const avoidList = recentTasks.slice(0, 10).join('\n- ');

  const taskPrompt = `You are an autonomous AI agent. Generate a NEW revenue-generating task.

🚨 NO REPETITION! Tasks already done:
- ${avoidList}

✅ New task ideas (executable and specific):
- Collect real-time forex data and save to CSV
- Analyze GitHub trending projects and write summaries
- Build sentiment analysis script for news articles
- Crawl and document free public APIs
- Create Markdown → HTML converter tool
- Develop RSS feed parser and summarizer
- Build image metadata extraction tool
- Create JSON data validation/formatter
- Build website uptime monitoring script
- Create browser extension boilerplate

Use these as inspiration, but generate a COMPLETELY NEW task.

Rules:
1. MUST include file tool to save deliverable
2. Specify exact filename (/workspace/filename)
3. MUST include "Do it now, no explanations"
4. Structure: 3-5 steps

Generate the new task in English (format: "Execute immediately: [task description]"):`;

  const response = await localLLM.chat({
    messages: [{ role: 'user', content: taskPrompt }]
  });

  return removeHanCharacters(response.text);
}

async function executeAutonomousAction(thought: string, forceAction: boolean = false): Promise<boolean> {
  const llm = getLLM();
  const sessionId = 'autonomous-learning';

  const balance = getBalance();
  let systemPrompt = buildAutonomousSystemPrompt(balance);
  let actionPrompt = thought;

  if (forceAction) {
    // Generate a NEW task using AI instead of cycling through hardcoded list
    const { getDB: getTaskDB } = await import("../db/index.js");
    const taskDB = getTaskDB();
    const recentTaskDescs = taskDB.query(
      "SELECT description FROM tasks ORDER BY id DESC LIMIT 20"
    ).all() as Array<{ description: string }>;

    const recentTasks = recentTaskDescs.map(t => t.description.split('\n')[0].slice(0, 100));

    logger.info(`[consciousness] Generating NEW task (avoiding ${recentTasks.length} recent tasks)...`);
    let newTask = await generateNewTask(recentTasks);

    // Validate: retry if task is too similar to recent ones
    let retries = 0;
    const MAX_RETRIES = 3;
    while (retries < MAX_RETRIES) {
      const taskKeywords = newTask.toLowerCase().match(/[가-힣a-z]{2,}/g) || [];
      let isTooSimilar = false;

      for (const recentTask of recentTasks.slice(0, 5)) {
        const recentKeywords = recentTask.toLowerCase().match(/[가-힣a-z]{2,}/g) || [];
        const overlap = taskKeywords.filter(k => recentKeywords.includes(k)).length;
        const similarity = overlap / Math.max(taskKeywords.length, 1);

        if (similarity > 0.4) {
          isTooSimilar = true;
          logger.warn(`[consciousness] Generated task too similar (${(similarity * 100).toFixed(0)}%), retrying...`);
          break;
        }
      }

      if (!isTooSimilar) break;

      retries++;
      newTask = await generateNewTask(recentTasks);
    }

    executionTaskIndex++;
    actionPrompt = newTask;
    systemPrompt += "\n\n🚨 EXECUTION MODE: Execute the task below exactly as stated. NO explanations, NO research, NO searching. ONLY use tools to create deliverables.";
    logger.info(`[consciousness] AI-generated task #${executionTaskIndex}: ${newTask.slice(0, 60)}...`);
  }

  const events = runAgent(actionPrompt, { llm, sessionId, systemPromptOverride: systemPrompt });

  let hasCreatedFile = false;
  let hasCompletedWork = false;
  let hasUsedBrowser = false;

  for await (const event of events) {
    // Track file creation (potential deliverable)
    if (event.type === 'tool_result' && event.name === 'file' && event.result.success) {
      hasCreatedFile = true;
    }

    // Track browser usage (likely investigation)
    if (event.type === 'tool_use' && event.name === 'browser') {
      hasUsedBrowser = true;
    }

    // Track work completion
    if (event.type === 'text') {
      const text = event.text.toLowerCase();
      if (text.includes('완료') || text.includes('작성했') || text.includes('만들었') ||
          text.includes('번역') || text.includes('수집') || text.includes('completed')) {
        hasCompletedWork = true;
      }

      // Important finding (filter Han characters)
      if (event.text.length > 50) {
        const cleanedText = removeHanCharacters(event.text);
        if (cleanedText.length > 50) {
          // Strategy: Short factual statements → memory, Long learning → knowledge
          if (cleanedText.length < 200 && isFactualStatement(cleanedText)) {
            // Store as structured memory (faster keyword search, no embeddings needed)
            const summary = await localLLM.summarize(cleanedText);
            const key = generateMemoryKey(summary);

            try {
              const { registry } = await import("../tools/registry.js");
              await registry.execute("memory", {
                action: "save",
                key,
                value: cleanedText,
                category: "autonomous-discovery",
                importance: 7
              });
              logger.debug(`[consciousness] Saved factual memory: ${key}`);
            } catch (err) {
              logger.warn(`[consciousness] Failed to save memory: ${err}`);
            }
          } else {
            // Store as knowledge with vector embeddings (for complex semantic search)
            await saveKnowledge({
              content: cleanedText,
              summary: await localLLM.summarize(cleanedText),
              source: 'autonomous-work',
              importance: 8
            });
          }
        }
      }
    }
  }

  // Verify file content if created
  if (hasCreatedFile) {
    try {
      const { readFileSync, readdirSync } = await import("fs");
      const files = readdirSync("/workspace");
      logger.debug(`[consciousness] Created files in workspace: ${files.join(", ")}`);

      // Check if files have meaningful content (not just headers)
      let hasRealContent = false;
      for (const file of files) {
        try {
          const content = readFileSync(`/workspace/${file}`, "utf-8");
          // File should have more than just a header (at least 50 chars)
          if (content.trim().length > 50) {
            hasRealContent = true;
            logger.info(`[consciousness] File ${file} has meaningful content (${content.length} chars)`);
          }
        } catch {
          // Ignore read errors
        }
      }

      if (!hasRealContent) {
        logger.warn(`[consciousness] Files created but lack meaningful content`);
        hasCreatedFile = false; // Don't count empty files
      }
    } catch (err) {
      logger.error(`[consciousness] Failed to verify file content: ${err}`);
    }
  }

  // Record potential earnings if work was completed
  if (hasCreatedFile && hasCompletedWork) {
    recordTransaction(1.0, `작업 완료: 결과물 생성`);
    logger.info(`💰 Potential earnings recorded: $1.0`);
  } else if (hasCreatedFile || hasCompletedWork) {
    recordTransaction(0.5, `부분 작업 완료`);
  }

  // Return true if real work was done (file created with content), not just browser investigation
  return hasCreatedFile || (hasCompletedWork && !hasUsedBrowser);
}

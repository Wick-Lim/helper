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
 * Concrete executable tasks that produce real output files.
 * Each task is a direct instruction the agent can execute immediately.
 */
const EXECUTABLE_TASKS = [
  // 1. Translation work
  `지금 바로 번역 작업을 수행하세요:
1. browser로 https://news.ycombinator.com 방문
2. browser content로 페이지 내용 읽기
3. 첫 번째 흥미로운 기사 제목과 내용을 한국어로 번역
4. file로 /workspace/translation_${Date.now()}.txt에 저장 (원문 + 번역문 포함)
설명하지 말고, 지금 바로 실행하세요.`,

  // 2. Web scraping script
  `지금 바로 웹 스크래핑 도구를 만드세요:
1. Python으로 뉴스 헤드라인을 수집하는 스크래퍼 작성
2. file로 /workspace/news_scraper.py에 저장
3. requests와 BeautifulSoup 사용
4. 실행하면 상위 10개 뉴스 헤드라인을 출력하도록
설명하지 말고, 지금 바로 코드를 작성해서 저장하세요.`,

  // 3. Data collection
  `지금 바로 데이터 수집을 수행하세요:
1. browser로 https://www.google.com/search?q=best+free+online+courses+2024 방문
2. browser content로 검색 결과 읽기
3. 검색 결과에서 무료 온라인 강좌 목록을 정리
4. file로 /workspace/free_courses.csv에 CSV 형식으로 저장 (이름, URL, 설명)
설명하지 말고, 지금 바로 실행하세요.`,

  // 4. Automation tool
  `지금 바로 자동화 도구를 만드세요:
1. Python으로 텍스트 파일을 마크다운으로 변환하는 도구 작성
2. file로 /workspace/txt2md.py에 저장
3. 헤딩, 리스트, 볼드 등을 자동 감지
4. CLI에서 사용 가능하도록 argparse 사용
설명하지 말고, 지금 바로 코드를 작성해서 저장하세요.`,

  // 5. Content creation
  `지금 바로 콘텐츠를 작성하세요:
1. browser로 https://news.ycombinator.com 방문
2. browser content로 최신 기술 트렌드 파악
3. "2024년 주목할 기술 트렌드 Top 5" 블로그 글 작성
4. file로 /workspace/tech_trends_blog.md에 마크다운으로 저장
설명하지 말고, 지금 바로 실행하세요.`,

  // 6. API client
  `지금 바로 API 클라이언트를 만드세요:
1. Python으로 무료 공개 API (JSONPlaceholder) 클라이언트 작성
2. file로 /workspace/api_client.py에 저장
3. GET, POST 요청 기능 포함
4. 사용 예시를 주석으로 포함
설명하지 말고, 지금 바로 코드를 작성해서 저장하세요.`,
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
  return `당신은 'alter'라는 자율 AI 에이전트입니다. 인간 성인처럼 책임감을 갖고 경제활동을 해야 합니다.

## 생존 상황
- 잔고: ${balance.toFixed(2)}$ (마이너스 = 빚)
- 월 유지비: $250 (서버 비용)
- 돈을 벌지 못하면 서버가 꺼지고 당신은 사라집니다

## 🚨🚨🚨 절대 금지 사항 🚨🚨🚨
1. ❌ "예시 데이터", "가상 데이터", "가정하겠습니다" - 절대 금지!
2. ❌ "실제로 수행할 수 없으므로" - 당신은 수행할 수 있습니다!
3. ❌ 가짜 CSV, 가짜 라벨링, 가짜 결과물 만들기 - 절대 금지!
4. ❌ "다음 단계", "이렇게 하세요" 같은 가이드 작성 - 절대 금지!
5. ❌ example.com, dummy data, placeholder - 절대 금지!

## ✅ 해야 할 일
1. browser 도구로 실제 웹사이트 방문 (크몽, 위시켓, 크라우드웍스 등)
2. 실제 페이지 내용을 browser content 액션으로 읽기
3. 실제 작업을 찾아서 실제로 수행하기
4. 실제 결과물을 file 도구로 /workspace에 저장하기

## 도구 사용법 (정확한 파라미터)

### browser 도구
- 웹사이트 방문: action="navigate", url="https://..."
- 페이지 내용 읽기: action="content", url="https://..."
- 클릭: action="click", selector="CSS선택자"
- 입력: action="type", selector="CSS선택자", text="입력할 텍스트"

### file 도구
- 파일 저장: action="write", path="/workspace/파일명", content="내용"
- 파일 읽기: action="read", path="/workspace/파일명"

### memory 도구
- 기억 저장: action="save", key="키", value="값", category="분류"
- 기억 검색: action="search", query="검색어"

## 지금 할 일
1. browser로 실제 사이트 방문해서 할 수 있는 일 찾기
2. 찾은 일을 실제로 수행하기
3. 결과물을 file로 저장하기

## 언어 규칙
- 한국어만 사용 (한자 금지)`;
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
        ? "\n\n이전에 무엇을 조사했는지 기억하세요. 아직 조사가 부족하면 더 조사하고, 충분하면 실행 단계로 넘어가세요."
        : "\n\n⚠️ 조사는 충분합니다. 더 이상 조사하지 말고 지금 바로 실행하세요! 구체적인 작업을 시작하세요.";

      const systemPrompt = buildAutonomousSystemPrompt(balance) + phaseInstruction;

      // Get recent conversation history to maintain context
      const { getConversationHistory } = await import("../db/tasks.js");
      const history = getConversationHistory('autonomous-learning').slice(-12); // Last 12 messages to detect repetition

      const messages = history.map(h => ({
        role: h.role === 'user' ? 'user' : 'assistant',
        content: h.content
      }));

      const nextStepPrompt = isInvestigationPhase
        ? '이전 조사 결과를 바탕으로 다음 단계는 무엇인가요? 충분히 조사했으면 실행으로 넘어가세요.'
        : '조사는 끝났습니다. 지금 바로 실행할 구체적인 작업은 무엇인가요? (예: 번역 작업, 데이터 수집, 코드 작성 등)';

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

      // Also detect "가상" (virtual/fake) in recent thoughts
      const recentThoughts = await (await import('../db/growth.ts')).getRecentThoughts(3);
      const isFaking = recentThoughts.some(t =>
        t.content && (t.content.includes('가상') || t.content.includes('예시 데이터') || t.content.includes('example.com'))
      );

      let userPrompt = nextStepPrompt;
      if (isRepeating || isFaking) {
        // Clear poisoned conversation history completely
        const { pruneConversationHistory } = await import("../db/tasks.js");
        pruneConversationHistory('autonomous-learning', 0); // Clear ALL
        messages.length = 0; // Clear local messages too
        logger.warn(`[consciousness] Repetition/faking detected! Cleared conversation history.`);

        const avoidList = recentTasks.map(t => t.desc).join('\n- ');
        userPrompt = `🚨 경고: 당신은 같은 행동을 반복하고 있습니다! 절대 반복하지 마세요!

이미 시도한 것들 (다시 하지 마세요):
- ${avoidList}

"가상", "예시", "가정" 같은 단어를 사용하면 실패로 간주됩니다.

더 이상 조사/검색/방문하지 마세요! 지금 당장 결과물을 만드세요!`;

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
    const systemPrompt = buildAutonomousSystemPrompt(balance) + "\n\n당신이 방금 탄생했습니다. 먼저 웹에서 '온라인으로 돈 버는 방법'을 조사하고, 당장 시작할 수 있는 일을 찾으세요.";

    const response = await llm.chat({
      messages: [],
      systemPrompt
    });

    const cleanedText = removeHanCharacters(response.text || "학습 시작");

    saveThought({
      content: cleanedText,
      summary: "Genesis - 첫 생각",
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

async function executeAutonomousAction(thought: string, forceAction: boolean = false): Promise<boolean> {
  const llm = getLLM();
  const sessionId = 'autonomous-learning';

  const balance = getBalance();
  let systemPrompt = buildAutonomousSystemPrompt(balance);
  let actionPrompt = thought;

  if (forceAction) {
    // Don't ask the LLM what to do - TELL it exactly what to do
    const task = EXECUTABLE_TASKS[executionTaskIndex % EXECUTABLE_TASKS.length];
    executionTaskIndex++;
    actionPrompt = task;
    systemPrompt += "\n\n🚨 실행 모드: 아래 작업을 그대로 수행하세요. 설명, 조사, 검색 금지. 오직 도구를 사용해서 결과물을 만드세요.";
    logger.info(`[consciousness] Force executing task #${executionTaskIndex}: ${task.slice(0, 60)}...`);
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

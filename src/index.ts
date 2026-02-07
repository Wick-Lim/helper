// Entry point — initialize DB, register tools, start REPL or one-shot mode

import { initDB, closeDB } from "./db/index.js";
import { setupSignalHandlers, onShutdown } from "./core/signals.js";
import { logger, setVerbose } from "./core/logger.js";
import { createGeminiClient } from "./llm/gemini.js";
import { getBool } from "./db/config.js";
import { startRepl, runOneShot } from "./cli/repl.js";
import { startServer } from "./api/server.js";
import { startTelegramBot } from "./telegram/bot.js";
import { randomUUID } from "crypto";

// Register tools (side-effect imports)
import "./tools/shell.js";
import "./tools/file.js";
import "./tools/web.js";
import "./tools/code.js";
import "./tools/memory.js";
import "./tools/browser.js";
import { closeBrowser } from "./tools/browser.js";

async function main(): Promise<void> {
  // Setup signal handlers
  setupSignalHandlers();

  // Initialize database
  const dbPath = process.env.DB_PATH ?? "/data/agent.db";
  try {
    initDB(dbPath);
  } catch {
    // Fallback to local path for development
    initDB("./agent.db");
  }

  // Register shutdown handlers
  onShutdown(closeDB);
  onShutdown(closeBrowser);

  // Set verbose from config
  setVerbose(getBool("verbose"));

  // Ensure temp directory for code execution
  const { mkdirSync } = await import("fs");
  try {
    mkdirSync("/tmp/agent", { recursive: true });
  } catch {}

  // Initialize LLM client
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logger.error("GEMINI_API_KEY environment variable is required");
    process.exit(1);
  }

  const llm = createGeminiClient(apiKey, process.env.GEMINI_MODEL);
  const sessionId = randomUUID();

  // Check execution mode
  const port = process.env.PORT ? parseInt(process.env.PORT) : null;

  // Start Telegram bot if token provided
  const telegramToken = process.env.TELEGRAM_TOKEN;
  if (telegramToken) {
    startTelegramBot(telegramToken, llm);
  }

  if (port) {
    // API server mode
    startServer(port, llm);
  } else if (telegramToken) {
    // Telegram-only mode — keep process alive
    logger.info("Running in Telegram bot mode");
  } else {
    // CLI mode
    const args = process.argv.slice(2);
    if (args.length > 0) {
      const query = args.join(" ");
      await runOneShot(llm, sessionId, query);
    } else {
      await startRepl(llm, sessionId);
    }

    // Cleanup (API server keeps running)
    closeDB();
  }
}

main().catch((err) => {
  logger.error(`Fatal: ${err.message ?? err}`);
  closeDB();
  process.exit(1);
});

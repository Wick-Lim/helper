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

async function initializeDatabase(dbPath: string, retries = 3): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      initDB(dbPath);
      logger.info(`Database initialized successfully at ${dbPath}`);
      return;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error(`Database initialization failed (attempt ${attempt}/${retries}): ${error}`);

      if (attempt === retries) {
        throw new Error(`Failed to initialize database after ${retries} attempts: ${error}`);
      }

      // Wait before retry
      await Bun.sleep(1000 * attempt);
    }
  }
}

async function ensureTempDirectory(): Promise<void> {
  const { mkdirSync } = await import("fs");
  const tempDirs = ["/tmp/agent", "/workspace"];

  for (const dir of tempDirs) {
    try {
      mkdirSync(dir, { recursive: true });
      logger.debug(`Ensured temp directory exists: ${dir}`);
    } catch (err) {
      logger.warn(`Failed to create temp directory ${dir}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

async function main(): Promise<void> {
  // Setup signal handlers
  setupSignalHandlers();

  // Initialize database with retry logic
  const dbPath = process.env.DB_PATH ?? "/data/agent.db";
  let dbInitialized = false;

  try {
    await initializeDatabase(dbPath);
    dbInitialized = true;
  } catch (err) {
    // Fallback to local path for development
    logger.warn(`Primary database path failed, trying fallback...`);
    try {
      await initializeDatabase("./agent.db");
      dbInitialized = true;
    } catch (fallbackErr) {
      logger.error(`Database initialization completely failed: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`);
      process.exit(1);
    }
  }

  if (!dbInitialized) {
    logger.error("Critical: Database could not be initialized");
    process.exit(1);
  }

  // Register shutdown handlers
  onShutdown(closeDB);
  onShutdown(closeBrowser);

  // Set verbose from config
  try {
    setVerbose(getBool("verbose"));
  } catch (err) {
    logger.warn(`Failed to set verbose mode: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Ensure temp directories
  await ensureTempDirectory();

  // Initialize LLM client
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logger.error("GEMINI_API_KEY environment variable is required");
    process.exit(1);
  }

  // Validate API key format (basic check)
  if (apiKey.length < 20) {
    logger.error("GEMINI_API_KEY appears to be invalid (too short)");
    process.exit(1);
  }

  let llm;
  try {
    llm = createGeminiClient(apiKey, process.env.GEMINI_MODEL);
  } catch (err) {
    logger.error(`Failed to initialize LLM client: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const sessionId = randomUUID();

  // Check execution mode
  const port = process.env.PORT ? parseInt(process.env.PORT) : null;

  // Start Telegram bot if token provided
  const telegramToken = process.env.TELEGRAM_TOKEN;
  if (telegramToken) {
    // Validate token format
    if (!telegramToken.includes(":")) {
      logger.error("TELEGRAM_TOKEN appears to be invalid (should contain ':')");
    } else {
      // Start in background with error handling
      startTelegramBot(telegramToken, llm).catch((err) => {
        logger.error(`Telegram bot failed to start: ${err instanceof Error ? err.message : String(err)}`);
        // Don't exit - other modes might still work
      });
    }
  }

  if (port) {
    // Validate port
    if (port < 1 || port > 65535) {
      logger.error(`Invalid PORT: ${port}. Must be between 1 and 65535.`);
      process.exit(1);
    }

    // API server mode
    try {
      await startServer(port, llm);
    } catch (err) {
      logger.error(`Failed to start API server: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  } else if (telegramToken) {
    // Telegram-only mode — keep process alive
    logger.info("Running in Telegram bot mode");

    // Keep the process alive
    setInterval(() => {
      // Health check heartbeat
    }, 30000);
  } else {
    // CLI mode
    const args = process.argv.slice(2);
    let cliSuccess = false;

    try {
      if (args.length > 0) {
        const query = args.join(" ");
        await runOneShot(llm, sessionId, query);
      } else {
        await startRepl(llm, sessionId);
      }
      cliSuccess = true;
    } catch (err) {
      logger.error(`CLI execution failed: ${err instanceof Error ? err.message : String(err)}`);
      cliSuccess = false;
    } finally {
      // Cleanup (API server keeps running)
      try {
        await closeDB();
      } catch (err) {
        logger.warn(`Error during cleanup: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (!cliSuccess) {
      process.exit(1);
    }
  }
}

main().catch((err) => {
  const errorMessage = err instanceof Error ? err.message : String(err);
  logger.error(`Fatal error in main: ${errorMessage}`);

  // Attempt cleanup
  try {
    closeDB();
  } catch (cleanupErr) {
    // Ignore cleanup errors
  }

  process.exit(1);
});

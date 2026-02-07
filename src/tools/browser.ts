// Browser automation tool — Puppeteer-core with system Chromium
// Includes resource management, screenshot rotation, and memory cleanup

import puppeteer, { type Browser, type Page } from "puppeteer-core";
import type { Tool, ToolResult } from "../core/types.js";
import { registry } from "./registry.js";
import { logger } from "../core/logger.js";
import { randomUUID } from "crypto";
import { mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync } from "fs";
import { join } from "path";

const SCREENSHOT_DIR = "/data/screenshots";
const MAX_FULLPAGE_HEIGHT = 1440;
const MAX_SCREENSHOTS = 100; // Keep only last 100 screenshots
const MAX_SCREENSHOT_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const PAGE_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // Close page after 5 minutes idle
const MAX_BROWSER_AGE_MS = 30 * 60 * 1000; // Restart browser after 30 minutes

let browser: Browser | null = null;
let currentPage: Page | null = null;
let lastActivityTime = Date.now();
let browserStartTime = Date.now();
let screenshotCount = 0;
let cleanupInterval: Timer | null = null;

// Initialize cleanup interval
function startCleanupInterval(): void {
  if (cleanupInterval) return;

  cleanupInterval = setInterval(() => {
    cleanupOldScreenshots().catch((err) => {
      logger.error(`Screenshot cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    });

    checkBrowserHealth().catch((err) => {
      logger.error(`Browser health check failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }, 60000); // Run every minute
}

async function cleanupOldScreenshots(): Promise<void> {
  try {
    const files = readdirSync(SCREENSHOT_DIR);
    const now = Date.now();
    const filesWithStats: Array<{ name: string; path: string; mtime: number; size: number }> = [];

    for (const file of files) {
      if (!file.endsWith(".jpg")) continue;

      const filepath = join(SCREENSHOT_DIR, file);
      try {
        const stats = statSync(filepath);
        filesWithStats.push({
          name: file,
          path: filepath,
          mtime: stats.mtime.getTime(),
          size: stats.size,
        });
      } catch {
        // File might have been deleted
      }
    }

    // Sort by modification time (oldest first)
    filesWithStats.sort((a, b) => a.mtime - b.mtime);

    let deletedCount = 0;
    let freedSpace = 0;

    // Delete old files (older than 24 hours)
    for (const file of filesWithStats) {
      if (now - file.mtime > MAX_SCREENSHOT_AGE_MS) {
        try {
          unlinkSync(file.path);
          deletedCount++;
          freedSpace += file.size;
        } catch {
          // Ignore errors
        }
      }
    }

    // If still too many files, delete oldest until under limit
    const remainingFiles = filesWithStats.filter((f) => {
      try {
        statSync(f.path);
        return true;
      } catch {
        return false;
      }
    });

    while (remainingFiles.length > MAX_SCREENSHOTS) {
      const oldest = remainingFiles.shift();
      if (oldest) {
        try {
          unlinkSync(oldest.path);
          deletedCount++;
          freedSpace += oldest.size;
        } catch {
          // Ignore errors
        }
      }
    }

    screenshotCount = remainingFiles.length;

    if (deletedCount > 0) {
      logger.info(`Cleaned up ${deletedCount} old screenshots, freed ${Math.round(freedSpace / 1024 / 1024)}MB`);
    }
  } catch (err) {
    logger.error(`Screenshot cleanup error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function checkBrowserHealth(): Promise<void> {
  const now = Date.now();

  // Check if browser is too old
  if (now - browserStartTime > MAX_BROWSER_AGE_MS) {
    logger.info("Browser reached max age, restarting...");
    await closeBrowser();
    return;
  }

  // Check if page has been idle too long
  if (currentPage && now - lastActivityTime > PAGE_IDLE_TIMEOUT_MS) {
    logger.info("Page idle for too long, closing...");
    await currentPage.close().catch(() => {});
    currentPage = null;
  }
}

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.connected) {
    logger.info("Launching new browser instance...");
    browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium",
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-setuid-sandbox",
        "--disable-background-networking",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-breakpad",
        "--disable-component-extensions-with-background-pages",
        "--disable-features=TranslateUI,BlinkGenPropertyTrees",
        "--disable-ipc-flooding-protection",
        "--disable-renderer-backgrounding",
        "--enable-features=NetworkService,NetworkServiceInProcess",
        "--force-color-profile=srgb",
        "--metrics-recording-only",
        "--no-first-run",
        "--password-store=basic",
        "--use-mock-keychain",
        // Memory optimizations
        "--js-flags=--max-old-space-size=512",
        "--max_old_space_size=512",
      ],
    });
    browserStartTime = Date.now();
    startCleanupInterval();
  }
  return browser;
}

async function getPage(): Promise<Page> {
  const b = await getBrowser();
  if (!currentPage || currentPage.isClosed()) {
    currentPage = await b.newPage();
    await currentPage.setViewport({ width: 1280, height: 720 });

    // Block unnecessary resources to save memory
    await currentPage.setRequestInterception(true);
    currentPage.on("request", (req) => {
      const resourceType = req.resourceType();
      if (["image", "stylesheet", "font", "media"].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });
  }
  lastActivityTime = Date.now();
  return currentPage;
}

export async function closeBrowser(): Promise<void> {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }

  if (currentPage && !currentPage.isClosed()) {
    await currentPage.close().catch(() => {});
  }
  if (browser) {
    await browser.close().catch(() => {});
  }
  browser = null;
  currentPage = null;
  logger.info("Browser closed");
}

export function getBrowserStats(): {
  isRunning: boolean;
  pageActive: boolean;
  browserAge: number;
  lastActivity: number;
  screenshotCount: number;
} {
  return {
    isRunning: browser !== null && browser.connected,
    pageActive: currentPage !== null && !currentPage.isClosed(),
    browserAge: Date.now() - browserStartTime,
    lastActivity: Date.now() - lastActivityTime,
    screenshotCount,
  };
}

async function navigate(args: Record<string, unknown>): Promise<ToolResult> {
  const url = args.url as string;
  const waitUntil = (args.wait_until as string) ?? "networkidle2";
  const start = Date.now();

  try {
    const page = await getPage();
    await page.goto(url, {
      waitUntil: waitUntil as "load" | "domcontentloaded" | "networkidle0" | "networkidle2",
      timeout: 30000,
    });

    const title = await page.title();
    return {
      success: true,
      output: `Navigated to ${url}\nTitle: ${title}`,
      executionTime: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      output: "",
      error: err instanceof Error ? err.message : String(err),
      executionTime: Date.now() - start,
    };
  }
}

async function screenshot(args: Record<string, unknown>): Promise<ToolResult> {
  const url = args.url as string | undefined;
  const selector = args.selector as string | undefined;
  const fullPage = (args.full_page as boolean) ?? false;
  const start = Date.now();

  try {
    const page = await getPage();

    if (url) {
      await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    }

    // Ensure screenshot directory exists
    try {
      mkdirSync(SCREENSHOT_DIR, { recursive: true });
    } catch {}

    const screenshotOpts: { encoding: "base64"; type: "jpeg"; quality: number } = {
      encoding: "base64",
      type: "jpeg",
      quality: 80,
    };

    let base64: string;
    if (selector) {
      const el = await page.$(selector);
      if (!el) {
        return {
          success: false,
          output: "",
          error: `Element not found: ${selector}`,
          executionTime: Date.now() - start,
        };
      }
      base64 = (await el.screenshot(screenshotOpts)) as string;
    } else if (fullPage) {
      // Cap fullPage height to prevent oversized images
      const viewport = page.viewport();
      if (!viewport) {
        return {
          success: false,
          output: "",
          error: "Viewport not initialized",
          executionTime: Date.now() - start,
        };
      }
      const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
      const captureHeight = Math.min(bodyHeight, MAX_FULLPAGE_HEIGHT);
      base64 = (await page.screenshot({
        ...screenshotOpts,
        clip: { x: 0, y: 0, width: viewport.width, height: captureHeight },
      })) as string;
    } else {
      base64 = (await page.screenshot(screenshotOpts)) as string;
    }

    // Save to disk for HTTP serving
    const imageId = randomUUID();
    const filename = `${imageId}.jpg`;
    const filepath = `${SCREENSHOT_DIR}/${filename}`;
    writeFileSync(filepath, Buffer.from(base64, "base64"));
    screenshotCount++;

    // Trigger cleanup if we have too many screenshots
    if (screenshotCount > MAX_SCREENSHOTS) {
      cleanupOldScreenshots().catch(() => {});
    }

    const title = await page.title();
    const pageUrl = page.url();

    return {
      success: true,
      output: `Screenshot captured: ${pageUrl}\nTitle: ${title}\nImage: /api/images/${filename}`,
      executionTime: Date.now() - start,
      images: [{ mimeType: "image/jpeg", data: base64, id: filename }],
    };
  } catch (err) {
    return {
      success: false,
      output: "",
      error: err instanceof Error ? err.message : String(err),
      executionTime: Date.now() - start,
    };
  }
}

async function click(args: Record<string, unknown>): Promise<ToolResult> {
  const selector = args.selector as string;
  const start = Date.now();

  try {
    const page = await getPage();
    await page.click(selector);

    return {
      success: true,
      output: `Clicked: ${selector}`,
      executionTime: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      output: "",
      error: err instanceof Error ? err.message : String(err),
      executionTime: Date.now() - start,
    };
  }
}

async function type_(args: Record<string, unknown>): Promise<ToolResult> {
  const selector = args.selector as string;
  const text = args.text as string;
  const start = Date.now();

  try {
    const page = await getPage();
    await page.type(selector, text);

    return {
      success: true,
      output: `Typed "${text}" into ${selector}`,
      executionTime: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      output: "",
      error: err instanceof Error ? err.message : String(err),
      executionTime: Date.now() - start,
    };
  }
}

async function evaluate(args: Record<string, unknown>): Promise<ToolResult> {
  const script = args.script as string;
  const start = Date.now();

  try {
    const page = await getPage();
    const result = await page.evaluate(script);

    return {
      success: true,
      output: typeof result === "string" ? result : JSON.stringify(result, null, 2),
      executionTime: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      output: "",
      error: err instanceof Error ? err.message : String(err),
      executionTime: Date.now() - start,
    };
  }
}

async function content(args: Record<string, unknown>): Promise<ToolResult> {
  const url = args.url as string | undefined;
  const start = Date.now();

  try {
    const page = await getPage();

    if (url) {
      await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    }

    const text = await page.evaluate(() => document.body.innerText);
    const title = await page.title();

    return {
      success: true,
      output: `Title: ${title}\n\n${text}`,
      executionTime: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      output: "",
      error: err instanceof Error ? err.message : String(err),
      executionTime: Date.now() - start,
    };
  }
}

const browserTool: Tool = {
  declaration: {
    name: "browser",
    description:
      "Control a headless Chromium browser. Actions: navigate (go to URL), screenshot (capture page as image for vision analysis), click (click element by CSS selector), type (type text into element), evaluate (run JavaScript on page), content (extract page text). Browser automatically manages memory and cleans up old screenshots.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "The browser action to perform",
          enum: ["navigate", "screenshot", "click", "type", "evaluate", "content"],
        },
        url: {
          type: "string",
          description: "URL to navigate to (for navigate, screenshot, content)",
        },
        selector: {
          type: "string",
          description: "CSS selector for target element (for click, type, screenshot)",
        },
        text: {
          type: "string",
          description: "Text to type (for type action)",
        },
        script: {
          type: "string",
          description: "JavaScript to execute on page (for evaluate action)",
        },
        full_page: {
          type: "boolean",
          description: "Capture full page screenshot (default: false)",
        },
        wait_until: {
          type: "string",
          description: "Navigation wait condition (default: networkidle2)",
          enum: ["load", "domcontentloaded", "networkidle0", "networkidle2"],
        },
      },
      required: ["action"],
    },
  },

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const action = args.action as string;
    const start = Date.now();

    logger.tool("browser", `${action} ${args.url ?? args.selector ?? ""}`);

    try {
      switch (action) {
        case "navigate":
          if (!args.url) {
            return { success: false, output: "", error: "url is required for navigate" };
          }
          return await navigate(args);

        case "screenshot":
          return await screenshot(args);

        case "click":
          if (!args.selector) {
            return { success: false, output: "", error: "selector is required for click" };
          }
          return await click(args);

        case "type":
          if (!args.selector || !args.text) {
            return { success: false, output: "", error: "selector and text are required for type" };
          }
          return await type_(args);

        case "evaluate":
          if (!args.script) {
            return { success: false, output: "", error: "script is required for evaluate" };
          }
          return await evaluate(args);

        case "content":
          return await content(args);

        default:
          return {
            success: false,
            output: "",
            error: `Unknown action: ${action}. Use: navigate, screenshot, click, type, evaluate, content`,
          };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output: "",
        error: message,
        executionTime: Date.now() - start,
      };
    }
  },
};

registry.register(browserTool);

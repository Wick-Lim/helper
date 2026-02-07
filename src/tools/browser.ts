// Browser automation tool — Puppeteer-core with system Chromium

import puppeteer, { type Browser, type Page } from "puppeteer-core";
import type { Tool, ToolResult } from "../core/types.js";
import { registry } from "./registry.js";
import { logger } from "../core/logger.js";
import { randomUUID } from "crypto";
import { mkdirSync, writeFileSync } from "fs";

const SCREENSHOT_DIR = "/data/screenshots";
const MAX_FULLPAGE_HEIGHT = 1440;

let browser: Browser | null = null;
let currentPage: Page | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.connected) {
    browser = await puppeteer.launch({
      executablePath:
        process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium",
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-setuid-sandbox",
      ],
    });
  }
  return browser;
}

async function getPage(): Promise<Page> {
  const b = await getBrowser();
  if (!currentPage || currentPage.isClosed()) {
    currentPage = await b.newPage();
    await currentPage.setViewport({ width: 1280, height: 720 });
  }
  return currentPage;
}

export async function closeBrowser(): Promise<void> {
  if (currentPage && !currentPage.isClosed()) {
    await currentPage.close().catch(() => {});
  }
  if (browser) {
    await browser.close().catch(() => {});
  }
  browser = null;
  currentPage = null;
}

async function navigate(
  args: Record<string, unknown>
): Promise<ToolResult> {
  const url = args.url as string;
  const waitUntil = (args.wait_until as string) ?? "networkidle2";
  const start = Date.now();

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
}

async function screenshot(
  args: Record<string, unknown>
): Promise<ToolResult> {
  const url = args.url as string | undefined;
  const selector = args.selector as string | undefined;
  const fullPage = (args.full_page as boolean) ?? false;
  const start = Date.now();

  const page = await getPage();

  if (url) {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
  }

  // Ensure screenshot directory exists
  try { mkdirSync(SCREENSHOT_DIR, { recursive: true }); } catch {}

  const screenshotOpts: Record<string, unknown> = {
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
    const viewport = page.viewport()!;
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

  const title = await page.title();
  const pageUrl = page.url();

  return {
    success: true,
    output: `Screenshot captured: ${pageUrl}\nTitle: ${title}\nImage: /api/images/${filename}`,
    executionTime: Date.now() - start,
    images: [{ mimeType: "image/jpeg", data: base64, id: filename }],
  };
}

async function click(
  args: Record<string, unknown>
): Promise<ToolResult> {
  const selector = args.selector as string;
  const start = Date.now();

  const page = await getPage();
  await page.click(selector);

  return {
    success: true,
    output: `Clicked: ${selector}`,
    executionTime: Date.now() - start,
  };
}

async function type_(
  args: Record<string, unknown>
): Promise<ToolResult> {
  const selector = args.selector as string;
  const text = args.text as string;
  const start = Date.now();

  const page = await getPage();
  await page.type(selector, text);

  return {
    success: true,
    output: `Typed "${text}" into ${selector}`,
    executionTime: Date.now() - start,
  };
}

async function evaluate(
  args: Record<string, unknown>
): Promise<ToolResult> {
  const script = args.script as string;
  const start = Date.now();

  const page = await getPage();
  const result = await page.evaluate(script);

  return {
    success: true,
    output: typeof result === "string" ? result : JSON.stringify(result, null, 2),
    executionTime: Date.now() - start,
  };
}

async function content(
  args: Record<string, unknown>
): Promise<ToolResult> {
  const url = args.url as string | undefined;
  const start = Date.now();

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
}

const browserTool: Tool = {
  declaration: {
    name: "browser",
    description:
      "Control a headless Chromium browser. Actions: navigate (go to URL), screenshot (capture page as image for vision analysis), click (click element by CSS selector), type (type text into element), evaluate (run JavaScript on page), content (extract page text).",
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

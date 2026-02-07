// Telegram bot — long polling bridge to agent with retry logic and request tracking

import { runAgent } from "../agent/agent.js";
import { logger, runWithContext } from "../core/logger.js";
import { isShutdown } from "../core/signals.js";
import type { LLMClient } from "../llm/types.js";
import type { ImageData } from "../core/types.js";
import { randomUUID } from "crypto";

const POLL_TIMEOUT = 30; // seconds (Telegram long poll)
const MAX_MSG_LEN = 4096; // Telegram message limit
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
    caption?: string;
    photo?: TelegramPhotoSize[];
  };
}

let api: string;
let token: string;
let llm: LLMClient;
let isRunning = false;
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 10;

async function tgWithRetry(
  method: string,
  body?: Record<string, unknown>,
  retries = MAX_RETRIES
): Promise<unknown> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${api}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const json = await res.json();

      if (!json.ok) {
        // Don't retry on auth errors
        if (json.error_code === 401 || json.error_code === 403) {
          throw new Error(`Auth failed: ${json.description}`);
        }
        // Don't retry on bad request errors
        if (json.error_code === 400) {
          throw new Error(`Bad request: ${json.description}`);
        }
        throw new Error(`Telegram API error: ${JSON.stringify(json)}`);
      }

      // Reset consecutive errors on success
      consecutiveErrors = 0;
      return json;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt === retries) {
        break;
      }

      // Don't retry on auth errors
      if (lastError.message.includes("Auth failed")) {
        throw lastError;
      }

      logger.warn(`Telegram API ${method} failed (attempt ${attempt + 1}/${retries + 1}): ${lastError.message}`);
      await Bun.sleep(RETRY_DELAY_MS * (attempt + 1));
    }
  }

  throw lastError ?? new Error(`All ${retries + 1} attempts failed for ${method}`);
}

async function tg(method: string, body?: Record<string, unknown>): Promise<unknown> {
  return tgWithRetry(method, body, MAX_RETRIES);
}

async function downloadPhoto(fileId: string, retries = 2): Promise<ImageData | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const fileRes = await tg("getFile", { file_id: fileId });
      if (!fileRes.ok || !fileRes.result?.file_path) return null;

      const url = `https://api.telegram.org/file/bot${token}/${fileRes.result.file_path}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Failed to download photo: HTTP ${res.status}`);
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      const mimeType = fileRes.result.file_path.endsWith(".png") ? "image/png" : "image/jpeg";

      return { mimeType, data: buffer.toString("base64") };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to download photo (attempt ${attempt + 1}/${retries + 1}): ${msg}`);

      if (attempt === retries) {
        return null;
      }

      await Bun.sleep(RETRY_DELAY_MS * (attempt + 1));
    }
  }

  return null;
}

async function sendTextWithRetry(chatId: number, text: string): Promise<void> {
  // Split long messages
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += MAX_MSG_LEN) {
    chunks.push(text.slice(i, i + MAX_MSG_LEN));
  }

  for (const chunk of chunks) {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await tg("sendMessage", {
          chat_id: chatId,
          text: chunk,
          parse_mode: undefined, // No markdown to avoid parsing errors
        });
        break; // Success
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (attempt === MAX_RETRIES) {
          throw lastError;
        }

        await Bun.sleep(RETRY_DELAY_MS * (attempt + 1));
      }
    }
  }
}

async function sendPhotoWithRetry(
  chatId: number,
  base64: string,
  mimeType: string
): Promise<void> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const blob = new Blob([Buffer.from(base64, "base64")], { type: mimeType });
      const form = new FormData();
      form.append("chat_id", String(chatId));
      form.append("photo", blob, "screenshot.png");

      const res = await fetch(`${api}/sendPhoto`, { method: "POST", body: form });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const json = await res.json();
      if (!json.ok) {
        throw new Error(`Telegram API error: ${json.description}`);
      }

      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt === MAX_RETRIES) {
        throw lastError;
      }

      await Bun.sleep(RETRY_DELAY_MS * (attempt + 1));
    }
  }

  throw lastError ?? new Error("Failed to send photo");
}

async function sendFileWithRetry(
  chatId: number,
  filePath: string,
  mimeType: string
): Promise<void> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const file = Bun.file(filePath);
      const buffer = await file.arrayBuffer();
      const fileName = filePath.split("/").pop() || "file";
      const blob = new Blob([buffer], { type: mimeType });
      const form = new FormData();
      form.append("chat_id", String(chatId));

      let endpoint: string;
      if (mimeType.startsWith("video/")) {
        form.append("video", blob, fileName);
        endpoint = "sendVideo";
      } else if (mimeType.startsWith("audio/")) {
        form.append("audio", blob, fileName);
        endpoint = "sendAudio";
      } else {
        form.append("document", blob, fileName);
        endpoint = "sendDocument";
      }

      const res = await fetch(`${api}/${endpoint}`, { method: "POST", body: form });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const json = await res.json();
      if (!json.ok) {
        throw new Error(`Telegram API error: ${json.description}`);
      }

      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt === MAX_RETRIES) {
        throw lastError;
      }

      await Bun.sleep(RETRY_DELAY_MS * (attempt + 1));
    }
  }

  throw lastError ?? new Error("Failed to send file");
}

async function sendTypingWithRetry(chatId: number): Promise<void> {
  try {
    await tg("sendChatAction", { chat_id: chatId, action: "typing" });
  } catch (err) {
    // Non-critical, don't throw
    logger.debug(`Failed to send typing indicator: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleMessage(
  chatId: number,
  text: string,
  images?: ImageData[],
  requestId?: string
): Promise<void> {
  const sessionId = `telegram-${chatId}`;
  const reqId = requestId ?? randomUUID();

  // Run with request context for proper logging
  await runWithContext({ requestId: reqId, sessionId }, async () => {
    logger.info(`Processing message`, { chatId, textLength: text.length, hasImages: !!images?.length });

    // Send typing indicator
    await sendTypingWithRetry(chatId);

    try {
      const events = runAgent(text, { llm, sessionId, images, requestId: reqId });
      let finalText = "";
      let hasError = false;

      for await (const event of events) {
        switch (event.type) {
          case "text":
            finalText = event.text;
            break;
          case "tool_result":
            // Send screenshots as photos
            if (event.result?.images) {
              for (const img of event.result.images) {
                try {
                  await sendPhotoWithRetry(chatId, img.data, img.mimeType);
                } catch (err) {
                  logger.error(`Failed to send photo: ${err instanceof Error ? err.message : String(err)}`);
                  // Continue processing other images
                }
              }
            }
            // Send files (video, audio, documents)
            if (event.result?.files) {
              for (const f of event.result.files) {
                try {
                  await sendFileWithRetry(chatId, f.path, f.mimeType);
                } catch (err) {
                  logger.error(`Failed to send file: ${err instanceof Error ? err.message : String(err)}`);
                  // Continue processing other files
                }
              }
            }
            // Keep typing indicator alive during tool execution
            await sendTypingWithRetry(chatId);
            break;
          case "error":
            hasError = true;
            await sendTextWithRetry(chatId, `⚠️ 오류: ${event.error}`);
            return;
        }
      }

      if (finalText && !hasError) {
        await sendTextWithRetry(chatId, finalText);
      }

      logger.info(`Message processing completed`, { chatId, hasError });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Telegram handler error: ${msg}`);
      try {
        await sendTextWithRetry(chatId, `오류가 발생했습니다: ${msg}`);
      } catch (sendErr) {
        logger.error(`Failed to send error message: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`);
      }
    }
  });
}

export async function startTelegramBot(
  botToken: string,
  llmClient: LLMClient
): Promise<void> {
  if (isRunning) {
    logger.warn("Telegram bot is already running");
    return;
  }

  token = botToken;
  api = `https://api.telegram.org/bot${token}`;
  llm = llmClient;
  isRunning = true;
  consecutiveErrors = 0;

  // Verify token with retry
  let me: { ok: boolean; result?: { username: string } };
  try {
    me = await tg("getMe") as { ok: boolean; result?: { username: string } };
  } catch (err) {
    logger.error(
      `Telegram bot token verification failed: ${err instanceof Error ? err.message : String(err)}`
    );
    isRunning = false;
    throw err;
  }

  if (!me.ok) {
    logger.error("Telegram bot token is invalid");
    isRunning = false;
    throw new Error("Invalid Telegram bot token");
  }

  logger.info(`Telegram bot started: @${me.result?.username}`);

  // Long polling loop
  let offset = 0;

  while (!isShutdown() && isRunning) {
    try {
      const res = await tgWithRetry(
        "getUpdates",
        {
          offset,
          timeout: POLL_TIMEOUT,
          allowed_updates: ["message"],
        },
        1 // Only 1 retry for polling to avoid blocking
      ) as { ok: boolean; result?: TelegramUpdate[] };

      if (!res.ok || !res.result) {
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          logger.error(`Too many consecutive errors (${consecutiveErrors}), stopping bot`);
          break;
        }
        continue;
      }

      // Reset error counter on success
      consecutiveErrors = 0;

      for (const update of res.result) {
        offset = update.update_id + 1;

        const msg = update.message;
        if (!msg?.chat?.id) continue;

        const chatId = msg.chat.id;
        const text = msg.text || msg.caption || "";
        const photos = msg.photo;

        // Skip messages with no text and no photo
        if (!text && !photos) continue;

        // Generate unique request ID for this message
        const requestId = randomUUID();

        // Download photo if present (pick largest size — last in array)
        let images: ImageData[] | undefined;
        if (photos && photos.length > 0) {
          const largest = photos[photos.length - 1];
          const img = await downloadPhoto(largest.file_id);
          if (img) images = [img];
        }

        // Handle concurrently — don't block polling
        handleMessage(chatId, text || "이 이미지를 분석해줘", images, requestId).catch((err) =>
          logger.error(`Unhandled telegram error: ${err instanceof Error ? err.message : String(err)}`)
        );
      }
    } catch (err) {
      if (isShutdown()) break;

      consecutiveErrors++;
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Telegram poll error (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${msg}`);

      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        logger.error(`Too many consecutive errors, stopping Telegram bot`);
        break;
      }

      // Exponential backoff
      const backoffMs = Math.min(5000 * Math.pow(2, consecutiveErrors - 1), 60000);
      logger.info(`Backing off for ${backoffMs}ms before retry...`);
      await Bun.sleep(backoffMs);
    }
  }

  isRunning = false;
  logger.info("Telegram bot stopped");
}

export function stopTelegramBot(): void {
  isRunning = false;
}

export function isTelegramBotRunning(): boolean {
  return isRunning;
}

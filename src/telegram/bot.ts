// Telegram bot — long polling bridge to agent

import { runAgent } from "../agent/agent.js";
import { logger } from "../core/logger.js";
import { isShutdown } from "../core/signals.js";
import type { LLMClient } from "../llm/types.js";
import type { ImageData } from "../core/types.js";

const POLL_TIMEOUT = 30; // seconds (Telegram long poll)
const MAX_MSG_LEN = 4096; // Telegram message limit

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

async function tg(method: string, body?: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${api}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json() as any;
  if (!json.ok) logger.warn(`Telegram API error: ${method} — ${JSON.stringify(json)}`);
  return json;
}

async function downloadPhoto(fileId: string): Promise<ImageData | null> {
  try {
    const fileRes = await tg("getFile", { file_id: fileId });
    if (!fileRes.ok || !fileRes.result?.file_path) return null;

    const url = `https://api.telegram.org/file/bot${token}/${fileRes.result.file_path}`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    const mimeType = fileRes.result.file_path.endsWith(".png") ? "image/png" : "image/jpeg";

    return { mimeType, data: buffer.toString("base64") };
  } catch (err) {
    logger.error(`Failed to download photo: ${err}`);
    return null;
  }
}

async function sendText(chatId: number, text: string): Promise<void> {
  // Split long messages
  for (let i = 0; i < text.length; i += MAX_MSG_LEN) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: text.slice(i, i + MAX_MSG_LEN),
    });
  }
}

async function sendPhoto(chatId: number, base64: string, mimeType: string): Promise<void> {
  const blob = new Blob([Buffer.from(base64, "base64")], { type: mimeType });
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("photo", blob, "screenshot.png");

  await fetch(`${api}/sendPhoto`, { method: "POST", body: form });
}

async function handleMessage(chatId: number, text: string, images?: ImageData[]): Promise<void> {
  const sessionId = `telegram-${chatId}`;

  // Send typing indicator
  await tg("sendChatAction", { chat_id: chatId, action: "typing" });

  try {
    const events = runAgent(text, { llm, sessionId, images });
    let finalText = "";

    for await (const event of events) {
      switch (event.type) {
        case "text":
          finalText = event.text;
          break;
        case "tool_result":
          // Send screenshots as photos
          if (event.result?.images) {
            for (const img of event.result.images) {
              await sendPhoto(chatId, img.data, img.mimeType);
            }
          }
          // Keep typing indicator alive during tool execution
          await tg("sendChatAction", { chat_id: chatId, action: "typing" });
          break;
        case "error":
          await sendText(chatId, `⚠️ ${event.error}`);
          return;
      }
    }

    if (finalText) {
      await sendText(chatId, finalText);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Telegram handler error: ${msg}`);
    await sendText(chatId, `오류가 발생했습니다: ${msg}`);
  }
}

export async function startTelegramBot(botToken: string, llmClient: LLMClient): Promise<void> {
  token = botToken;
  api = `https://api.telegram.org/bot${token}`;
  llm = llmClient;

  // Verify token
  const me = await tg("getMe");
  if (!me.ok) {
    logger.error("Telegram bot token is invalid");
    return;
  }
  logger.info(`Telegram bot started: @${me.result.username}`);

  // Long polling loop
  let offset = 0;

  while (!isShutdown()) {
    try {
      const res = await tg("getUpdates", {
        offset,
        timeout: POLL_TIMEOUT,
        allowed_updates: ["message"],
      });

      if (!res.ok || !res.result) continue;

      for (const update of res.result as TelegramUpdate[]) {
        offset = update.update_id + 1;

        const msg = update.message;
        if (!msg?.chat?.id) continue;

        const chatId = msg.chat.id;
        const text = msg.text || msg.caption || "";
        const photos = msg.photo;

        // Skip messages with no text and no photo
        if (!text && !photos) continue;

        // Download photo if present (pick largest size — last in array)
        let images: ImageData[] | undefined;
        if (photos && photos.length > 0) {
          const largest = photos[photos.length - 1];
          const img = await downloadPhoto(largest.file_id);
          if (img) images = [img];
        }

        // Handle concurrently — don't block polling
        handleMessage(chatId, text || "이 이미지를 분석해줘", images).catch((err) =>
          logger.error(`Unhandled telegram error: ${err}`)
        );
      }
    } catch (err) {
      if (isShutdown()) break;
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Telegram poll error: ${msg}`);
      // Back off on error
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  logger.info("Telegram bot stopped");
}

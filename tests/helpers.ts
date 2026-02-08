// Test helpers — SSE stream parsing, chat requests, Docker exec

export const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";

export interface SSEEvent {
  event: string;
  data: Record<string, unknown>;
}

export interface ChatResult {
  events: SSEEvent[];
  toolCalls: string[];
  toolOutputs: string[];
  images: { url: string; mimeType: string }[];
  hasError: boolean;
  isDone: boolean;
}

/** Parse raw SSE text into structured events */
function parseSSE(raw: string): SSEEvent[] {
  const events: SSEEvent[] = [];
  let currentEvent = "";

  for (const line of raw.split("\n")) {
    if (line.startsWith("event: ")) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      try {
        const data = JSON.parse(line.slice(6));
        events.push({ event: currentEvent || "message", data });
      } catch {
        // skip malformed JSON
      }
    }
    // skip heartbeat comments (": heartbeat") and blank lines
  }

  return events;
}

/** POST /api/chat with SSE streaming, returns structured ChatResult */
export async function chat(sessionId: string, message: string): Promise<ChatResult> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, sessionId }),
    signal: AbortSignal.timeout(120_000),
  });

  const raw = await res.text();
  const events = parseSSE(raw);

  const toolCalls: string[] = [];
  const toolOutputs: string[] = [];
  const images: { url: string; mimeType: string }[] = [];
  let hasError = false;
  let isDone = false;

  for (const ev of events) {
    switch (ev.event) {
      case "tool_call":
        if (typeof ev.data.name === "string") toolCalls.push(ev.data.name);
        break;
      case "tool_result": {
        const result = ev.data.result as Record<string, unknown> | undefined;
        if (result?.output && typeof result.output === "string") {
          toolOutputs.push(result.output);
        }
        const imgs = result?.images as Array<Record<string, unknown>> | undefined;
        if (imgs) {
          for (const img of imgs) {
            if (typeof img.url === "string") {
              images.push({ url: img.url, mimeType: String(img.mimeType ?? "") });
            }
          }
        }
        break;
      }
      case "error":
        hasError = true;
        break;
      case "done":
        isDone = true;
        break;
    }
  }

  return { events, toolCalls, toolOutputs, images, hasError, isDone };
}

/** Fetch JSON from a GET endpoint */
export async function fetchJson<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  return res.json() as Promise<T>;
}

/** PUT JSON to an endpoint */
export async function putJson(path: string, body: Record<string, unknown>): Promise<void> {
  await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Run a command inside the Docker container */
export async function dockerExec(...args: string[]): Promise<string> {
  const proc = Bun.spawn(["docker", "exec", "alter", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  return text.trim();
}

/** Generate a unique session ID per test run */
export function sid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

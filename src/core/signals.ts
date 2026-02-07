// Graceful shutdown handling for SIGINT/SIGTERM

type ShutdownHandler = () => void | Promise<void>;

const handlers: ShutdownHandler[] = [];
let isShuttingDown = false;

export function onShutdown(handler: ShutdownHandler): void {
  handlers.push(handler);
}

export function isShutdown(): boolean {
  return isShuttingDown;
}

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\nReceived ${signal}. Shutting down gracefully...`);

  for (const handler of handlers.reverse()) {
    try {
      await handler();
    } catch (err) {
      console.error("Shutdown handler error:", err);
    }
  }

  process.exit(0);
}

export function setupSignalHandlers(): void {
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

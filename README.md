# Helper

Autonomous AI agent that runs in a single Docker container. Connects to Telegram for a chat-based interface — no frontend needed.

Built with Bun.js, SQLite, Gemini API, and Puppeteer.

## Features

- **ReAct Agent Loop** — Plan, execute tools, observe results, repeat
- **6 Built-in Tools** — Shell, File, Web, Code execution, Memory, Browser
- **Telegram Bot** — Chat with your agent from any device
- **Browser Automation** — Navigate, screenshot, click, type via headless Chromium
- **Multimodal** — Send/receive images through Telegram
- **Conversation Memory** — Remembers context within a session
- **Persistent Memory** — Stores facts across sessions via SQLite

## Quick Start

### Prerequisites

- Docker
- [Gemini API Key](https://aistudio.google.com/apikey)
- [Telegram Bot Token](https://t.me/BotFather) (`/newbot`)

### Run

```bash
docker build -t helper .

docker run -d --name helper \
  -e GEMINI_API_KEY="your-gemini-key" \
  -e TELEGRAM_TOKEN="your-telegram-token" \
  helper
```

Then message your bot on Telegram.

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GEMINI_API_KEY` | Yes | — | Google Gemini API key |
| `TELEGRAM_TOKEN` | No | — | Telegram bot token |
| `GEMINI_MODEL` | No | `gemini-2.5-flash` | Gemini model to use |
| `PORT` | No | — | Set to enable HTTP API mode |

### Modes

| Mode | Trigger | Description |
|------|---------|-------------|
| Telegram | `TELEGRAM_TOKEN` set | Chat via Telegram bot |
| API | `PORT` set | REST API + SSE streaming |
| CLI | Neither set | Interactive REPL |

Modes can be combined — set both `PORT` and `TELEGRAM_TOKEN` to run API + Telegram simultaneously.

## Architecture

```
src/
  core/       # Types, errors, logger, signal handling
  db/         # SQLite schema, memory/tasks/config CRUD
  llm/        # Gemini client, retry logic
  tools/      # Shell, file, web, code, memory, browser
  agent/      # ReAct loop, planner, executor, stuck detection
  telegram/   # Telegram bot (long polling)
  api/        # HTTP server, REST routes, SSE streaming
  cli/        # REPL, commands, rendering
  index.ts    # Entry point
```

## Tools

| Tool | Description |
|------|-------------|
| `shell` | Execute bash commands |
| `file` | Read, write, list, search files |
| `web` | HTTP requests (GET/POST) |
| `code` | Run Python/JavaScript/Bash snippets |
| `memory` | Persistent key-value storage |
| `browser` | Navigate, screenshot, click, type, evaluate JS |

## Development

```bash
# Install dependencies
bun install

# Run locally (CLI mode)
GEMINI_API_KEY="your-key" bun run src/index.ts

# Build
bun run build

# Test
bun test tests/
```

## License

MIT

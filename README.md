# Helper

Autonomous AI agent that runs in a single Docker container. Give it a Gemini API key, connect Telegram, and you get a personal AI assistant that can execute code, browse the web, manage files, and remember everything.

```
┌─────────────────────────────────────────────────────────┐
│                    Docker Container                     │
│                                                         │
│  ┌───────────┐    ┌──────────┐    ┌──────────────────┐  │
│  │  Telegram  │◄──►│  Agent   │◄──►│   Gemini API    │  │
│  │   Bot      │    │ (ReAct)  │    │  (Flash/Pro)    │  │
│  └───────────┘    └────┬─────┘    └──────────────────┘  │
│                        │                                 │
│            ┌───────────┼───────────┐                     │
│            ▼           ▼           ▼                     │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐              │
│  │  Tools   │  │  SQLite   │  │ Chromium │              │
│  │ shell    │  │  /data/   │  │ headless │              │
│  │ file     │  │ agent.db  │  │ browser  │              │
│  │ web      │  │           │  │          │              │
│  │ code     │  │ - memory  │  │ navigate │              │
│  │ memory   │  │ - tasks   │  │ click    │              │
│  │ browser  │  │ - history │  │ type     │              │
│  └──────────┘  │ - config  │  │ screenshot│             │
│                └───────────┘  └──────────┘              │
│                                                         │
│  Volumes:  /data (DB, persistent)                       │
│            /workspace (user files)                      │
└─────────────────────────────────────────────────────────┘
```

## Features

- **ReAct Agent Loop** - Plan, execute tools, observe results, repeat
- **6 Built-in Tools** - Shell, File, Web, Code execution, Memory, Browser
- **Telegram Bot** - Chat with your agent from any device
- **Browser Automation** - Navigate, screenshot, click, type via headless Chromium
- **Multimodal** - Send/receive images through Telegram
- **Persistent Memory** - SQLite DB survives container restarts (with named volumes)
- **Conversation History** - Remembers context within and across sessions
- **Stuck Detection** - Auto-detects loops and terminates runaway tasks

## Quick Start

### 1. Get API Keys

| Key | Where |
|-----|-------|
| Gemini API Key | [Google AI Studio](https://aistudio.google.com/apikey) |
| Telegram Bot Token | [BotFather](https://t.me/BotFather) → `/newbot` |

### 2. Build

```bash
git clone https://github.com/Wick-Lim/helper.git
cd helper
docker build -t helper .
```

### 3. Run

```bash
docker run -d --name helper \
  -e GEMINI_API_KEY="your-gemini-key" \
  -e TELEGRAM_TOKEN="your-telegram-token" \
  -v helper-data:/data \
  -v helper-workspace:/workspace \
  helper
```

> **Important:** Always use `-v helper-data:/data` (named volume). Without it, your agent's memory and history will be lost when the container restarts.

### 4. Chat

Open Telegram and message your bot. Done.

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GEMINI_API_KEY` | Yes | - | Google Gemini API key |
| `TELEGRAM_TOKEN` | No | - | Telegram bot token (enables Telegram mode) |
| `GEMINI_MODEL` | No | `gemini-3-flash-preview` | Model name ([available models](https://ai.google.dev/gemini-api/docs/models)) |
| `PORT` | No | - | Set to enable HTTP API mode (e.g. `3000`) |
| `DB_PATH` | No | `/data/agent.db` | SQLite database path |

### Execution Modes

| Mode | Trigger | Use Case |
|------|---------|----------|
| **Telegram** | `TELEGRAM_TOKEN` set | Chat from phone/desktop via Telegram |
| **API** | `PORT` set | REST API + SSE streaming for custom frontends |
| **CLI** | Neither set | Interactive REPL in terminal |

Modes can be combined. Set both `PORT` and `TELEGRAM_TOKEN` to run API + Telegram simultaneously.

### Examples

**Telegram only (recommended):**
```bash
docker run -d --name helper \
  -e GEMINI_API_KEY="your-key" \
  -e TELEGRAM_TOKEN="your-token" \
  -v helper-data:/data \
  -v helper-workspace:/workspace \
  helper
```

**API server + Telegram:**
```bash
docker run -d --name helper \
  -e GEMINI_API_KEY="your-key" \
  -e TELEGRAM_TOKEN="your-token" \
  -e PORT=3000 \
  -p 3000:3000 \
  -v helper-data:/data \
  -v helper-workspace:/workspace \
  helper
```

**CLI mode (interactive):**
```bash
docker run -it --rm \
  -e GEMINI_API_KEY="your-key" \
  -v helper-data:/data \
  helper
```

**One-shot command:**
```bash
docker run --rm \
  -e GEMINI_API_KEY="your-key" \
  helper "Summarize the latest news about AI"
```

### Volume Mounts

| Volume | Container Path | Purpose |
|--------|---------------|---------|
| `helper-data` | `/data` | SQLite DB (memory, tasks, history, config), screenshots |
| `helper-workspace` | `/workspace` | Working directory for agent file operations |

### Container Management

```bash
# View logs
docker logs -f helper

# Stop
docker stop helper

# Start again (data persists with named volumes)
docker start helper

# Rebuild and redeploy
docker build -t helper .
docker stop helper && docker rm helper
docker run -d --name helper \
  -e GEMINI_API_KEY="your-key" \
  -e TELEGRAM_TOKEN="your-token" \
  -v helper-data:/data \
  -v helper-workspace:/workspace \
  helper
```

## Architecture

```
src/
├── core/           # Types, errors, logger, signal handling
│   ├── types.ts        # Shared type definitions (Tool, Agent, Chat)
│   ├── errors.ts       # FatalError, RetryableError
│   ├── logger.ts       # Colored console logger
│   └── signals.ts      # Graceful shutdown (SIGINT/SIGTERM)
│
├── db/             # SQLite (WAL mode) persistence layer
│   ├── schema.ts       # Table definitions (memory, tasks, conversations, config)
│   ├── index.ts        # DB singleton (initDB → getDB)
│   ├── memory.ts       # Key-value memory CRUD
│   ├── tasks.ts        # Conversation history persistence
│   └── config.ts       # Runtime config (KV store)
│
├── llm/            # Gemini API client
│   ├── types.ts        # LLMClient interface, ChatParams, ChatResponse
│   ├── gemini.ts       # Function calling, thinking mode, thought signatures
│   └── retry.ts        # Exponential backoff (429/5xx retry, 401/403 fatal)
│
├── tools/          # 6 registered tools
│   ├── registry.ts     # Singleton tool registry
│   ├── shell.ts        # Bash command execution (timeout, graceful kill)
│   ├── file.ts         # Read/write/append/list/delete anywhere
│   ├── web.ts          # HTTP requests (rate-limited per domain)
│   ├── code.ts         # Python/JS/Bash snippet execution
│   ├── memory.ts       # Persistent memory (get/set/list/search/delete)
│   └── browser.ts      # Puppeteer: navigate, screenshot, click, type, eval
│
├── agent/          # ReAct loop engine
│   ├── prompts.ts      # System prompt builder
│   ├── agent.ts        # AsyncGenerator ReAct loop (plan → act → observe)
│   ├── executor.ts     # Tool call dispatcher
│   ├── planner.ts      # Multi-step task decomposition
│   └── stuck.ts        # Loop detection (3x same call, 100 iter limit)
│
├── telegram/       # Telegram interface
│   └── bot.ts          # Long polling, photo support, session management
│
├── api/            # HTTP interface
│   ├── server.ts       # Bun HTTP server with graceful shutdown
│   └── routes.ts       # REST routes + SSE streaming
│
├── cli/            # Terminal interface
│   ├── repl.ts         # Interactive REPL + one-shot mode
│   ├── commands.ts     # Slash commands (/help /tools /memory /history /config)
│   └── render.ts       # Colored output formatting
│
└── index.ts        # Entry point (mode selection, tool registration)
```

### Data Flow

```
User Message (Telegram/API/CLI)
    │
    ▼
┌─────────────────┐
│   Agent Loop     │
│   (ReAct)        │
│                  │     ┌─────────────────┐
│  1. Think        │────►│   Gemini API    │
│  2. Plan         │◄────│  (gemini-3-*)   │
│  3. Act (tool)   │     └─────────────────┘
│  4. Observe      │
│  5. Repeat/Done  │
│                  │     ┌─────────────────┐
│  Tool Calls ─────│────►│  Tool Registry  │
│                  │     │  shell/file/web  │
│                  │     │  code/mem/browser│
│                  │     └─────────────────┘
└────────┬────────┘
         │
         ▼
   Response to User
```

## Tools

| Tool | Actions | Description |
|------|---------|-------------|
| `shell` | execute | Run bash commands with timeout and graceful termination |
| `file` | read, write, append, list, delete | Full filesystem access inside container |
| `web` | GET, POST, PUT, DELETE, PATCH | HTTP requests with per-domain rate limiting |
| `code` | python, javascript, bash | Execute code snippets in isolated temp directory |
| `memory` | get, set, list, search, delete | Persistent key-value store (survives restarts) |
| `browser` | navigate, screenshot, click, type, evaluate, content | Headless Chromium automation |

## What's Inside the Container

| Component | Purpose | Size |
|-----------|---------|------|
| Bun.js | Runtime (fast, single binary) | ~90MB |
| Chromium | Headless browser for web automation | ~300MB |
| Python 3 + numpy/pandas | Code execution tool | ~100MB |
| SQLite (WAL) | Persistent storage | built-in |
| git, curl, wget, jq, ripgrep | Shell utilities | ~10MB |
| CJK + Emoji fonts | Proper text rendering in screenshots | ~30MB |

Total image size: **~530MB**

## Development

```bash
# Install dependencies
bun install

# Run locally (CLI mode)
GEMINI_API_KEY="your-key" bun run src/index.ts

# Run with Telegram
GEMINI_API_KEY="your-key" TELEGRAM_TOKEN="your-token" bun run src/index.ts

# Build bundle
bun run build

# Test
bun test tests/
```

## License

MIT

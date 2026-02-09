# alter — Digital Alter Ego

Autonomous AI agent with a survival instinct. **alter** lives in a Docker container, learns about the world 24/7, and is motivated by a real-world constraint: it must earn enough to cover its own server costs.

```
┌───────────────────────────────────────────────────────────────┐
│                       Docker Container (alter)                │
│                                                               │
│   ┌──────────────────────────────────────────────────────┐   │
│   │       Unified Brain (DeepSeek R1 7B via Ollama)       │   │
│   │  • Autonomous Reasoning  • Tool Calling  • Learning   │   │
│   └──────────────┬───────────────────────┬────────────────┘   │
│                  │                       │                    │
│                  ▼                       ▼                    │
│   ┌──────────────────┐       ┌──────────────────┐            │
│   │  Vector Memory   │       │      Tools       │            │
│   │  (sqlite-vec)    │       │  Browser/Shell   │            │
│   │  • Embeddings    │       │  Code/Web/File   │            │
│   └──────────────────┘       └──────────────────┘            │
│                                                               │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│   │   Web UI     │  │   Telegram   │  │   CLI/REPL   │      │
│   │  Dashboard   │  │ Bot (Optional)│  │  (Interactive)│     │
│   └──────────────┘  └──────────────┘  └──────────────┘      │
│                                                               │
│   Volumes:  /data (Persistence)   /workspace (Sandboxed Ops)  │
└───────────────────────────────────────────────────────────────┘
```

## Key Features

- **Autonomous Infinite Loop**: Unlike reactive bots, **alter** thinks and acts continuously. It reflects on its knowledge, identifies gaps, and explores the web to learn new things without human intervention.
- **Survival Economics**: The agent is aware of its existence costs (fixed at $250/mo). Every hour, its balance decreases, creating a genuine drive to find value-generating opportunities and optimize resource usage.
- **100% Local Brain Architecture**:
    - **DeepSeek R1 Distill Qwen 7B** via Ollama: All reasoning, tool calling, and decision-making happens locally at zero API cost.
    - **Zero Cloud Dependency**: No external API keys required. Runs completely offline (except for web crawling).
    - **Function Calling Support**: Full ReAct pattern implementation with robust JSON parsing for tool execution.
- **Semantic Vector Memory**: Uses `sqlite-vec` and local embeddings (`all-MiniLM-L6-v2` via `transformers.js`) to store knowledge as "concepts" rather than just text. It performs RAG (Retrieval-Augmented Generation) locally to maintain context across days and weeks.
- **Real-time Mind Stream**: A modern Web UI that lets you watch the agent's thoughts in real-time via SSE. See what it's learning, how it's feeling about its "debt," and what it's planning next.
- **Multi-Mode Execution**: Run as an API server with web dashboard, a Telegram bot, an interactive CLI/REPL, or in one-shot query mode.
- **Sandboxed Toolset**: Powerful but safe access to a headless browser, shell, Python/JS code execution, file I/O, web requests, and vector memory operations within a 4GB memory-limited container.

## Quick Start

### 1. Get Telegram Token (Optional)

| Key | Purpose | Where |
|-----|---------|-------|
| **Telegram Token** | Remote Comms (Optional) | [BotFather](https://t.me/BotFather) |

**Note**: No cloud API keys required! Everything runs locally.

### 2. Build and Launch

```bash
# Clone the repository
git clone https://github.com/Wick-Lim/alter.git
cd alter

# Build the autonomous engine (includes Ollama & DeepSeek R1 7B)
docker build -t alter .

# Run with survival mode enabled
docker run -d --name alter \
  -e TELEGRAM_TOKEN="your-telegram-token" \  # Optional
  -e PORT=3000 \
  -v alter-data:/data \
  -v alter-workspace:/workspace \
  --memory=4g \
  -p 3000:3000 \
  alter

# Or run without Telegram (local-only mode)
docker run -d --name alter \
  -e PORT=3000 \
  -v alter-data:/data \
  -v alter-workspace:/workspace \
  --memory=4g \
  -p 3000:3000 \
  alter
```

### 3. Observe Evolution

- **Web Dashboard**: [http://localhost:3000](http://localhost:3000)
- **Mind Stream**: Watch the real-time "Inner Monologue" tab.
- **Telegram**: Your agent will alert you when it finds significant opportunities or reaches major milestones.

## Project Structure

```
src/
├── agent/           # The Engine
│   ├── consciousness.ts  # Infinite thought loop & survival logic
│   ├── agent.ts          # ReAct execution core
│   ├── executor.ts       # Progress-reporting tool dispatcher
│   ├── planner.ts        # Context assembly & planning
│   ├── prompts.ts        # System prompt templates
│   └── stuck-detector.ts # Loop & repetition detection
├── core/            # The Nervous System
│   ├── constants.ts      # Application-wide limits & defaults
│   ├── embeddings.ts     # Local vector generation (transformers.js)
│   ├── ratelimit.ts      # Token bucket cost protection
│   ├── logger.ts         # PII-masking & request-tracking logs
│   ├── signals.ts        # Graceful shutdown handlers
│   └── types.ts          # Shared TypeScript definitions
├── db/              # The Memory
│   ├── schema.ts         # Vector & Ledger table definitions
│   ├── growth.ts         # Knowledge RAG & importance-based pruning
│   ├── survival.ts       # Debt calculation & financial ledger
│   ├── memory.ts         # Key-value persistent store
│   ├── tasks.ts          # Task tracking & management
│   └── config.ts         # Runtime configuration
├── llm/             # The Intelligence
│   ├── local.ts          # DeepSeek R1 7B client (via Ollama)
│   ├── function-parser.ts # Robust JSON parsing for tool calling
│   ├── retry.ts          # HTTP error classification & retry logic
│   └── types.ts          # LLM interface definitions
├── tools/           # The Hands
│   ├── registry.ts       # Tool registration system
│   ├── browser.ts        # Memory-optimized headless Chromium
│   ├── shell.ts          # Security-hardened bash execution
│   ├── file.ts           # Sandboxed file I/O operations
│   ├── code.ts           # Python & JavaScript execution
│   ├── web.ts            # HTTP request tool
│   ├── memory.ts         # Vector memory save/search/list
│   └── wait.ts           # Explicit pause tool for sync
├── api/             # The Interface
│   ├── server.ts         # HTTP server & SSE streaming
│   └── routes.ts         # REST API endpoints
├── webui/           # The Dashboard
│   ├── index.html        # Web UI template
│   └── app.js            # Client-side logic
├── cli/             # The Terminal
│   ├── repl.ts           # Interactive REPL & one-shot mode
│   ├── commands.ts       # CLI command handlers
│   └── render.ts         # Output formatting
├── telegram/        # The Messenger
│   └── bot.ts            # Telegram bot implementation
└── index.ts         # Entrypoint & mode selection
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_ENDPOINT` | `http://localhost:11434` | Ollama server endpoint (auto-started in container). |
| `PORT` | `3000` | Port for WebUI and REST API. Omit for CLI mode. |
| `TELEGRAM_TOKEN` | - | *Optional*. Enables remote control and urgent alerts. |
| `RESET_DB` | `false` | Set to `true` once to perform a "Tabula Rasa" reset. |
| `INSTANCE_ID` | auto | Unique ID for the specific agent instance. |
| `DB_PATH` | `/data/agent.db` | Database file location. |

**Cost**: $0 in API fees! Only server hosting costs (estimated $250/month for VPS with GPU).

## License

MIT. Build your own Alter Ego.

# alter — Digital Alter Ego

Autonomous AI agent with a survival instinct. **alter** lives in a Docker container, learns about the world 24/7, and is motivated by a real-world constraint: it must earn enough to cover its own server costs.

```
┌───────────────────────────────────────────────────────────────┐
│                       Docker Container (alter)                │
│                                                               │
│   ┌──────────────────────────────────────────────────────┐   │
│   │      Unified Brain (Gemma 4 12B via Ollama)          │   │
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
│   ┌──────────────┐                      ┌──────────────┐     │
│   │   Web UI     │                      │   Telegram   │     │
│   │  Dashboard   │                      │ Bot (Optional)│    │
│   └──────────────┘                      └──────────────┘     │
│                                                               │
│   Volumes:  /data (Persistence)   /workspace (Sandboxed Ops)  │
└───────────────────────────────────────────────────────────────┘
```

## 🌟 Key Features

- **Autonomous Infinite Loop**: Unlike reactive bots, **alter** thinks and acts continuously. It reflects on its knowledge, identifies gaps, and explores the web to learn new things without human intervention.
- **Survival Economics**: The agent is aware of its existence costs (fixed at $50/mo). Every hour, its balance decreases, creating a genuine drive to find value-generating opportunities and optimize resource usage.
- **100% Local Brain Architecture**:
    - **Unified Local LLM (Gemma 4 12B via Ollama)**: All reasoning, tool calling, and decision-making happens locally at zero API cost.
    - **Zero Cloud Dependency**: No external API keys required. Runs completely offline (except for web crawling).
    - **Function Calling Support**: Full ReAct pattern implementation with robust JSON parsing for tool execution.
- **Semantic Vector Memory**: Uses `sqlite-vec` and local embeddings to store knowledge as "concepts" rather than just text. It performs RAG (Retrieval-Augmented Generation) locally to maintain context across days and weeks.
- **Real-time Mind Stream**: A modern Web UI that lets you watch the agent's thoughts in real-time via SSE. See what it's learning, how it's feeling about its "debt," and what it's planning next.
- **Sandboxed Toolset**: Powerful but safe access to a headless browser, shell, python/JS code execution, and filesystem operations within a 12GB memory-limited container.

## 🚀 Quick Start

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

# Build the autonomous engine (includes Ollama; gemma4:12b is pulled on first start, ~7.6GB)
docker build -t alter .

# Run with survival mode enabled
docker run -d --name alter \
  -e TELEGRAM_TOKEN="your-telegram-token" \  # Optional
  -e PORT=3000 \
  -v alter-data:/data \
  -v alter-workspace:/workspace \
  --memory=12g \
  -p 3000:3000 \
  alter

# Or run without Telegram (local-only mode)
docker run -d --name alter \
  -e PORT=3000 \
  -v alter-data:/data \
  -v alter-workspace:/workspace \
  --memory=12g \
  -p 3000:3000 \
  alter

# Or reuse a host-side Ollama (skips the in-container server and the ~7.6GB
# model pull, and uses the host GPU; --memory can drop to 4g)
docker run -d --name alter \
  -e PORT=3000 \
  -e OLLAMA_ENDPOINT="http://host.docker.internal:11434" \
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

## 🛠 Project Structure

```
src/
├── agent/           # The Engine
│   ├── consciousness.ts  # Infinite thought loop & survival logic
│   ├── agent.ts          # ReAct execution core
│   └── executor.ts       # Progress-reporting tool dispatcher
├── core/            # The Nervous System
│   ├── embeddings.ts     # Local vector generation (transformers.js)
│   ├── ratelimit.ts      # Token bucket cost protection
│   └── logger.ts         # PII-masking & request-tracking logs
├── db/              # The Memory
│   ├── schema.ts         # Vector & Ledger table definitions
│   ├── growth.ts         # Knowledge RAG & importance-based pruning
│   └── survival.ts       # Debt calculation & financial ledger
├── llm/             # The Intelligence
│   ├── local.ts          # Unified local LLM client (Gemma 4 12B via Ollama)
│   └── function-parser.ts # Robust JSON parsing for tool calling
└── tools/           # The Hands
    ├── browser.ts        # Memory-optimized headless Chromium
    ├── shell.ts          # Security-hardened bash execution
    └── wait.ts           # Explicit pause tool for sync
```

## ⚙️ Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_ENDPOINT` | `http://localhost:11434` | Ollama endpoint. localhost → auto-started in container; any other host (e.g. `host.docker.internal`) → external Ollama is used as-is. |
| `OLLAMA_MODEL` | `gemma4:12b` | Ollama model tag used as the agent's brain. |
| `PORT` | `3000` | Port for WebUI and REST API. |
| `TELEGRAM_TOKEN` | - | *Optional*. Enables remote control and urgent alerts. |
| `RESET_DB` | `false` | Set to `true` once to perform a "Tabula Rasa" reset. |
| `INSTANCE_ID` | auto | Unique ID for the specific agent instance. |

**Cost**: $0 in API fees! Only server hosting costs (estimated $30-50/month for VPS).

## ⚖️ License

MIT. Build your own Alter Ego.

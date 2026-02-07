# ── Stage 1: Build ──────────────────────────────────
FROM oven/bun:1-debian AS builder
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install
COPY src/ src/
COPY tsconfig.json ./
RUN bun build --target=bun --outfile=dist/index.js src/index.ts

# ── Stage 2: Runtime ───────────────────────────────
FROM oven/bun:1-debian

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    git curl wget jq ripgrep \
    chromium \
    ffmpeg \
    fonts-noto-cjk fonts-noto-color-emoji \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --break-system-packages --no-cache-dir \
    requests pandas numpy

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# 번들만 복사 — node_modules, src 불필요
COPY --from=builder /app/dist/index.js ./dist/index.js

RUN mkdir -p /workspace /data /data/screenshots /tmp/agent

VOLUME ["/workspace", "/data"]

ENV GEMINI_API_KEY=""
ENV GEMINI_MODEL="gemini-3-flash-preview"

EXPOSE 3000

ENTRYPOINT ["bun", "run", "dist/index.js"]

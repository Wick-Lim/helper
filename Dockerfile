# ── Stage 1: Build native dependencies ────────
FROM debian:bookworm-slim AS native-builder
RUN apt-get update && apt-get install -y \
    build-essential gcc wget \
    libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Get sqlite-vec amalgamation and build it
RUN wget https://github.com/asg017/sqlite-vec/releases/download/v0.1.6/sqlite-vec-0.1.6-amalgamation.tar.gz \
    && tar -xzf sqlite-vec-0.1.6-amalgamation.tar.gz \
    && gcc -fPIC -shared -O3 sqlite-vec.c -o vec0.so -lm

# ── Stage 2: Runtime ───────────────────────────────
FROM oven/bun:1-debian

# System packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    git curl wget jq ripgrep unzip zstd \
    ca-certificates \
    chromium \
    fonts-noto-cjk fonts-noto-color-emoji \
    ffmpeg imagemagick graphviz pandoc \
    libreoffice-writer libreoffice-calc libreoffice-impress \
    libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf-2.0-0 libffi-dev libcairo2 \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# Install Ollama for local LLM (DeepSeek R1)
RUN curl -fsSL https://ollama.com/install.sh | sh

# Remove ImageMagick PDF restriction
RUN sed -i 's/rights="none" pattern="PDF"/rights="read|write" pattern="PDF"/' /etc/ImageMagick-6/policy.xml 2>/dev/null || true

# Python packages
RUN pip install --break-system-packages --no-cache-dir \
    requests pandas numpy pillow opencv-python-headless \
    matplotlib seaborn moviepy beautifulsoup4 lxml \
    weasyprint reportlab yt-dlp pydub svgwrite qrcode

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copy sqlite-vec extension
COPY --from=native-builder /build/vec0.so /usr/local/lib/sqlite-vec.so

# Install Node dependencies
COPY package.json bun.lock* ./
RUN bun install

# Pre-download embedding model for transformers.js
RUN bun -e "import { pipeline, env } from '@xenova/transformers'; env.allowLocalModels = false; env.cacheDir = '/app/models-cache'; await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');"

# Copy source
COPY src/ src/
COPY tsconfig.json ./
COPY entrypoint.sh ./

RUN mkdir -p /workspace /data /data/screenshots /app/models-cache /tmp/agent && \
    chmod +x entrypoint.sh

# Set up environment
VOLUME ["/workspace", "/data"]
ENV MODAL_ENDPOINT=""
ENV PORT=3000
ENV INSTANCE_ID="alter-main"
ENV SQLITE_VEC_PATH="/usr/local/lib/sqlite-vec"

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]

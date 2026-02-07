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

# System packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Core utilities
    python3 python3-pip python3-venv \
    git curl wget jq ripgrep unzip \
    ca-certificates \
    # Browser
    chromium \
    fonts-noto-cjk fonts-noto-color-emoji \
    # Media processing
    ffmpeg \
    imagemagick \
    graphviz \
    # Document conversion
    pandoc \
    libreoffice-writer libreoffice-calc libreoffice-impress --no-install-recommends \
    # WeasyPrint system deps
    libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf-2.0-0 libffi-dev libcairo2 \
    && rm -rf /var/lib/apt/lists/*

# Remove ImageMagick PDF restriction (needed for PDF operations)
RUN sed -i 's/rights="none" pattern="PDF"/rights="read|write" pattern="PDF"/' /etc/ImageMagick-6/policy.xml 2>/dev/null || true

# Python packages
RUN pip install --break-system-packages --no-cache-dir \
    # Data
    requests pandas numpy \
    # Image processing
    pillow opencv-python-headless \
    # Charts & visualization
    matplotlib seaborn \
    # Video editing
    moviepy \
    # Web scraping
    beautifulsoup4 lxml \
    # PDF & document generation
    weasyprint reportlab \
    # Media download
    yt-dlp \
    # Utilities
    pydub svgwrite qrcode

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

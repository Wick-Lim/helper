#!/bin/bash
# Alter AI Agent - Entrypoint (Local Gemma 4 via Ollama)
set -e

OLLAMA_MODEL="${OLLAMA_MODEL:-gemma4:12b}"

echo "Starting Ollama server..."
ollama serve &
OLLAMA_PID=$!

# Wait for Ollama to be ready (up to ~30s)
echo "Waiting for Ollama to start..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "Ollama is ready."
    break
  fi
  sleep 1
done

# Pull Gemma 4 model (if not already cached)
echo "Pulling ${OLLAMA_MODEL} model..."
ollama pull "${OLLAMA_MODEL}" || true

echo "Starting Alter with ${OLLAMA_MODEL} (local reasoning engine)..."
exec bun run src/index.ts

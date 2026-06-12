#!/bin/bash
# Alter AI Agent - Entrypoint (Gemma 4 via Ollama)
set -e

OLLAMA_MODEL="${OLLAMA_MODEL:-gemma4:12b}"
OLLAMA_ENDPOINT="${OLLAMA_ENDPOINT:-http://localhost:11434}"

if [[ "$OLLAMA_ENDPOINT" == http://localhost:* || "$OLLAMA_ENDPOINT" == http://127.0.0.1:* ]]; then
  echo "Starting Ollama server..."
  ollama serve &

  # Wait for Ollama to be ready (up to ~30s)
  echo "Waiting for Ollama to start..."
  for i in $(seq 1 30); do
    if curl -sf "${OLLAMA_ENDPOINT}/api/tags" > /dev/null 2>&1; then
      echo "Ollama is ready."
      break
    fi
    sleep 1
  done

  # Pull the model (if not already cached)
  echo "Pulling ${OLLAMA_MODEL} model..."
  ollama pull "${OLLAMA_MODEL}" || true
else
  # External Ollama (e.g. http://host.docker.internal:11434 to reuse the host's
  # models and GPU): skip the in-container server and model pull entirely
  echo "Using external Ollama at ${OLLAMA_ENDPOINT}..."
  for i in $(seq 1 30); do
    if curl -sf "${OLLAMA_ENDPOINT}/api/tags" > /dev/null 2>&1; then
      echo "External Ollama is reachable."
      break
    fi
    sleep 1
  done
fi

echo "Starting Alter with ${OLLAMA_MODEL} (reasoning engine)..."
exec bun run src/index.ts

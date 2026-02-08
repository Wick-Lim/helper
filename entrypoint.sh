#!/bin/bash
# Alter AI Agent - Entrypoint (Local DeepSeek R1)
set -e

echo "Starting Ollama server..."
ollama serve &
OLLAMA_PID=$!

# Wait for Ollama to be ready
echo "Waiting for Ollama to start..."
sleep 5

# Pull DeepSeek R1 Distill Qwen model (if not already cached)
echo "Pulling DeepSeek R1 Distill Qwen 7B model..."
ollama pull deepseek-r1:7b || true

echo "Starting Alter with DeepSeek R1 (local reasoning engine)..."
exec bun run src/index.ts

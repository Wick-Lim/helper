#!/bin/bash
# Alter AI Agent - Entrypoint (Modal.com GPU backend)
echo "Starting Alter with Modal.com (Qwen 2.5 14B AWQ)..."
exec bun run src/index.ts

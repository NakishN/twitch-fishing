#!/bin/bash
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "Starting Twitch Fishing Game Server..."
echo "Open control panel at: http://localhost:3000"
echo "Press Ctrl+C to stop the server."
"$PROJECT_DIR/venv/bin/python3" "$PROJECT_DIR/server.py"

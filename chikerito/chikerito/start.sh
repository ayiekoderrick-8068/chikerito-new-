#!/bin/bash
# Chikerito — one-command local startup (macOS/Linux)
set -e
cd "$(dirname "$0")"

if [ ! -d "backend/node_modules" ] || [ ! -d "frontend/node_modules" ]; then
  echo "Installing dependencies (first run only)..."
  npm run setup
fi

if [ ! -f "backend/data/db.json" ]; then
  echo "Seeding demo data..."
  npm run seed
fi

echo ""
echo "Starting Chikerito — backend on :4000, frontend on :5173"
echo "Demo login: demo@chikerito.com / chikerito123"
echo ""
npm run dev

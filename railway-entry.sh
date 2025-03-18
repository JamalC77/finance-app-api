#!/bin/bash
set -e

echo "Starting Railway entry script"

# Function to start emergency health server
start_emergency_server() {
  echo "Starting emergency health server..."
  node emergency-health.js &
  EMERGENCY_PID=$!
  echo "Emergency server started with PID $EMERGENCY_PID"
}

# Check if the prisma directory exists
if [ -d "/app/prisma" ]; then
  echo "Prisma directory found"
  ls -la /app/prisma
else
  echo "Prisma directory NOT found"
  mkdir -p /app/prisma
  echo "Created prisma directory"
fi

# Check if schema.prisma exists
if [ -f "/app/prisma/schema.prisma" ]; then
  echo "schema.prisma file found"
  head -n 10 /app/prisma/schema.prisma
else
  echo "ERROR: schema.prisma file NOT found!"
  start_emergency_server
fi

# Try to generate Prisma client again
echo "Regenerating Prisma client..."
if ! npx prisma generate --schema=/app/prisma/schema.prisma; then
  echo "Prisma generate failed, starting emergency server"
  start_emergency_server
fi

# Check if dist directory exists or is empty
if [ ! -d "/app/dist" ] || [ -z "$(ls -A /app/dist)" ]; then
  echo "Dist directory empty or not found, attempting to rebuild..."
  if ! npm run build:tsc -- --skipLibCheck --noEmit false --noEmitOnError false; then
    echo "Build failed, starting emergency server"
    start_emergency_server
  fi
fi

# Check for health endpoint file
if [ ! -f "/app/dist/index.js" ]; then
  echo "ERROR: Main application file missing!"
  ls -la /app/dist || echo "dist directory not found"
  start_emergency_server
  # Keep emergency server running
  wait $EMERGENCY_PID
  exit 0
fi

# Start the main application
echo "Starting main application..."
node dist/index.js 
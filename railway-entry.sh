#!/bin/bash
set -e

echo "Starting Railway entry script"

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
fi

# Try to generate Prisma client again
echo "Regenerating Prisma client..."
npx prisma generate --schema=/app/prisma/schema.prisma

# Check if dist directory exists or is empty
if [ ! -d "/app/dist" ] || [ -z "$(ls -A /app/dist)" ]; then
  echo "Dist directory empty or not found, attempting to rebuild..."
  npm run build:tsc -- --skipLibCheck --noEmit false --noEmitOnError false || true
fi

# Start the application
echo "Starting application..."
exec npm start 
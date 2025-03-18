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

# Try to generate Prisma client
echo "Generating Prisma client..."
npx prisma generate --schema=/app/prisma/schema.prisma

# Start the application
echo "Starting application..."
exec npm start 
FROM node:18-slim

WORKDIR /app

# Install required system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Debug: List current directory
RUN ls -la

# Copy scripts and fallback files first
COPY verify-prisma.js railway-entry.sh fix-types.js emergency-health.js index.js ./
RUN chmod +x railway-entry.sh

# Copy prisma schema directory explicitly
COPY prisma/ ./prisma/

# Verify the prisma directory
RUN ls -la prisma/ && node verify-prisma.js

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies without running postinstall script
RUN npm install --ignore-scripts

# Now copy the rest of the app
COPY . .

# Generate Prisma client manually with absolute path
RUN npx prisma generate --schema=/app/prisma/schema.prisma || echo "Will retry prisma generate on startup"

# Fix TypeScript errors
RUN node fix-types.js

# Build the application with more permissive settings
RUN npm run build:tsc -- --skipLibCheck --noEmit false --noEmitOnError false || true

# Create a simple health endpoint file for direct use if needed
RUN echo "console.log('Health check app ready');" >> /app/dist/health.js

# Expose API port
EXPOSE 5000

# Start the server using the simple index.js (which will attempt to load the real app)
CMD ["node", "index.js"] 
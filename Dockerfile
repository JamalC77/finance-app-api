FROM node:18-slim

WORKDIR /app

# Install required system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Debug: List current directory
RUN ls -la

# Copy the verification script and entry script first
COPY verify-prisma.js railway-entry.sh ./
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

# Build the application
RUN npm run build:tsc

# Expose API port
EXPOSE 5000

# Start the server using the entry script
CMD ["./railway-entry.sh"] 
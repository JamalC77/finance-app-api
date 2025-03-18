FROM node:18-slim

WORKDIR /app

# Install required system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy package files first
COPY package.json package-lock.json ./

# Install dependencies (including dev dependencies for build)
RUN npm install

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate --schema=./prisma/schema.prisma

# Build the application - Don't allow failures
RUN npm run build:tsc -- --skipLibCheck --noEmit false --noEmitOnError false

# Expose the API port
EXPOSE 5000

# Start the main application
CMD ["node", "dist/index.js"] 
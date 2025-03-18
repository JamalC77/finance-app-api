FROM node:18-slim

WORKDIR /app

# Install required system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy package files first
COPY package.json package-lock.json ./

# Install dependencies
RUN npm install

# Copy prisma files separately to ensure they're included
COPY prisma ./prisma/

# Generate Prisma client with explicit schema path
RUN npx prisma generate --schema=./prisma/schema.prisma

# Now copy the rest of the app
COPY . .

# Build the application
RUN npm run build

# Expose API port
EXPOSE 5000

# Start the server
CMD ["npm", "start"] 
FROM node:18-slim

WORKDIR /app

# Install required system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci --only=production

# Copy app source
COPY . .

# Generate Prisma client first
RUN npx prisma generate

# Build the application
RUN npm run build

# Expose API port
EXPOSE 5000

# Start the server
CMD ["npm", "start"] 
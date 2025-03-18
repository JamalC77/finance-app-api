FROM node:18-slim

WORKDIR /app

# Install only what's needed for the health check
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy bare minimal health check
COPY bare-health.js ./

# Expose API port
EXPOSE 5000

# Start bare health server - this must be reliable
CMD ["node", "bare-health.js"] 
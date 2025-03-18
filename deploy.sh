#!/bin/bash

echo "Starting deployment of CFO Line API..."

# Install Docker if not already installed
if ! command -v docker &> /dev/null
then
    echo "Docker not found, installing..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    rm get-docker.sh
fi

# Build the Docker image
echo "Building Docker image..."
docker build -t cfo-line-api .

# Stop and remove existing container if it exists
echo "Stopping existing container if running..."
docker stop cfo-line-api 2>/dev/null || true
docker rm cfo-line-api 2>/dev/null || true

# Run the new container
echo "Starting new container..."
docker run -d \
  --name cfo-line-api \
  --restart unless-stopped \
  -p 5000:5000 \
  --env-file .env \
  cfo-line-api

echo "Deployment completed successfully!"
echo "API is now running on port 5000" 
#!/bin/bash

# Deployment script for Finance App API

# Exit on error
set -e

echo "Starting deployment of Finance App API..."

# Build the application
echo "Building the application..."
npm run build

# Create deployment directory if it doesn't exist
DEPLOY_DIR="./deploy"
if [ ! -d "$DEPLOY_DIR" ]; then
  mkdir -p "$DEPLOY_DIR"
fi

# Copy necessary files to deployment directory
echo "Copying files to deployment directory..."
cp -r ./dist "$DEPLOY_DIR"
cp package.json "$DEPLOY_DIR"
cp package-lock.json "$DEPLOY_DIR"
cp .env.example "$DEPLOY_DIR"
cp README.md "$DEPLOY_DIR"

# Create a .env file for production if it doesn't exist
if [ ! -f "$DEPLOY_DIR/.env" ]; then
  echo "Creating .env file for production..."
  cp .env.example "$DEPLOY_DIR/.env"
  echo "Please update the .env file in $DEPLOY_DIR with production values."
fi

echo "Deployment package created in $DEPLOY_DIR"
echo "To deploy to your server:"
echo "1. Copy the contents of $DEPLOY_DIR to your server"
echo "2. Run 'npm install --production' on your server"
echo "3. Update the .env file with production values"
echo "4. Start the server with 'npm start'"

# Optional: Zip the deployment directory
echo "Creating deployment archive..."
cd "$DEPLOY_DIR"
zip -r ../finance-app-api-deploy.zip .
cd ..

echo "Deployment archive created: finance-app-api-deploy.zip"
echo "Deployment preparation complete!" 
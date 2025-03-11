#!/bin/bash
# Setup script for QuickBooks integration

# Ensure we're in the right directory
cd "$(dirname "$0")/.." || exit

echo "Setting up QuickBooks integration..."

# Install required packages
echo "Installing required packages..."
npm install @google-cloud/bigquery @google-cloud/storage axios bcrypt compression express-rate-limit winston

# Create necessary directories
echo "Creating necessary directories..."
mkdir -p config/
mkdir -p logs/

# Check if .env file exists, if not, copy from example
if [ ! -f .env ]; then
  echo "Creating .env file from example..."
  cp .env.example .env
  echo "Please update the .env file with your QuickBooks and Google Cloud credentials."
fi

# Create Google Cloud key placeholder if not exists
if [ ! -f config/google-cloud-key.json ]; then
  echo "Creating placeholder for Google Cloud key..."
  echo '{"placeholder": "Replace with your actual Google Cloud service account key"}' > config/google-cloud-key.json
  echo "Please replace the placeholder with your actual Google Cloud service account key."
fi

# Run Prisma migration
echo "Running Prisma migration..."
npx prisma migrate dev --name add-quickbooks-integration

echo "Setup complete!"
echo "Next steps:"
echo "1. Update your .env file with proper credentials"
echo "2. Replace the Google Cloud key placeholder with your actual key"
echo "3. Start the application: npm run dev" 
#!/bin/bash

echo "Setting up Railway deployment with proper CORS configuration..."

# Login to Railway
echo "Logging in to Railway..."
railway login

# Set the FRONTEND_URL environment variable
echo "Setting FRONTEND_URL environment variable..."
railway variables set FRONTEND_URL=https://thecfoline.com

# Deploy the application
echo "Deploying the application..."
railway up

echo "Deployment completed!"
echo "The API is now configured to accept requests from:"
echo "- https://thecfoline.com (production frontend)"
echo "- http://localhost:3000 (local development)"
echo "- https://cfo-line-api.up.railway.app (Railway API itself)" 
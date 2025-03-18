#!/bin/bash

echo "Setting up Railway deployment with proper CORS configuration..."

# Login to Railway
echo "Logging in to Railway..."
railway login

# Set the FRONTEND_URL environment variable
echo "Setting FRONTEND_URL environment variable..."
railway variables set FRONTEND_URL=https://your-frontend-domain.com

# Deploy the application
echo "Deploying the application..."
railway up

echo "Deployment completed!"
echo "Make sure to replace 'https://your-frontend-domain.com' with your actual frontend URL in Railway dashboard." 
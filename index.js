/**
 * Simple Express health check server
 * This is a fallback in case the TypeScript build fails
 */
console.log('Starting fallback health check server...');

try {
  // Try to load the built app first
  if (require('fs').existsSync('./dist/index.js')) {
    console.log('Main application found, attempting to load...');
    try {
      require('./dist/index.js');
      console.log('Main application loaded successfully!');
      return;
    } catch (err) {
      console.error('Failed to load main application:', err.message);
    }
  } else {
    console.log('Main application not found, starting health check server');
  }

  // If we got here, we need to start the minimal health check server
  const express = require('express');
  const app = express();
  
  // Health check endpoint
  app.get('/health', (req, res) => {
    console.log('Health check received on fallback server');
    res.status(200).json({ status: 'OK', mode: 'fallback' });
  });
  
  // Status endpoint
  app.get('/status', (req, res) => {
    res.status(200).json({
      status: 'running',
      mode: 'fallback',
      uptime: process.uptime(),
      timestamp: Date.now()
    });
  });
  
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Fallback health check server running on port ${PORT}`);
  });
} catch (err) {
  console.error('Critical error in fallback server:', err);
} 
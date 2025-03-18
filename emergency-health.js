const express = require('express');
const fs = require('fs');

// Create a super simple Express app just for health checks
const app = express();

// Health check endpoint
app.get('/health', (req, res) => {
  console.log('Health check received');
  res.status(200).json({ status: 'OK', message: 'Emergency health endpoint active' });
});

// Optional - log application status
app.get('/status', (req, res) => {
  let status = {
    uptime: process.uptime(),
    timestamp: Date.now(),
    dist_exists: fs.existsSync('/app/dist'),
    main_file_exists: fs.existsSync('/app/dist/index.js'),
    memory_usage: process.memoryUsage(),
    emergency_mode: true
  };
  
  res.status(200).json(status);
});

// Start the server on Railway's expected port
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Emergency health server running on port ${PORT}`);
}); 
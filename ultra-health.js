// Ultra minimal health check server with no dependencies
const http = require('http');

console.log('Starting ultra minimal health check server...');
const PORT = process.env.PORT || 5000;

// Create an HTTP server with a single route
const server = http.createServer((req, res) => {
  console.log(`[${new Date().toISOString()}] Received request: ${req.method} ${req.url}`);
  
  // Only respond to /health endpoint
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', mode: 'minimal' }));
    console.log(`[${new Date().toISOString()}] Returned 200 for health check`);
  } else {
    res.writeHead(404);
    res.end('Not found');
    console.log(`[${new Date().toISOString()}] Returned 404 for ${req.url}`);
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Ultra minimal health check server running on port ${PORT}`);
});

// Log any errors
server.on('error', (err) => {
  console.error(`[${new Date().toISOString()}] Server error:`, err);
});

// Try to start the main app in the background
setTimeout(() => {
  try {
    console.log(`[${new Date().toISOString()}] Attempting to start main application...`);
    require('./index.js');
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Failed to start main app:`, error);
  }
}, 1000);

// Keep the process running
process.on('uncaughtException', (err) => {
  console.error(`[${new Date().toISOString()}] Uncaught exception:`, err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`[${new Date().toISOString()}] Unhandled rejection at:`, promise, 'reason:', reason);
}); 
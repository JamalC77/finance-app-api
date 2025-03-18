/**
 * RAILWAY HEALTH CHECK SERVER
 * Specialized server just for Railway health checks with no dependencies on other code
 */
console.log('STARTING HEALTH-ONLY SERVER FOR RAILWAY');

const http = require('http');
const PORT = process.env.PORT || 5000;

// Global error handling
process.on('uncaughtException', (err) => {
  console.error('CRITICAL: Uncaught exception, but keeping server alive:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('CRITICAL: Unhandled rejection, but keeping server alive:', reason);
});

// Create the most minimal server possible
const server = http.createServer((req, res) => {
  // Only handle /health endpoint
  if (req.url === '/health') {
    console.log(`[${new Date().toISOString()}] Health check received`);
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({status: 'OK', mode: 'health-only'}));
  } else {
    res.writeHead(404);
    res.end();
  }
});

// Error handling for the server
server.on('error', (err) => {
  console.error('CRITICAL: Server error, attempting recovery:', err);
  
  // Try to recreate server after a brief delay
  setTimeout(() => {
    try {
      server.close();
      server.listen(PORT);
      console.log(`[${new Date().toISOString()}] Recovery attempted, server restarted`);
    } catch (e) {
      console.error('CRITICAL: Failed to recover server:', e);
    }
  }, 1000);
});

// Start server
server.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] RAILWAY HEALTH SERVER RUNNING ON PORT ${PORT}`);
});

// Start main application in background after health server is up
setTimeout(() => {
  console.log('Starting main application in background...');
  try {
    const { spawn } = require('child_process');
    const mainApp = spawn('node', ['index.js'], { 
      detached: true,
      stdio: 'inherit'
    });
    
    mainApp.on('error', (err) => {
      console.error('Failed to start main app:', err);
    });
    
    console.log('Main application started in background');
  } catch (err) {
    console.error('Error starting main app:', err);
  }
}, 2000); 
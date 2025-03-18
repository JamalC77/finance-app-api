// Railway standalone health server using Express
const express = require('express');
const timeout = require('connect-timeout');
const app = express();

// Apply timeout middleware to all requests
app.use(timeout('5s'));
app.use(haltOnTimedout);

// Health check endpoint with explicit timeout
app.get('/health', (req, res) => {
  console.log(`Health check received at ${new Date().toISOString()}`);
  res.status(200).json({ status: 'OK' });
});

// Catch-all route
app.use('*', (req, res) => {
  res.status(404).end();
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`STANDALONE HEALTH SERVER RUNNING ON PORT ${PORT}`);
});

// Error handling
function haltOnTimedout(req, res, next) {
  if (!req.timedout) next();
}

// Global error handling
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
}); 
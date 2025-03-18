// Absolute minimal health check for Railway
// This has ONE job - respond to /health with 200 OK
require('http').createServer((req, res) => {
  if (req.url === '/health') {
    console.log('Health check received at ' + new Date().toISOString());
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({status: 'OK'}));
  } else {
    res.writeHead(404);
    res.end();
  }
}).listen(process.env.PORT || 5000, () => {
  console.log('MINIMAL HEALTH SERVER RUNNING ON PORT ' + (process.env.PORT || 5000));
}); 
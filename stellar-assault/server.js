const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = 3000;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css' };

http.createServer(function(req, res) {
  var file = req.url === '/' ? '/index.html' : req.url;
  var full = path.join(__dirname, file);
  fs.readFile(full, function(err, data) {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'text/plain' });
    res.end(data);
  });
}).listen(PORT, function() {
  console.log('STELLAR ASSAULT running at http://localhost:' + PORT);
});

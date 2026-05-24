const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const { injectHtml } = require('./lib/html-injector');

const HTML_FILE = process.argv[2];
if (!HTML_FILE) {
  console.error('Usage: node server.js <path-to-html-file>');
  process.exit(1);
}

if (!fs.existsSync(HTML_FILE)) {
  console.error(`Error: File not found: ${HTML_FILE}`);
  process.exit(1);
}

const originalHtml = fs.readFileSync(HTML_FILE, 'utf-8');
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

// Static assets
app.use('/public', express.static(path.join(__dirname, 'public')));

// Role routes
app.get('/speaker', (req, res) => {
  const html = injectHtml(originalHtml, 'speaker', '');
  res.send(html);
});

app.get('/audience', (req, res) => {
  const html = injectHtml(originalHtml, 'audience', '');
  res.send(html);
});

app.get('/moderator', (req, res) => {
  const html = injectHtml(originalHtml, 'moderator', '');
  res.send(html);
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  const interfaces = require('os').networkInterfaces();
  let ip = 'localhost';
  for (const name in interfaces) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ip = iface.address;
        break;
      }
    }
    if (ip !== 'localhost') break;
  }

  console.log('\n🎯 弹幕服务器已启动\n');
  console.log(`演讲者: http://${ip}:${PORT}/speaker`);
  console.log(`管理者: http://${ip}:${PORT}/moderator`);
  console.log(`观众:   http://${ip}:${PORT}/audience\n`);
});

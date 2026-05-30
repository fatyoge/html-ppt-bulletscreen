const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const { injectHtml } = require('./lib/html-injector');
const { DanmakuStore } = require('./lib/danmaku-store');
const { SlideSync } = require('./lib/slide-sync');

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
app.get('/', (req, res) => {
  const html = injectHtml(originalHtml, 'audience', '');
  res.send(html);
});

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

const store = new DanmakuStore();
const slideSync = new SlideSync();

io.on('connection', (socket) => {
  // Wait for role announcement
  socket.on('role', (role) => {
    socket.data.role = role;

    if (role === 'speaker') {
      const isFirst = slideSync.setSpeaker(socket.id);
      socket.emit('speaker:status', { hasControl: isFirst });
    }

    if (role === 'moderator') {
      const count = Array.from(io.sockets.sockets.values())
        .filter(s => s.data.role === 'moderator').length;
      store.setModeratorCount(count);
      socket.emit('moderation:status', { active: count > 0 });
      socket.emit('moderation:pending', store.getPending());
    }

    // Send sync state to all new connections
    socket.emit('slide:sync', {
      idx: slideSync.getCurrentSlide(),
      total: 0 // Will be determined client-side
    });
    socket.emit('control:state', slideSync.getControlState());
  });

  // Danmaku send
  socket.on('danmaku:send', ({ text, color }) => {
    if (socket.data.role !== 'audience') return;
    const id = store.addDanmaku(text, color, socket.id);
    const pending = store.getPending();
    const dm = pending.find(d => d.id === id);

    if (dm) {
      // In review mode, notify moderators
      io.sockets.sockets.forEach((s) => {
        if (s.data.role === 'moderator') {
          s.emit('danmaku:pending', dm);
        }
      });
    } else {
      // Auto-approved, broadcast to all
      const approved = store.getApprovedHistory();
      const sent = approved.find(d => d.id === id);
      if (sent) {
        io.emit('danmaku:approved', {
          id: sent.id,
          text: sent.text,
          color: sent.color,
          senderId: sent.senderId
        });
      }
    }
  });

  // Moderator approve
  socket.on('danmaku:approve', ({ id }) => {
    if (socket.data.role !== 'moderator') return;
    const dm = store.approve(id);
    if (dm) {
      io.emit('danmaku:approved', {
        id: dm.id,
        text: dm.text,
        color: dm.color,
        senderId: dm.senderId
      });
      // Notify moderators to remove from pending
      io.sockets.sockets.forEach((s) => {
        if (s.data.role === 'moderator') {
          s.emit('danmaku:removed', { id: dm.id });
        }
      });
    }
  });

  // Moderator block
  socket.on('danmaku:block', ({ id }) => {
    if (socket.data.role !== 'moderator') return;
    const dm = store.block(id);
    if (dm) {
      io.emit('danmaku:blocked', { id: dm.id });
      io.to(dm.senderId).emit('danmaku:rejected', { id: dm.id });
      io.sockets.sockets.forEach((s) => {
        if (s.data.role === 'moderator') {
          s.emit('danmaku:removed', { id: dm.id });
        }
      });
    }
  });

  // Slide navigation
  socket.on('slide:go', ({ idx }) => {
    if (socket.data.role !== 'speaker') return;
    const success = slideSync.setSlide(idx, socket.id);
    if (success) {
      socket.broadcast.emit('slide:go', { idx });
    }
  });

  // Speaker controls
  socket.on('control:clear', () => {
    if (socket.data.role !== 'speaker') return;
    io.emit('control:clear');
  });

  socket.on('control:pause', ({ paused }) => {
    if (socket.data.role !== 'speaker') return;
    slideSync.setControlState({ paused });
    io.emit('control:pause', { paused });
  });

  socket.on('control:speed', ({ speed }) => {
    if (socket.data.role !== 'speaker') return;
    slideSync.setControlState({ speed });
    io.emit('control:speed', { speed });
  });

  socket.on('control:density', ({ density }) => {
    if (socket.data.role !== 'speaker') return;
    slideSync.setControlState({ density });
    io.emit('control:density', { density });
  });

  // Disconnect
  socket.on('disconnect', () => {
    slideSync.removeSpeaker(socket.id);
    const modCount = Array.from(io.sockets.sockets.values())
      .filter(s => s.data.role === 'moderator').length;
    const autoApproved = store.setModeratorCount(modCount);
    autoApproved.forEach(dm => {
      io.emit('danmaku:approved', {
        id: dm.id,
        text: dm.text,
        color: dm.color,
        senderId: dm.senderId
      });
    });
  });
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

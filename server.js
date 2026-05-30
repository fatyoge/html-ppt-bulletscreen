const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const localtunnel = require('localtunnel');
const QRCode = require('qrcode');
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

async function startCloudflareTunnel(port) {
  return new Promise((resolve) => {
    const cf = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let url = null;
    let stderr = '';

    cf.stdout.on('data', (data) => {
      const text = data.toString();
      const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match && !url) {
        url = match[0];
        resolve({ url, process: cf });
      }
    });

    cf.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    cf.on('error', () => {
      resolve(null);
    });

    // 30 秒超时
    setTimeout(() => {
      if (!url) {
        cf.kill();
        resolve(null);
      }
    }, 30000);
  });
}

async function startTunnel(port) {
  // 优先尝试 Cloudflare Tunnel（更稳定）
  const cfResult = await startCloudflareTunnel(port);
  if (cfResult) {
    return cfResult.url;
  }

  // 回退到 localtunnel
  console.log('\n⚠️  cloudflared 不可用，尝试 localtunnel...');
  console.log('   如需使用 Cloudflare Tunnel（更稳定）：');
  console.log('   1. 访问 https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/');
  console.log('   2. 下载安装 cloudflared\n');

  try {
    const tunnel = await localtunnel({ port });
    return tunnel.url;
  } catch (err) {
    console.error('localtunnel 连接失败:', err.message);
    return null;
  }
}

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

httpServer.listen(PORT, async () => {
  const interfaces = require('os').networkInterfaces();
  let lanUrl = `http://localhost:${PORT}`;
  for (const name in interfaces) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        lanUrl = `http://${iface.address}:${PORT}`;
        break;
      }
    }
    if (lanUrl !== `http://localhost:${PORT}`) break;
  }

  const publicUrl = await startTunnel(PORT);
  let qrDataUrl = '';
  if (publicUrl) {
    try {
      qrDataUrl = await QRCode.toDataURL(publicUrl + '/', { width: 256, margin: 2 });
    } catch (err) {
      console.error('二维码生成失败:', err.message);
    }
  }

  // Define routes after URLs are ready
  app.get('/', (req, res) => {
    const html = injectHtml(originalHtml, 'audience', '');
    res.send(html);
  });

  app.get('/speaker', (req, res) => {
    const html = injectHtml(originalHtml, 'speaker', '', publicUrl, lanUrl, qrDataUrl);
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

  console.log('\n🎯 弹幕服务器已启动\n');
  console.log(`局域网访问：`);
  console.log(`  演讲者: ${lanUrl}/speaker`);
  console.log(`  管理者: ${lanUrl}/moderator`);
  console.log(`  观众:   ${lanUrl}/\n`);
  if (publicUrl) {
    console.log(`外网访问：`);
    console.log(`  观众:   ${publicUrl}/\n`);
  }
  console.log(`快捷键：Ctrl + Alt + S 打开分享弹窗\n`);
});

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const { spawn } = require('child_process');
const QRCode = require('qrcode');
const { createApp } = require('./lib/server-app');
const { DanmakuStore } = require('./lib/danmaku-store');
const { SlideSync } = require('./lib/slide-sync');
const { generateToken, validateToken, parseCookie } = require('./lib/speaker-auth');

// --- argv parsing: first non-flag arg is the source; --allow-public is a flag ---
const argv = process.argv.slice(2);
const allowPublicFlag = argv.includes('--allow-public');
const SOURCE_ARG = argv.find((a) => !a.startsWith('-'));
if (!SOURCE_ARG) {
  console.error('Usage: node server.js <path-to-html-file | http://upstream-origin> [--allow-public]');
  process.exit(1);
}

const isUrlMode = /^https?:\/\//i.test(SOURCE_ARG);
let originalHtml = null;
let upstreamOrigin = null;
if (isUrlMode) {
  upstreamOrigin = SOURCE_ARG.replace(/\/+$/, '');
} else {
  if (!fs.existsSync(SOURCE_ARG)) {
    console.error(`Error: File not found: ${SOURCE_ARG}`);
    process.exit(1);
  }
  originalHtml = fs.readFileSync(SOURCE_ARG, 'utf-8');
}

// Public sharing is opt-in for URL mode (upstream may be an interactive app/terminal).
const allowPublic = !isUrlMode || allowPublicFlag || process.env.BS_ALLOW_PUBLIC === '1';

// share is mutated after the tunnel resolves; routes read it live at request time.
const share = { publicUrl: '', lanUrl: '', qrDataUrl: '' };

const speakerToken = generateToken();
const app = createApp({
  mode: isUrlMode ? 'url' : 'file',
  originalHtml,
  upstreamOrigin,
  speakerToken,
  share
});
const httpServer = createServer(app);
const io = new Server(httpServer);

function checkCloudflaredInstalled() {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const proc = spawn('cloudflared', ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: isWin
    });

    let installed = false;

    proc.stdout.on('data', () => { installed = true; });
    proc.stderr.on('data', () => { installed = true; });

    proc.on('error', () => { resolve(false); });
    proc.on('close', (code) => { resolve(installed || code === 0); });

    setTimeout(() => {
      proc.kill();
      resolve(false);
    }, 5000);
  });
}

async function startCloudflareTunnel(port) {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const cf = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: isWin
    });

    let url = null;

    const tryExtractUrl = (data) => {
      const text = data.toString();
      const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match && !url) {
        url = match[0];
        resolve({ url, process: cf });
      }
    };

    cf.stdout.on('data', tryExtractUrl);
    cf.stderr.on('data', tryExtractUrl);

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

const store = new DanmakuStore();
const slideSync = new SlideSync();

io.on('connection', (socket) => {
  // Wait for role announcement
  socket.on('role', (role) => {
    if (typeof role !== 'string') {
      role = 'audience';
    }

    const cookies = parseCookie(socket.handshake.headers.cookie);
    const cookieToken = cookies.bs_speaker_token;

    // Reject speaker role if the cookie token is missing or invalid.
    if (role === 'speaker' && !validateToken(cookieToken, speakerToken)) {
      socket.data.role = 'audience';
      socket.emit('speaker:status', { hasControl: false });
      return;
    }

    socket.data.role = role;

    if (role === 'speaker') {
      const isFirst = slideSync.setSpeaker(socket.id);
      socket.emit('speaker:status', { hasControl: isFirst });
    } else {
      socket.emit('speaker:status', { hasControl: false });
    }

    if (role === 'moderator') {
      const count = Array.from(io.sockets.sockets.values())
        .filter(s => s.data.role === 'moderator').length;
      store.setModeratorCount(count);
      socket.emit('moderation:status', { active: count > 0 });
      socket.emit('moderation:pending', store.getPending());
    }

    // Send sync state to all new connections
    const currentIdx = slideSync.getCurrentSlide();
    socket.emit('slide:sync', {
      idx: currentIdx,
      total: 0, // Will be determined client-side
      transforms: slideSync.getSlideTransforms(currentIdx)
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
  socket.on('slide:go', ({ idx, transforms }) => {
    if (socket.data.role !== 'speaker') return;
    const success = slideSync.setSlide(idx, socket.id);
    if (success) {
      if (transforms && transforms.length) {
        slideSync.setSlideTransforms(idx, transforms);
      }
      socket.broadcast.emit('slide:go', { idx, transforms });
    }
  });

  // Animation sync broadcast
  socket.on('bs:anim:trigger', (msg) => {
    if (socket.data.role !== 'speaker') return;
    if (!msg || !msg.type || !msg.triggerType || !msg.selector) return;
    socket.broadcast.emit('bs:anim:trigger', msg);
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

// URL mode: forward non-Socket.IO WebSocket upgrades (e.g. xterm terminal) to upstream.
if (isUrlMode && app.locals.urlProxy) {
  const upstreamProxy = app.locals.urlProxy;
  // Socket.IO (constructed above) attaches its own 'upgrade' listener for /socket.io/;
  // Node dispatches upgrade to all listeners, so this one handles only non-socket.io paths.
  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url && req.url.startsWith('/socket.io/')) {
      return; // Socket.IO handles its own upgrades.
    }
    upstreamProxy.ws(req, socket, head);
  });
}

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
  share.lanUrl = lanUrl;

  let publicUrl = '';

  if (allowPublic) {
    const cfInstalled = await checkCloudflaredInstalled();
    if (cfInstalled) {
      const cfResult = await startCloudflareTunnel(PORT);
      if (cfResult) {
        publicUrl = cfResult.url;
        share.publicUrl = publicUrl;
        try {
          share.qrDataUrl = await QRCode.toDataURL(publicUrl + '/', { width: 256, margin: 2 });
        } catch (err) {
          console.error('二维码生成失败:', err.message);
        }
      }
    }
  }

  console.log('\n🎯 弹幕服务器已启动\n');
  if (isUrlMode) {
    console.log(`模式：URL 代理（上游 ${upstreamOrigin}）`);
  }
  console.log(`局域网访问：`);
  console.log(`  演讲者: ${lanUrl}/speaker?token=${speakerToken}`);
  console.log(`  管理者: ${lanUrl}/moderator`);
  console.log(`  观众:   ${lanUrl}/\n`);
  if (publicUrl) {
    console.log(`外网访问：`);
    console.log(`  观众:   ${publicUrl}/\n`);
    if (isUrlMode) {
      console.log(`  ⚠️  WARNING: public tunnel enabled for an upstream app — anyone with the link can use ${upstreamOrigin}.`);
      console.log(`  ⚠️  仅在可信场景下开启，建议演示结束后立即关闭。\n`);
    }
  } else if (isUrlMode && !allowPublic) {
    console.log(`外网访问：已关闭（URL 模式默认仅局域网；如需开启请加 --allow-public 或 BS_ALLOW_PUBLIC=1）\n`);
  }
  console.log(`快捷键：Ctrl + Alt + S 打开分享弹窗`);
  console.log(`  提示：演讲者链接已包含 token，请妥善保管\n`);
});

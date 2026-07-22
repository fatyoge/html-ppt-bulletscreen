const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const QRCode = require('qrcode');
const { injectHtml } = require('./lib/html-injector');
const { DanmakuStore } = require('./lib/danmaku-store');
const { SlideSync } = require('./lib/slide-sync');
const { generateToken, validateToken, parseCookie, buildSpeakerCookie } = require('./lib/speaker-auth');

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

// 分享链接相关变量。在 IIFE 内赋值（cloudflared/二维码就绪后），
// 提升到顶层供下面的 .html 注入中间件读取（中间件注册早于 IIFE 执行，
// 但中间件是请求时才执行，届时变量已被赋值）。
let publicUrl = '';
let lanUrl = '';
let qrDataUrl = '';

const siteRoot = path.dirname(path.resolve(HTML_FILE));

// Static assets
app.use('/public', express.static(path.join(__dirname, 'public')));

// .html 注入中间件：拦截所有以 .html 结尾的 GET 请求，注入弹幕层。
// 必须注册在下面的整站 static 之前，否则 static 会直接返回原始 .html，
// 中间件永远拿不到执行机会。首页 / 及 /speaker 等精确路由在 IIFE 内单独处理，
// 因路径不以 .html 结尾，不会被本中间件拦截。
app.use((req, res, next) => {
  if (req.method !== 'GET' || !req.path.endsWith('.html')) return next();

  const filePath = path.join(siteRoot, req.path);
  if (!filePath.startsWith(siteRoot)) return next(); // 路径穿越防护

  fs.readFile(filePath, 'utf-8', (err, html) => {
    if (err) return next(); // 文件不存在，交给后续 static 返回 404
    if (!html.includes('</head>') || !html.includes('</body>')) return next(); // 不符合注入条件，原样返回

    // 复用演讲者 cookie 校验：演讲者跨页保持身份，其余当观众
    const cookies = parseCookie(req.headers.cookie);
    const role = validateToken(cookies.bs_speaker_token, speakerToken) ? 'speaker' : 'audience';
    res.send(injectHtml(html, role, '', publicUrl, lanUrl, qrDataUrl));
  });
});

// 托管目标 HTML 文件所在目录，使其 css/ js/ data/ 等相对路径资源可被同源访问。
// 这样多文件静态站点（如 `python -m http.server` 托管的整站）也能叠加弹幕层。
// index:false —— 避免 static 把 GET / 直接返回原始 index.html，抢走注入路由。
// .html 请求已被上方中间件拦截并注入；此处只负责 css/js/img/data 等非 .html 资源。
app.use(express.static(siteRoot, { index: false }));

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
const speakerToken = generateToken();

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
    socket.emit('nav:sync', slideSync.getNavState());
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

  // Nav sync: 演讲者在多页面/滚动式站点上的位置同步（页面路径 + section 索引）。
  // 与 slide:go 同模式：speaker emit -> server 鉴权存权威状态 -> broadcast 给观众(不回声)。
  // setNavState 做偏更新：只在 sectionIdx 为整数时更新它，非整数/缺失则保留旧值。
  socket.on('nav:go', (msg) => {
    if (socket.data.role !== 'speaker') return;
    if (!msg || typeof msg.path !== 'string') return;
    const ok = slideSync.setNavState({
      path: msg.path,
      sectionIdx: msg.sectionIdx
    }, socket.id);
    if (ok) socket.broadcast.emit('nav:go', slideSync.getNavState());
  });

  // Animation sync broadcast
  socket.on('bs:anim:trigger', (msg) => {
    if (socket.data.role !== 'speaker') return;
    if (!msg || !msg.type || !msg.triggerType || !msg.selector) return;
    socket.broadcast.emit('bs:anim:trigger', msg);
  });

  // Attention marker broadcast (speaker -> all, incl. speaker echo)
  socket.on('attention:ping', (msg) => {
    if (socket.data.role !== 'speaker') return;
    if (!msg || !Number.isFinite(msg.xPct) || !Number.isFinite(msg.yPct)) return;
    io.emit('attention:ping', msg);
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

  socket.on('control:topRatio', ({ topRatio }) => {
    if (socket.data.role !== 'speaker') return;
    const clamped = Math.max(0.1, Math.min(1.0, parseFloat(topRatio) || 0.3));
    slideSync.setControlState({ topRatio: clamped });
    io.emit('control:topRatio', { topRatio: clamped });
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

const START_PORT = parseInt(process.env.PORT, 10) || 3000;
const MAX_PORT_ATTEMPTS = 100;

/**
 * 尝试在指定端口启动服务器；如果被占用则自动尝试下一个端口。
 * @param {number} port - 要尝试的端口号
 * @returns {Promise<number>} 实际监听成功的端口号
 */
function tryListen(port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      httpServer.removeListener('listening', onListening);
      if (err.code === 'EADDRINUSE' && port < START_PORT + MAX_PORT_ATTEMPTS) {
        console.log(`端口 ${port} 被占用，尝试 ${port + 1}`);
        tryListen(port + 1).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    };

    const onListening = () => {
      httpServer.removeListener('error', onError);
      resolve(port);
    };

    httpServer.once('listening', onListening);
    httpServer.once('error', onError);
    httpServer.listen(port);
  });
}

(async () => {
  let PORT;
  try {
    PORT = await tryListen(START_PORT);
  } catch (err) {
    console.error(`启动失败：${err.message}`);
    process.exit(1);
  }

  const interfaces = require('os').networkInterfaces();
  lanUrl = `http://localhost:${PORT}`;
  for (const name in interfaces) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        lanUrl = `http://${iface.address}:${PORT}`;
        break;
      }
    }
    if (lanUrl !== `http://localhost:${PORT}`) break;
  }

  const cfInstalled = await checkCloudflaredInstalled();
  if (cfInstalled) {
    const cfResult = await startCloudflareTunnel(PORT);
    if (cfResult) {
      publicUrl = cfResult.url;
      try {
        qrDataUrl = await QRCode.toDataURL(publicUrl + '/', { width: 256, margin: 2 });
      } catch (err) {
        console.error('二维码生成失败:', err.message);
      }
    }
  }

  // Define routes after URLs are ready
  app.get('/', (req, res) => {
    const html = injectHtml(originalHtml, 'audience', '');
    res.send(html);
  });

  app.get('/speaker', (req, res) => {
    const queryToken = req.query.token;
    const cookies = parseCookie(req.headers.cookie);
    const cookieToken = cookies.bs_speaker_token;

    // First entry: valid token in query sets the cookie and redirects to clean URL.
    if (validateToken(queryToken, speakerToken)) {
      res.setHeader('Set-Cookie', buildSpeakerCookie(queryToken));
      return res.redirect('/speaker');
    }

    // Subsequent visits: require valid cookie.
    if (!validateToken(cookieToken, speakerToken)) {
      return res.redirect('/');
    }

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
  console.log(`  演讲者: ${lanUrl}/speaker?token=${speakerToken}`);
  console.log(`  管理者: ${lanUrl}/moderator`);
  console.log(`  观众:   ${lanUrl}/\n`);
  if (publicUrl) {
    console.log(`外网访问：`);
    console.log(`  观众:   ${publicUrl}/\n`);
  }
  console.log(`快捷键：Ctrl + Alt + S 打开分享弹窗`);
  console.log(`  提示：演讲者链接已包含 token，请妥善保管\n`);
})();

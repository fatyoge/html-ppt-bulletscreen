# 弹幕服务器实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现一个本地 Node.js 弹幕服务器，支持演讲者/管理者/观众三种角色，实时弹幕、幻灯片同步、管理者审核功能。

**Architecture:** 服务端使用 Express + Socket.IO 提供 HTTP 服务和 WebSocket 实时通信。服务端读取用户 HTML 文件并在 `<head>` 注入 CSS、在 `</body>` 前注入 JS。三种角色通过 URL 路径区分，共享同一份注入后的 HTML。弹幕使用 DOM 驱动渲染，轨道管理避免重叠。

**Tech Stack:** Node.js, Express, Socket.IO, Vanilla JS (IIFE), CSS

---

## 文件结构

```
bullet-screen/
├── server.js                  # Express + Socket.IO 入口
├── lib/
│   ├── html-injector.js       # HTML 字符串注入（读取用户HTML，插入弹幕CSS/JS）
│   ├── danmaku-store.js       # 内存弹幕队列 + 审核状态管理
│   └── slide-sync.js          # 幻灯片状态追踪（当前索引、演讲者身份）
├── public/                    # Express 静态资源
│   ├── danmaku.css            # 弹幕层 + 角色特定UI样式
│   ├── danmaku-renderer.js    # 弹幕渲染引擎（DOM动画、轨道管理）
│   ├── slide-sync.js          # 幻灯片同步客户端（BroadcastChannel监听+WebSocket）
│   ├── speaker-controls.js    # 演讲者底部控制栏
│   ├── audience-panel.js      # 观众侧边栏（发送弹幕+颜色选择）
│   └── moderator-panel.js     # 管理者侧边栏（审核队列+通过/拦截按钮）
├── tests/                     # 服务端单元测试
│   ├── html-injector.test.js
│   ├── danmaku-store.test.js
│   └── slide-sync.test.js
├── examples/                  # 测试用示例
│   └── test-deck.html         # 最小html-ppt格式测试文件
├── package.json
└── .gitignore
```

---

## Task 1: 项目初始化

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `examples/test-deck.html`

### Step 1: 创建 package.json

```json
{
  "name": "bullet-screen",
  "version": "1.0.0",
  "description": "Local danmaku server for html-ppt presentations",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "test": "jest"
  },
  "dependencies": {
    "express": "^4.21.0",
    "socket.io": "^4.8.0"
  },
  "devDependencies": {
    "jest": "^29.7.0"
  }
}
```

### Step 2: 创建 .gitignore

```
node_modules/
*.log
.DS_Store
```

### Step 3: 创建测试用 HTML 文件

Create: `examples/test-deck.html`

```html
<!DOCTYPE html>
<html lang="zh-CN" data-theme="minimal-white">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Test Deck</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; }
  .deck { width: 100%; height: 100%; position: relative; }
  .slide {
    position: absolute; inset: 0;
    display: none;
    align-items: center; justify-content: center;
    font-size: 48px; font-family: sans-serif;
  }
  .slide.is-active { display: flex; }
  .slide:nth-child(1) { background: #f0f0f0; }
  .slide:nth-child(2) { background: #e0e0e0; }
  .slide:nth-child(3) { background: #d0d0d0; }
</style>
</head>
<body>
<div class="deck">
  <section class="slide is-active" data-title="Slide 1"><h1>第一页</h1></section>
  <section class="slide" data-title="Slide 2"><h1>第二页</h1></section>
  <section class="slide" data-title="Slide 3"><h1>第三页</h1></section>
</div>
<script>
(function() {
  const slides = document.querySelectorAll('.slide');
  let idx = 0;
  function go(n) {
    n = Math.max(0, Math.min(slides.length - 1, n));
    slides.forEach((s, i) => s.classList.toggle('is-active', i === n));
    idx = n;
  }
  document.addEventListener('keydown', function(e) {
    if (e.key === 'ArrowRight' || e.key === ' ') { go(idx + 1); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { go(idx - 1); e.preventDefault(); }
  });
})();
</script>
</body>
</html>
```

### Step 4: 安装依赖

```bash
npm install
```

Expected: `node_modules/` created, `package-lock.json` generated.

### Step 5: 初始化 git 并提交

```bash
git init
git add package.json .gitignore examples/test-deck.html
git commit -m "chore: project init with dependencies and test deck"
```

---

## Task 2: HTML 注入器

**Files:**
- Create: `lib/html-injector.js`
- Create: `tests/html-injector.test.js`

### Step 1: 写测试

Create: `tests/html-injector.test.js`

```javascript
const { injectHtml } = require('../lib/html-injector');

describe('injectHtml', () => {
  const sampleHtml = `<!DOCTYPE html>
<html><head><title>Test</title></head>
<body><div class="deck"></div></body></html>`;

  test('injects CSS link before </head>', () => {
    const result = injectHtml(sampleHtml, 'speaker', 'http://localhost:3000');
    expect(result).toContain('<link rel="stylesheet" href="/public/danmaku.css">');
    expect(result.indexOf('danmaku.css')).toBeLessThan(result.indexOf('</head>'));
  });

  test('injects role and server config before socket.io', () => {
    const result = injectHtml(sampleHtml, 'audience', 'http://localhost:3000');
    expect(result).toContain("window.BS_ROLE = 'audience'");
    expect(result).toContain("window.BS_SERVER = 'http://localhost:3000'");
  });

  test('injects socket.io and danmaku scripts before </body>', () => {
    const result = injectHtml(sampleHtml, 'speaker', 'http://localhost:3000');
    expect(result).toContain('/socket.io/socket.io.js');
    expect(result).toContain('/public/danmaku-renderer.js');
    const bodyCloseIdx = result.indexOf('</body>');
    const scriptIdx = result.indexOf('danmaku-renderer.js');
    expect(scriptIdx).toBeLessThan(bodyCloseIdx);
  });

  test('preserves original HTML structure', () => {
    const result = injectHtml(sampleHtml, 'moderator', 'http://localhost:3000');
    expect(result).toContain('<div class="deck">');
    expect(result).toContain('<title>Test</title>');
  });

  test('throws if HTML lacks </head>', () => {
    expect(() => injectHtml('<html><body></body></html>', 'speaker', ''))
      .toThrow('HTML must contain </head>');
  });

  test('throws if HTML lacks </body>', () => {
    expect(() => injectHtml('<html><head></head></html>', 'speaker', ''))
      .toThrow('HTML must contain </body>');
  });
});
```

### Step 2: 运行测试确认失败

```bash
npx jest tests/html-injector.test.js
```

Expected: FAIL — `Cannot find module '../lib/html-injector'`

### Step 3: 实现 html-injector.js

Create: `lib/html-injector.js`

```javascript
function injectHtml(originalHtml, role, serverUrl) {
  if (!originalHtml.includes('</head>')) {
    throw new Error('HTML must contain </head>');
  }
  if (!originalHtml.includes('</body>')) {
    throw new Error('HTML must contain </body>');
  }

  const css = `<link rel="stylesheet" href="/public/danmaku.css">`;
  let html = originalHtml.replace('</head>', css + '\n</head>');

  const script = `
    <script>
      window.BS_ROLE = '${role}';
      window.BS_SERVER = '${serverUrl}';
    </script>
    <script src="/socket.io/socket.io.js"></script>
    <script src="/public/danmaku-renderer.js"></script>
  `;
  html = html.replace('</body>', script + '\n</body>');

  return html;
}

module.exports = { injectHtml };
```

### Step 4: 运行测试确认通过

```bash
npx jest tests/html-injector.test.js
```

Expected: PASS — 6 tests passed

### Step 5: 提交

```bash
git add lib/html-injector.js tests/html-injector.test.js
git commit -m "feat: html injector with tests"
```

---

## Task 3: 弹幕存储

**Files:**
- Create: `lib/danmaku-store.js`
- Create: `tests/danmaku-store.test.js`

### Step 1: 写测试

Create: `tests/danmaku-store.test.js`

```javascript
const { DanmakuStore } = require('../lib/danmaku-store');

describe('DanmakuStore', () => {
  let store;

  beforeEach(() => {
    store = new DanmakuStore();
  });

  test('adds danmaku to pending queue when moderator exists', () => {
    store.setModeratorCount(1);
    const id = store.addDanmaku('hello', '#ff0000', 'socket-1');
    expect(store.pendingQueue).toHaveLength(1);
    expect(store.pendingQueue[0].text).toBe('hello');
    expect(store.pendingQueue[0].id).toBe(id);
  });

  test('auto-approves danmaku when no moderator', () => {
    store.setModeratorCount(0);
    const id = store.addDanmaku('hello', '#ff0000', 'socket-1');
    expect(store.pendingQueue).toHaveLength(0);
    expect(store.approvedQueue).toHaveLength(1);
    expect(store.approvedQueue[0].text).toBe('hello');
  });

  test('approve moves danmaku from pending to approved', () => {
    store.setModeratorCount(1);
    const id = store.addDanmaku('hello', '#ff0000', 'socket-1');
    const approved = store.approve(id);
    expect(approved).not.toBeNull();
    expect(approved.text).toBe('hello');
    expect(store.pendingQueue).toHaveLength(0);
    expect(store.approvedQueue).toHaveLength(1);
  });

  test('block removes danmaku from pending and returns it', () => {
    store.setModeratorCount(1);
    const id = store.addDanmaku('hello', '#ff0000', 'socket-1');
    const blocked = store.block(id);
    expect(blocked).not.toBeNull();
    expect(blocked.text).toBe('hello');
    expect(store.pendingQueue).toHaveLength(0);
    expect(store.approvedQueue).toHaveLength(0);
  });

  test('auto-approves pending when moderator disconnects', () => {
    store.setModeratorCount(1);
    store.addDanmaku('hello', '#ff0000', 'socket-1');
    store.addDanmaku('world', '#00ff00', 'socket-2');
    store.setModeratorCount(0);
    expect(store.pendingQueue).toHaveLength(0);
    expect(store.approvedQueue).toHaveLength(2);
  });

  test('approved queue has max 500 items (circular)', () => {
    store.setModeratorCount(0);
    for (let i = 0; i < 550; i++) {
      store.addDanmaku(`msg${i}`, '#fff', `socket-${i}`);
    }
    expect(store.approvedQueue).toHaveLength(500);
    expect(store.approvedQueue[0].text).toBe('msg50');
  });

  test('getPending returns copy of pending queue', () => {
    store.setModeratorCount(1);
    store.addDanmaku('hello', '#ff0000', 'socket-1');
    const pending = store.getPending();
    expect(pending).toHaveLength(1);
    pending.pop();
    expect(store.pendingQueue).toHaveLength(1);
  });
});
```

### Step 2: 运行测试确认失败

```bash
npx jest tests/danmaku-store.test.js
```

Expected: FAIL — module not found

### Step 3: 实现 danmaku-store.js

Create: `lib/danmaku-store.js`

```javascript
class DanmakuStore {
  constructor() {
    this.pendingQueue = [];
    this.approvedQueue = [];
    this.moderatorCount = 0;
    this.MAX_HISTORY = 500;
    this._idCounter = 0;
  }

  _generateId() {
    return `dm-${Date.now()}-${++this._idCounter}`;
  }

  setModeratorCount(count) {
    const hadModerator = this.moderatorCount > 0;
    this.moderatorCount = count;
    if (hadModerator && count === 0) {
      this._autoApproveAllPending();
    }
  }

  _autoApproveAllPending() {
    while (this.pendingQueue.length > 0) {
      const dm = this.pendingQueue.shift();
      this._addToApproved(dm);
    }
  }

  _addToApproved(dm) {
    this.approvedQueue.push(dm);
    if (this.approvedQueue.length > this.MAX_HISTORY) {
      this.approvedQueue.shift();
    }
  }

  addDanmaku(text, color, senderId) {
    const danmaku = {
      id: this._generateId(),
      text,
      color,
      senderId,
      timestamp: Date.now()
    };

    if (this.moderatorCount > 0) {
      this.pendingQueue.push(danmaku);
    } else {
      this._addToApproved(danmaku);
    }

    return danmaku.id;
  }

  approve(id) {
    const idx = this.pendingQueue.findIndex(d => d.id === id);
    if (idx === -1) return null;
    const dm = this.pendingQueue.splice(idx, 1)[0];
    this._addToApproved(dm);
    return dm;
  }

  block(id) {
    const idx = this.pendingQueue.findIndex(d => d.id === id);
    if (idx === -1) return null;
    return this.pendingQueue.splice(idx, 1)[0];
  }

  getPending() {
    return [...this.pendingQueue];
  }

  getApprovedHistory() {
    return [...this.approvedQueue];
  }
}

module.exports = { DanmakuStore };
```

### Step 4: 运行测试确认通过

```bash
npx jest tests/danmaku-store.test.js
```

Expected: PASS — 7 tests passed

### Step 5: 提交

```bash
git add lib/danmaku-store.js tests/danmaku-store.test.js
git commit -m "feat: danmaku store with moderation queue and tests"
```

---

## Task 4: 幻灯片同步状态

**Files:**
- Create: `lib/slide-sync.js`
- Create: `tests/slide-sync.test.js`

### Step 1: 写测试

Create: `tests/slide-sync.test.js`

```javascript
const { SlideSync } = require('../lib/slide-sync');

describe('SlideSync', () => {
  let sync;

  beforeEach(() => {
    sync = new SlideSync();
  });

  test('initial state is slide 0 with no speaker', () => {
    expect(sync.getCurrentSlide()).toBe(0);
    expect(sync.getSpeakerSocketId()).toBeNull();
  });

  test('sets speaker and returns true for first speaker', () => {
    const result = sync.setSpeaker('socket-1');
    expect(result).toBe(true);
    expect(sync.getSpeakerSocketId()).toBe('socket-1');
  });

  test('returns false for subsequent speakers', () => {
    sync.setSpeaker('socket-1');
    const result = sync.setSpeaker('socket-2');
    expect(result).toBe(false);
    expect(sync.getSpeakerSocketId()).toBe('socket-1');
  });

  test('updates slide only from current speaker', () => {
    sync.setSpeaker('socket-1');
    const result = sync.setSlide(2, 'socket-1');
    expect(result).toBe(true);
    expect(sync.getCurrentSlide()).toBe(2);
  });

  test('rejects slide update from non-speaker', () => {
    sync.setSpeaker('socket-1');
    const result = sync.setSlide(2, 'socket-2');
    expect(result).toBe(false);
    expect(sync.getCurrentSlide()).toBe(0);
  });

  test('removes speaker and allows new speaker', () => {
    sync.setSpeaker('socket-1');
    sync.removeSpeaker('socket-1');
    expect(sync.getSpeakerSocketId()).toBeNull();
    const result = sync.setSpeaker('socket-2');
    expect(result).toBe(true);
  });

  test('getControlState returns default values', () => {
    const state = sync.getControlState();
    expect(state).toEqual({ paused: false, speed: 1.0, density: 5 });
  });

  test('setControlState updates state', () => {
    sync.setControlState({ paused: true, speed: 2.0, density: 8 });
    const state = sync.getControlState();
    expect(state).toEqual({ paused: true, speed: 2.0, density: 8 });
  });
});
```

### Step 2: 运行测试确认失败

```bash
npx jest tests/slide-sync.test.js
```

Expected: FAIL — module not found

### Step 3: 实现 slide-sync.js

Create: `lib/slide-sync.js`

```javascript
class SlideSync {
  constructor() {
    this._currentSlide = 0;
    this._speakerSocketId = null;
    this._controlState = {
      paused: false,
      speed: 1.0,
      density: 5
    };
  }

  getCurrentSlide() {
    return this._currentSlide;
  }

  getSpeakerSocketId() {
    return this._speakerSocketId;
  }

  setSpeaker(socketId) {
    if (this._speakerSocketId === null) {
      this._speakerSocketId = socketId;
      return true;
    }
    return false;
  }

  removeSpeaker(socketId) {
    if (this._speakerSocketId === socketId) {
      this._speakerSocketId = null;
    }
  }

  setSlide(idx, socketId) {
    if (socketId !== this._speakerSocketId) {
      return false;
    }
    this._currentSlide = idx;
    return true;
  }

  getControlState() {
    return { ...this._controlState };
  }

  setControlState(state) {
    if (state.paused !== undefined) this._controlState.paused = state.paused;
    if (state.speed !== undefined) this._controlState.speed = state.speed;
    if (state.density !== undefined) this._controlState.density = state.density;
  }
}

module.exports = { SlideSync };
```

### Step 4: 运行测试确认通过

```bash
npx jest tests/slide-sync.test.js
```

Expected: PASS — 8 tests passed

### Step 5: 提交

```bash
git add lib/slide-sync.js tests/slide-sync.test.js
git commit -m "feat: slide sync state manager with tests"
```

---

## Task 5: Express 服务端基础 + HTML 路由

**Files:**
- Create: `server.js` (基础框架)

### Step 1: 实现 server.js 基础框架

Create: `server.js`

```javascript
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
```

### Step 2: 手动验证 HTTP 路由

```bash
node server.js examples/test-deck.html &
SERVER_PID=$!
sleep 2
curl -s http://localhost:3000/speaker | grep -o "BS_ROLE = 'speaker'"
curl -s http://localhost:3000/audience | grep -o "BS_ROLE = 'audience'"
curl -s http://localhost:3000/moderator | grep -o "BS_ROLE = 'moderator'"
kill $SERVER_PID
```

Expected: 三行输出各匹配对应角色

### Step 3: 验证缺少参数时退出

```bash
node server.js 2>&1 | head -1
```

Expected: `Usage: node server.js <path-to-html-file>`

### Step 4: 提交

```bash
git add server.js
git commit -m "feat: express server with role routes and html injection"
```

---

## Task 6: Socket.IO 事件处理

**Files:**
- Modify: `server.js` (添加 Socket.IO 事件处理)

### Step 1: 在 server.js 中添加 Socket.IO 处理逻辑

在 `server.js` 的 `httpServer.listen` 之前插入以下代码：

```javascript
const { DanmakuStore } = require('./lib/danmaku-store');
const { SlideSync } = require('./lib/slide-sync');

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
    store.setModeratorCount(modCount);
  });
});
```

Also add requires at top of `server.js`:

```javascript
// After existing requires, add:
const { DanmakuStore } = require('./lib/danmaku-store');
const { SlideSync } = require('./lib/slide-sync');
```

### Step 2: 运行全量测试确保无回归

```bash
npx jest
```

Expected: All tests pass

### Step 3: 手动验证 Socket.IO 连接

```bash
node server.js examples/test-deck.html &
SERVER_PID=$!
sleep 2
# Test with a simple socket.io client or curl to verify server starts
curl -s http://localhost:3000/socket.io/socket.io.js | head -1
kill $SERVER_PID
```

Expected: Socket.IO client library served

### Step 4: 提交

```bash
git add server.js
git commit -m "feat: socket.io event handlers for danmaku, moderation, slide sync"
```

---

## Task 7: 前端 CSS

**Files:**
- Create: `public/danmaku.css`

### Step 1: 创建 danmaku.css

Create: `public/danmaku.css`

```css
/* ===== Danmaku Layer ===== */
#danmaku-layer {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 9999;
  overflow: hidden;
}

#danmaku-layer .danmaku {
  position: absolute;
  white-space: nowrap;
  font-size: 18px;
  font-weight: bold;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", sans-serif;
  text-shadow: 1px 1px 2px rgba(0,0,0,0.8), 0 0 4px rgba(0,0,0,0.5);
  pointer-events: auto;
  cursor: default;
  user-select: none;
  line-height: 1.4;
  padding: 2px 8px;
  border-radius: 4px;
}

#danmaku-layer .danmaku:hover {
  animation-play-state: paused !important;
}

#danmaku-layer .danmaku .dm-bg {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.3);
  border-radius: 4px;
  z-index: -1;
}

/* ===== Speaker Control Bar ===== */
#speaker-controls {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 48px;
  background: rgba(0,0,0,0.6);
  backdrop-filter: blur(10px);
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 20px;
  z-index: 10000;
  pointer-events: auto;
  color: #fff;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", sans-serif;
  font-size: 13px;
}

#speaker-controls button {
  background: rgba(255,255,255,0.1);
  border: 1px solid rgba(255,255,255,0.2);
  color: #fff;
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}

#speaker-controls button:hover {
  background: rgba(255,255,255,0.2);
}

#speaker-controls .control-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

#speaker-controls input[type="range"] {
  width: 80px;
}

/* ===== Sidebar (Audience & Moderator) ===== */
#side-panel {
  position: fixed;
  top: 0;
  right: 0;
  width: 280px;
  height: 100%;
  background: rgba(0,0,0,0.75);
  backdrop-filter: blur(10px);
  z-index: 10000;
  display: flex;
  flex-direction: column;
  color: #fff;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", sans-serif;
  transition: transform 0.3s ease;
  pointer-events: auto;
}

#side-panel.collapsed {
  transform: translateX(calc(100% - 32px));
}

#side-panel .panel-toggle {
  position: absolute;
  left: -32px;
  top: 50%;
  transform: translateY(-50%);
  width: 32px;
  height: 64px;
  background: rgba(0,0,0,0.6);
  border-radius: 8px 0 0 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 18px;
  color: #fff;
}

#side-panel .panel-header {
  padding: 16px;
  border-bottom: 1px solid rgba(255,255,255,0.1);
  font-size: 14px;
  font-weight: 600;
}

#side-panel .panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

/* ===== Audience Input ===== */
#audience-input {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

#audience-input textarea {
  width: 100%;
  min-height: 60px;
  background: rgba(255,255,255,0.1);
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 6px;
  color: #fff;
  padding: 8px;
  font-size: 14px;
  resize: vertical;
}

#audience-input textarea::placeholder {
  color: rgba(255,255,255,0.5);
}

#audience-input button {
  background: #4a9eff;
  border: none;
  color: #fff;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
}

#audience-input button:hover {
  background: #6ab2ff;
}

#audience-input .color-picker {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

#audience-input .color-option {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid transparent;
  transition: border-color 0.2s;
}

#audience-input .color-option.selected {
  border-color: #fff;
}

#audience-input .send-status {
  font-size: 12px;
  color: rgba(255,255,255,0.6);
  min-height: 18px;
}

/* ===== Moderator Panel ===== */
#moderator-queue {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dm-card {
  background: rgba(255,255,255,0.08);
  border-radius: 8px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dm-card .dm-text {
  font-size: 14px;
  line-height: 1.4;
  word-break: break-word;
}

.dm-card .dm-actions {
  display: flex;
  gap: 8px;
}

.dm-card .dm-actions button {
  flex: 1;
  padding: 6px 0;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
}

.dm-card .dm-actions .btn-approve {
  background: #3fb950;
  color: #fff;
}

.dm-card .dm-actions .btn-block {
  background: #f85149;
  color: #fff;
}

.mode-label {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
}

.mode-label.auto {
  background: rgba(63, 185, 80, 0.3);
  color: #3fb950;
}

.mode-label.review {
  background: rgba(248, 177, 50, 0.3);
  color: #f8b132;
}
```

### Step 2: 提交

```bash
git add public/danmaku.css
git commit -m "feat: danmaku css with layer, controls, and side panel styles"
```

---

## Task 8: 前端 JS - 弹幕渲染器

**Files:**
- Create: `public/danmaku-renderer.js`

### Step 1: 创建 danmaku-renderer.js

Create: `public/danmaku-renderer.js`

```javascript
(function() {
  'use strict';

  const TRACK_COUNT = 8;
  const TRACK_HEIGHT_PCT = 100 / TRACK_COUNT;

  let socket = null;
  let danmakuLayer = null;
  let tracks = []; // Array of { lastEndTime, lastElement }
  let isPaused = false;
  let speedMultiplier = 1.0;
  let maxConcurrent = 5;
  let activeDanmaku = [];
  let pendingDanmaku = [];

  function init() {
    createLayer();
    initTracks();
    connectSocket();
    initRoleUI();
  }

  function createLayer() {
    danmakuLayer = document.createElement('div');
    danmakuLayer.id = 'danmaku-layer';
    document.body.appendChild(danmakuLayer);
  }

  function initTracks() {
    tracks = Array(TRACK_COUNT).fill(null).map(() => ({
      lastEndTime: 0,
      busyUntil: 0
    }));
  }

  function connectSocket() {
    const serverUrl = window.BS_SERVER || '';
    socket = io(serverUrl);

    socket.on('connect', () => {
      socket.emit('role', window.BS_ROLE);
    });

    socket.on('danmaku:approved', (dm) => {
      pendingDanmaku.push(dm);
      tryRender();
    });

    socket.on('danmaku:blocked', ({ id }) => {
      removeDanmaku(id);
    });

    socket.on('control:clear', () => {
      clearAll();
    });

    socket.on('control:pause', ({ paused }) => {
      setPaused(paused);
    });

    socket.on('control:speed', ({ speed }) => {
      speedMultiplier = speed;
    });

    socket.on('control:density', ({ density }) => {
      maxConcurrent = density;
    });

    socket.on('control:state', (state) => {
      isPaused = state.paused;
      speedMultiplier = state.speed;
      maxConcurrent = state.density;
    });
  }

  function tryRender() {
    if (isPaused) return;
    if (activeDanmaku.length >= maxConcurrent) return;
    if (pendingDanmaku.length === 0) return;

    const dm = pendingDanmaku.shift();
    const trackIdx = findAvailableTrack();
    if (trackIdx === -1) {
      pendingDanmaku.unshift(dm);
      return;
    }

    renderDanmaku(dm, trackIdx);

    // Try to render more
    if (pendingDanmaku.length > 0 && activeDanmaku.length < maxConcurrent) {
      requestAnimationFrame(tryRender);
    }
  }

  function findAvailableTrack() {
    const now = performance.now();
    for (let i = 0; i < TRACK_COUNT; i++) {
      if (now >= tracks[i].busyUntil) {
        return i;
      }
    }
    return -1;
  }

  function renderDanmaku(dm, trackIdx) {
    const el = document.createElement('div');
    el.className = 'danmaku';
    el.dataset.id = dm.id;
    el.style.color = dm.color;

    const bg = document.createElement('div');
    bg.className = 'dm-bg';
    el.appendChild(bg);

    const text = document.createElement('span');
    text.textContent = dm.text;
    el.appendChild(text);

    const trackTop = trackIdx * TRACK_HEIGHT_PCT;
    el.style.top = trackTop + '%';
    el.style.left = '100%';

    danmakuLayer.appendChild(el);
    activeDanmaku.push({ id: dm.id, el: el, track: trackIdx });

    // Measure and animate
    const width = el.offsetWidth;
    const screenWidth = window.innerWidth;
    const distance = screenWidth + width + 100;
    const baseDuration = 8000; // ms
    const duration = baseDuration / speedMultiplier;

    // Mark track as busy until this danmaku clears enough
    const clearRatio = 0.5;
    const clearTime = performance.now() + (duration * clearRatio);
    tracks[trackIdx].busyUntil = clearTime;

    // Use CSS transition for smooth animation
    el.style.transition = `transform ${duration}ms linear`;

    requestAnimationFrame(() => {
      el.style.transform = `translateX(-${distance}px)`;
    });

    // Cleanup after animation
    setTimeout(() => {
      removeDanmaku(dm.id);
    }, duration + 100);
  }

  function removeDanmaku(id) {
    const idx = activeDanmaku.findIndex(d => d.id === id);
    if (idx !== -1) {
      const dm = activeDanmaku[idx];
      if (dm.el && dm.el.parentNode) {
        dm.el.parentNode.removeChild(dm.el);
      }
      activeDanmaku.splice(idx, 1);
    }
    // Also remove from pending if present
    const pendingIdx = pendingDanmaku.findIndex(d => d.id === id);
    if (pendingIdx !== -1) {
      pendingDanmaku.splice(pendingIdx, 1);
    }
  }

  function clearAll() {
    activeDanmaku.forEach(dm => {
      if (dm.el && dm.el.parentNode) {
        dm.el.parentNode.removeChild(dm.el);
      }
    });
    activeDanmaku = [];
    pendingDanmaku = [];
    initTracks();
  }

  function setPaused(paused) {
    isPaused = paused;
    activeDanmaku.forEach(dm => {
      dm.el.style.animationPlayState = paused ? 'paused' : 'running';
    });
  }

  function initRoleUI() {
    const role = window.BS_ROLE;
    if (role === 'speaker') {
      initSpeakerControls();
    } else if (role === 'audience') {
      initAudiencePanel();
    } else if (role === 'moderator') {
      initModeratorPanel();
    }
  }

  function initSpeakerControls() {
    const controls = document.createElement('div');
    controls.id = 'speaker-controls';
    controls.innerHTML = `
      <button id="btn-clear">清空</button>
      <button id="btn-pause">暂停</button>
      <div class="control-group">
        <label>速度</label>
        <input type="range" id="speed-slider" min="0.5" max="3" step="0.1" value="1">
        <span id="speed-val">1.0x</span>
      </div>
      <div class="control-group">
        <label>密度</label>
        <input type="range" id="density-slider" min="1" max="10" step="1" value="5">
        <span id="density-val">5</span>
      </div>
    `;
    document.body.appendChild(controls);

    document.getElementById('btn-clear').addEventListener('click', () => {
      socket.emit('control:clear');
    });

    const pauseBtn = document.getElementById('btn-pause');
    pauseBtn.addEventListener('click', () => {
      const newPaused = !isPaused;
      socket.emit('control:pause', { paused: newPaused });
    });

    const speedSlider = document.getElementById('speed-slider');
    speedSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      document.getElementById('speed-val').textContent = val.toFixed(1) + 'x';
      socket.emit('control:speed', { speed: val });
    });

    const densitySlider = document.getElementById('density-slider');
    densitySlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      document.getElementById('density-val').textContent = val;
      socket.emit('control:density', { density: val });
    });
  }

  function initAudiencePanel() {
    // Import from audience-panel.js
    if (window.initAudiencePanel) {
      window.initAudiencePanel(socket);
    }
  }

  function initModeratorPanel() {
    // Import from moderator-panel.js
    if (window.initModeratorPanel) {
      window.initModeratorPanel(socket);
    }
  }

  // Expose to global for sub-modules
  window.DanmakuRenderer = {
    removeDanmaku,
    clearAll
  };

  // Auto-init when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
```

### Step 2: 提交

```bash
git add public/danmaku-renderer.js
git commit -m "feat: danmaku renderer with track management, controls, and socket events"
```

---

## Task 9: 前端 JS - 翻页同步

**Files:**
- Create: `public/slide-sync.js`

### Step 1: 创建 slide-sync.js

Create: `public/slide-sync.js`

```javascript
(function() {
  'use strict';

  let socket = null;
  let isFromRemote = false;

  function init() {
    // Wait for socket to be available (created by danmaku-renderer.js)
    const checkSocket = setInterval(() => {
      if (window.io && document.readyState !== 'loading') {
        clearInterval(checkSocket);
        setupSlideSync();
      }
    }, 50);
  }

  function setupSlideSync() {
    // Get existing socket from danmaku-renderer
    // We hook into the socket events via monkey-patching or event delegation
    // Since socket is created asynchronously, we wait for the 'connect' event

    document.addEventListener('socket:ready', (e) => {
      socket = e.detail;
      bindSocketEvents();
    });

    // Alternative: poll for socket
    const pollSocket = setInterval(() => {
      if (window._danmakuSocket) {
        clearInterval(pollSocket);
        socket = window._danmakuSocket;
        bindSocketEvents();
      }
    }, 100);

    // Setup keyboard fallback for slide detection
    setupKeyboardFallback();
  }

  function bindSocketEvents() {
    if (!socket) return;

    socket.on('slide:go', ({ idx }) => {
      goToSlide(idx, true);
    });

    socket.on('slide:sync', ({ idx }) => {
      goToSlide(idx, true);
    });

    // Only speaker broadcasts slide changes
    if (window.BS_ROLE === 'speaker') {
      setupBroadcastChannelListener();
    }
  }

  function setupBroadcastChannelListener() {
    // Listen to html-ppt's BroadcastChannel
    const channelName = 'html-ppt-presenter-' + location.pathname;
    let bc = null;
    try {
      bc = new BroadcastChannel(channelName);
    } catch (e) {
      console.log('BroadcastChannel not available, using keyboard fallback');
      return;
    }

    bc.onmessage = function(e) {
      if (!e.data) return;
      if (e.data.type === 'go' && typeof e.data.idx === 'number') {
        socket.emit('slide:go', { idx: e.data.idx });
      }
    };
  }

  function setupKeyboardFallback() {
    // For speaker: intercept keys and broadcast
    if (window.BS_ROLE !== 'speaker') return;

    document.addEventListener('keydown', function(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const navKeys = ['ArrowRight', 'ArrowLeft', ' ', 'PageDown', 'PageUp', 'Home', 'End'];
      if (!navKeys.includes(e.key)) return;

      // Get current slide index from html-ppt
      const slides = document.querySelectorAll('.slide');
      let currentIdx = 0;
      slides.forEach((s, i) => {
        if (s.classList.contains('is-active')) currentIdx = i;
      });

      let newIdx = currentIdx;
      switch(e.key) {
        case 'ArrowRight': case ' ': case 'PageDown':
          newIdx = Math.min(slides.length - 1, currentIdx + 1);
          break;
        case 'ArrowLeft': case 'PageUp':
          newIdx = Math.max(0, currentIdx - 1);
          break;
        case 'Home':
          newIdx = 0;
          break;
        case 'End':
          newIdx = slides.length - 1;
          break;
      }

      if (newIdx !== currentIdx && socket) {
        socket.emit('slide:go', { idx: newIdx });
      }
    });
  }

  function goToSlide(idx, fromRemote) {
    // html-ppt exposes go() globally or we call it directly
    if (typeof window.go === 'function') {
      window.go(idx, fromRemote);
      return;
    }

    // Fallback: manually toggle slide classes (for non-html-ppt or custom decks)
    const slides = document.querySelectorAll('.slide');
    if (idx >= 0 && idx < slides.length) {
      slides.forEach((s, i) => {
        s.classList.toggle('is-active', i === idx);
      });
    }
  }

  // Hook into danmaku-renderer to get socket reference
  // This runs after danmaku-renderer creates the socket
  const originalEmit = document.createEvent ? null : null;

  // Polling approach to get socket from global
  window._slideSyncInit = init;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
```

### Step 2: 提交

```bash
git add public/slide-sync.js
git commit -m "feat: slide sync client with BroadcastChannel and keyboard fallback"
```

---

## Task 10: 前端 JS - 角色面板

**Files:**
- Create: `public/audience-panel.js`
- Create: `public/moderator-panel.js`

### Step 1: 创建 audience-panel.js

Create: `public/audience-panel.js`

```javascript
(function() {
  'use strict';

  const COLORS = [
    { name: '白', value: '#ffffff' },
    { name: '红', value: '#ff4444' },
    { name: '黄', value: '#ffcc00' },
    { name: '绿', value: '#44ff44' },
    { name: '青', value: '#00ffff' },
    { name: '蓝', value: '#4488ff' },
    { name: '粉', value: '#ff88cc' },
    { name: '橙', value: '#ff8844' }
  ];

  window.initAudiencePanel = function(socket) {
    createPanel(socket);
  };

  function createPanel(socket) {
    const panel = document.createElement('div');
    panel.id = 'side-panel';
    panel.innerHTML = `
      <div class="panel-toggle" title="收起/展开">◀</div>
      <div class="panel-header">发送弹幕</div>
      <div class="panel-body">
        <div id="audience-input">
          <textarea id="dm-text" placeholder="输入弹幕内容..." maxlength="100"></textarea>
          <div class="color-picker" id="color-picker"></div>
          <button id="btn-send">发送</button>
          <div class="send-status" id="send-status"></div>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    // Color picker
    const picker = document.getElementById('color-picker');
    let selectedColor = COLORS[0].value;

    COLORS.forEach(c => {
      const opt = document.createElement('div');
      opt.className = 'color-option' + (c.value === selectedColor ? ' selected' : '');
      opt.style.backgroundColor = c.value;
      opt.title = c.name;
      opt.addEventListener('click', () => {
        selectedColor = c.value;
        picker.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
      });
      picker.appendChild(opt);
    });

    // Toggle
    const toggle = panel.querySelector('.panel-toggle');
    let collapsed = false;
    toggle.addEventListener('click', () => {
      collapsed = !collapsed;
      panel.classList.toggle('collapsed', collapsed);
      toggle.textContent = collapsed ? '▶' : '◀';
    });

    // Send
    const textInput = document.getElementById('dm-text');
    const sendBtn = document.getElementById('btn-send');
    const statusEl = document.getElementById('send-status');

    function send() {
      const text = textInput.value.trim();
      if (!text) {
        statusEl.textContent = '请输入弹幕内容';
        return;
      }
      socket.emit('danmaku:send', { text, color: selectedColor });
      textInput.value = '';
      statusEl.textContent = '已发送，等待审核...';
    }

    sendBtn.addEventListener('click', send);
    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });

    // Status feedback
    socket.on('danmaku:rejected', () => {
      statusEl.textContent = '弹幕未通过审核';
      setTimeout(() => { statusEl.textContent = ''; }, 3000);
    });

    socket.on('danmaku:approved', () => {
      statusEl.textContent = '';
    });
  }
})();
```

### Step 2: 创建 moderator-panel.js

Create: `public/moderator-panel.js`

```javascript
(function() {
  'use strict';

  window.initModeratorPanel = function(socket) {
    createPanel(socket);
  };

  function createPanel(socket) {
    const panel = document.createElement('div');
    panel.id = 'side-panel';
    panel.innerHTML = `
      <div class="panel-toggle" title="收起/展开">◀</div>
      <div class="panel-header">
        弹幕审核
        <span class="mode-label auto" id="mode-label">自动通过</span>
      </div>
      <div class="panel-body">
        <div id="moderator-queue"></div>
      </div>
    `;
    document.body.appendChild(panel);

    const queueEl = document.getElementById('moderator-queue');
    const modeLabel = document.getElementById('mode-label');
    const pendingMap = new Map();

    // Toggle
    const toggle = panel.querySelector('.panel-toggle');
    let collapsed = false;
    toggle.addEventListener('click', () => {
      collapsed = !collapsed;
      panel.classList.toggle('collapsed', collapsed);
      toggle.textContent = collapsed ? '▶' : '◀';
    });

    // Socket events
    socket.on('danmaku:pending', (dm) => {
      addPendingCard(dm);
      updateModeLabel(true);
    });

    socket.on('danmaku:removed', ({ id }) => {
      removeCard(id);
    });

    socket.on('moderation:status', ({ active }) => {
      updateModeLabel(active);
    });

    socket.on('moderation:pending', (list) => {
      queueEl.innerHTML = '';
      pendingMap.clear();
      list.forEach(dm => addPendingCard(dm));
      updateModeLabel(list.length > 0);
    });

    function addPendingCard(dm) {
      if (pendingMap.has(dm.id)) return;

      const card = document.createElement('div');
      card.className = 'dm-card';
      card.dataset.id = dm.id;
      card.innerHTML = `
        <div class="dm-text" style="color: ${dm.color}">${escapeHtml(dm.text)}</div>
        <div class="dm-actions">
          <button class="btn-approve">通过</button>
          <button class="btn-block">拦截</button>
        </div>
      `;

      card.querySelector('.btn-approve').addEventListener('click', () => {
        socket.emit('danmaku:approve', { id: dm.id });
      });

      card.querySelector('.btn-block').addEventListener('click', () => {
        socket.emit('danmaku:block', { id: dm.id });
      });

      queueEl.appendChild(card);
      pendingMap.set(dm.id, card);
    }

    function removeCard(id) {
      const card = pendingMap.get(id);
      if (card) {
        card.remove();
        pendingMap.delete(id);
      }
      if (pendingMap.size === 0) {
        updateModeLabel(false);
      }
    }

    function updateModeLabel(active) {
      if (active) {
        modeLabel.textContent = `审核中 (${pendingMap.size})`;
        modeLabel.className = 'mode-label review';
      } else {
        modeLabel.textContent = '自动通过';
        modeLabel.className = 'mode-label auto';
      }
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
  }
})();
```

### Step 3: 提交

```bash
git add public/audience-panel.js public/moderator-panel.js
git commit -m "feat: audience and moderator side panels"
```

---

## Task 11: 修复 socket 引用连通性 + 集成验证

**Files:**
- Modify: `public/danmaku-renderer.js` (暴露 socket 到全局)

### Step 1: 修改 danmaku-renderer.js 暴露 socket

在 `connectSocket` 函数中，socket 创建后添加：

```javascript
function connectSocket() {
  const serverUrl = window.BS_SERVER || '';
  socket = io(serverUrl);
  window._danmakuSocket = socket; // Expose for slide-sync.js

  socket.on('connect', () => {
    socket.emit('role', window.BS_ROLE);
  });
  // ... rest of existing code
```

### Step 2: 更新 server.js 中注入的 script 加载顺序

在 `server.js` 的 `injectHtml` 调用中，确保 slide-sync.js、audience-panel.js、moderator-panel.js 也在注入列表中。

修改 `lib/html-injector.js` 中的 script 注入部分：

```javascript
  const script = `
    <script>
      window.BS_ROLE = '${role}';
      window.BS_SERVER = '${serverUrl}';
    </script>
    <script src="/socket.io/socket.io.js"></script>
    <script src="/public/danmaku-renderer.js"></script>
    <script src="/public/slide-sync.js"></script>
    <script src="/public/audience-panel.js"></script>
    <script src="/public/moderator-panel.js"></script>
  `;
```

### Step 3: 运行全量测试

```bash
npx jest
```

Expected: All tests pass

### Step 4: 启动服务进行集成验证

```bash
node server.js examples/test-deck.html
```

Expected console output:
```
🎯 弹幕服务器已启动

演讲者: http://192.168.x.x:3000/speaker
管理者: http://192.168.x.x:3000/moderator
观众:   http://192.168.x.x:3000/audience
```

### Step 5: 手动浏览器验证

1. 打开浏览器访问 `http://localhost:3000/speaker`
2. 确认 HTML 内容显示正常（"第一页"）
3. 确认底部控制栏显示（清空、暂停、速度、密度）
4. 打开另一个标签页访问 `http://localhost:3000/audience`
5. 确认侧边栏可以展开/收起
6. 在观众页面输入弹幕并发送
7. 确认弹幕出现在演讲者页面（因为无管理者，自动通过）
8. 打开管理者页面 `http://localhost:3000/moderator`
9. 从观众发送弹幕，确认管理者侧边栏出现待审核卡片
10. 点击通过，确认弹幕出现在屏幕上
11. 在演讲者页面按 → 翻页，确认观众和管理者同步翻页

### Step 6: 提交

```bash
git add lib/html-injector.js public/danmaku-renderer.js public/slide-sync.js
git commit -m "fix: wire up socket sharing and script loading order"
```

---

## 自我审查

### 1. Spec 覆盖检查

| Spec Section | 对应 Task |
|-------------|-----------|
| 架构 Overview (服务端组件) | Task 2,3,4,5,6 |
| HTML 注入 | Task 2 |
| WebSocket 消息协议 | Task 6 (Socket.IO handlers) |
| 弹幕系统 (渲染/轨道/样式/控制) | Task 8 (renderer), Task 7 (CSS) |
| 角色页面布局 | Task 8,10 (controls + panels), Task 7 (CSS) |
| 翻页同步机制 | Task 9 (slide-sync) |
| 管理者审核流程 | Task 6 (server handlers), Task 10 (moderator panel) |
| 错误处理 | Task 5 (file validation), Task 6 (disconnect handling) |

**无遗漏。**

### 2. 占位符扫描

- 无 TBD/TODO
- 无 "add appropriate error handling" 类模糊描述
- 所有步骤包含完整代码
- 所有测试包含具体断言

### 3. 类型一致性

- `slide:go` payload: `{ idx: number }` — 全 plan 一致
- `control:state`: `{ paused, speed, density }` — 全 plan 一致
- `danmaku:send`: `{ text, color }` — 全 plan 一致
- Socket.IO 事件名 — 全 plan 与设计文档一致

**无冲突。**

---

## 执行交接

**计划已完成并保存至 `docs/superpowers/plans/2026-05-24-bullet-screen-plan.md`。两种执行方式：**

**1. Subagent-Driven（推荐）** — 每个 Task 派发给独立子代理，Task 之间我进行审查，快速迭代

**2. Inline Execution** — 在当前会话中使用 executing-plans 顺序执行，批量处理带检查点

**请选择执行方式。**

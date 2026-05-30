# 观众体验优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为弹幕服务器新增三项观众体验优化：根路径访问、手机浏览器适配、ngrok 外网分享。

**Architecture:** 服务端新增 ngrok 隧道自动创建和二维码生成；前端通过 CSS 媒体查询切换桌面/移动端布局；演讲者页面新增 `Ctrl+Alt+S` 分享弹窗。

**Tech Stack:** Node.js, Express, Socket.IO, ngrok, qrcode

---

## 文件结构

| 文件 | 变更 | 说明 |
|------|------|------|
| `package.json` | 修改 | 新增 `@ngrok/ngrok`、`qrcode` 依赖 |
| `lib/html-injector.js` | 修改 | 扩展注入变量，支持 speaker 专属全局变量 |
| `tests/html-injector.test.js` | 修改 | 新增注入变量测试 |
| `server.js` | 修改 | 新增根路径路由、ngrok 初始化、二维码生成 |
| `public/danmaku.css` | 修改 | 新增移动端媒体查询（FAB + 抽屉） |
| `public/audience-panel.js` | 修改 | 新增移动端 FAB + 抽屉初始化 |
| `public/danmaku-renderer.js` | 修改 | 在 `initSpeakerControls()` 中新增分享弹窗 |
| `README.md` | 修改 | 补充 ngrok 配置和移动端说明 |

> 注：`public/speaker-controls.js` 在设计 spec 中列出，但现有代码将 speaker controls 内联在 `danmaku-renderer.js` 中。为最小化改动，分享弹窗直接追加到现有 `initSpeakerControls()` 函数，不提取新文件。

---

### Task 1: 安装 ngrok 和 qrcode 依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装依赖**

```bash
npm install @ngrok/ngrok qrcode
```

- [ ] **Step 2: 验证 package.json**

确认 `dependencies` 中新增了：
```json
"@ngrok/ngrok": "^1.4.0",
"qrcode": "^1.5.4"
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add @ngrok/ngrok and qrcode"
```

---

### Task 2: 扩展 html-injector.js 支持新增全局变量

**Files:**
- Modify: `lib/html-injector.js`
- Modify: `tests/html-injector.test.js`

- [ ] **Step 1: 写测试 — 验证 speaker 角色注入额外变量**

在 `tests/html-injector.test.js` 末尾新增：

```javascript
  test('injects public URL and QR code for speaker role', () => {
    const result = injectHtml(sampleHtml, 'speaker', 'http://localhost:3000', 'https://abc.ngrok.io', 'http://192.168.1.5:3000', 'data:image/png;base64,test');
    expect(result).toContain("window.BS_PUBLIC_URL = 'https://abc.ngrok.io'");
    expect(result).toContain("window.BS_LAN_URL = 'http://192.168.1.5:3000'");
    expect(result).toContain("window.BS_QR_CODE = 'data:image/png;base64,test'");
  });

  test('does not inject speaker-only vars for audience role', () => {
    const result = injectHtml(sampleHtml, 'audience', 'http://localhost:3000', 'https://abc.ngrok.io', 'http://192.168.1.5:3000', 'data:image/png;base64,test');
    expect(result).not.toContain('BS_PUBLIC_URL');
    expect(result).not.toContain('BS_LAN_URL');
    expect(result).not.toContain('BS_QR_CODE');
  });
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npm test -- tests/html-injector.test.js
```

Expected: 2 new tests FAIL with `Expected value not found in result`

- [ ] **Step 3: 修改 html-injector.js**

将 `lib/html-injector.js` 完整替换为：

```javascript
function injectHtml(originalHtml, role, serverUrl, publicUrl, lanUrl, qrDataUrl) {
  if (!originalHtml.includes('</head>')) {
    throw new Error('HTML must contain </head>');
  }
  if (!originalHtml.includes('</body>')) {
    throw new Error('HTML must contain </body>');
  }

  const css = `<link rel="stylesheet" href="/public/danmaku.css">`;
  let html = originalHtml.replace('</head>', css + '\n</head>');

  const speakerVars = role === 'speaker' && publicUrl
    ? `window.BS_PUBLIC_URL = '${publicUrl}';
      window.BS_LAN_URL = '${lanUrl || ''}';
      window.BS_QR_CODE = '${qrDataUrl || ''}';`
    : '';

  const script = `
    <script>
      window.BS_ROLE = '${role}';
      window.BS_SERVER = '${serverUrl}';
      ${speakerVars}
    </script>
    <script src="/socket.io/socket.io.js"></script>
    <script src="/public/danmaku-renderer.js"></script>
    <script src="/public/slide-sync.js"></script>
    <script src="/public/audience-panel.js"></script>
    <script src="/public/moderator-panel.js"></script>
  `;
  html = html.replace('</body>', script + '\n</body>');

  return html;
}

module.exports = { injectHtml };
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
npm test -- tests/html-injector.test.js
```

Expected: 所有 8 个测试 PASS

- [ ] **Step 5: Commit**

```bash
git add lib/html-injector.js tests/html-injector.test.js
git commit -m "feat: extend html-injector with public URL and QR code vars"
```

---

### Task 3: 新增根路径路由

**Files:**
- Modify: `server.js`

- [ ] **Step 1: 在 server.js 中新增根路径路由**

在 `server.js` 中，在现有路由之前插入：

```javascript
app.get('/', (req, res) => {
  const html = injectHtml(originalHtml, 'audience', '');
  res.send(html);
});
```

位置：在 `app.get('/speaker', ...)` 之前。

完整的路由区域应变为：

```javascript
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
```

- [ ] **Step 2: 启动服务器手动验证**

```bash
node server.js examples/test-deck.html
```

在浏览器中访问 `http://localhost:3000/`，确认：
- 页面正常加载
- 右侧出现观众侧边栏（与 `/audience` 效果一致）

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: add root path / as audience entry"
```

---

### Task 4: 集成 ngrok 和二维码生成

**Files:**
- Modify: `server.js`

- [ ] **Step 1: 在 server.js 顶部引入新模块**

在现有 require 之后添加：

```javascript
const ngrok = require('@ngrok/ngrok');
const QRCode = require('qrcode');
```

- [ ] **Step 2: 在 server.js 中添加 ngrok 隧道函数**

在 `const slideSync = new SlideSync();` 之前插入：

```javascript
async function startTunnel(port) {
  const token = process.env.NGROK_AUTHTOKEN;
  if (!token) {
    console.log('\n⚠️  未设置 NGROK_AUTHTOKEN，仅提供局域网访问');
    console.log('   如需外网访问，请访问 https://dashboard.ngrok.com 获取 token');
    console.log('   然后运行: set NGROK_AUTHTOKEN=xxx && node server.js <html>\n');
    return null;
  }

  try {
    const listener = await ngrok.connect({ addr: port, authtoken: token });
    return listener.url();
  } catch (err) {
    console.error('ngrok 连接失败:', err.message);
    return null;
  }
}
```

- [ ] **Step 3: 重构 server.js 启动逻辑为 async**

将 `httpServer.listen(...)` 代码块改为：

```javascript
async function main() {
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

    // Update routes to use injected URLs
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
      console.log(`外网访问（ngrok）：`);
      console.log(`  观众:   ${publicUrl}/\n`);
    }
    console.log(`快捷键：Ctrl + Alt + S 打开分享弹窗\n`);
  });
}

main();
```

> 注意：这一步移除了原来的路由定义（提前定义的 `app.get(...)`），改为在 `listen` 回调中定义，因为此时 `publicUrl`、`lanUrl`、`qrDataUrl` 已经确定。

- [ ] **Step 4: 移除旧的路由定义**

删除 `server.js` 中 `app.use('/public', ...)` 之后、`const store = ...` 之前的那段旧路由代码（即提前定义的 3 个 `app.get`）。

- [ ] **Step 5: 手动验证**

**场景 A：未设置 NGROK_AUTHTOKEN**
```bash
node server.js examples/test-deck.html
```
Expected 输出：
```
⚠️  未设置 NGROK_AUTHTOKEN，仅提供局域网访问
...
局域网访问：
  演讲者: http://192.168.x.x:3000/speaker
  ...
```

**场景 B：设置了 NGROK_AUTHTOKEN**
```bash
set NGROK_AUTHTOKEN=your_token_here
node server.js examples/test-deck.html
```
Expected 输出：
```
🎯 弹幕服务器已启动

局域网访问：
  演讲者: http://192.168.x.x:3000/speaker
  ...

外网访问（ngrok）：
  观众:   https://xxx.ngrok-free.app/

快捷键：Ctrl + Alt + S 打开分享弹窗
```

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "feat: integrate ngrok tunnel and QR code generation"
```

---

### Task 5: 移动端 CSS（FAB + 抽屉）

**Files:**
- Modify: `public/danmaku.css`

- [ ] **Step 1: 在 danmaku.css 末尾追加移动端样式**

在 `public/danmaku.css` 末尾追加：

```css
/* ===== Mobile Styles ===== */
@media (max-width: 768px) {
  /* Hide desktop side panel */
  #side-panel {
    display: none !important;
  }

  /* Floating Action Button */
  #mobile-fab {
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: #4a9eff;
    color: #fff;
    border: none;
    font-size: 24px;
    font-weight: bold;
    cursor: pointer;
    z-index: 10001;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    pointer-events: auto;
    -webkit-tap-highlight-color: transparent;
  }

  #mobile-fab:active {
    transform: scale(0.95);
  }

  /* Mobile Drawer */
  #mobile-drawer {
    position: fixed;
    top: 0;
    right: 0;
    width: 80vw;
    max-width: 320px;
    height: 100vh;
    background: rgba(0,0,0,0.85);
    backdrop-filter: blur(10px);
    z-index: 10002;
    transform: translateX(100%);
    transition: transform 0.3s ease;
    display: flex;
    flex-direction: column;
    color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", sans-serif;
    pointer-events: auto;
  }

  #mobile-drawer.open {
    transform: translateX(0);
  }

  #mobile-drawer .drawer-header {
    padding: 16px;
    border-bottom: 1px solid rgba(255,255,255,0.1);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  #mobile-drawer .drawer-header span {
    font-size: 16px;
    font-weight: 600;
  }

  #mobile-drawer .drawer-header button {
    background: none;
    border: none;
    color: #fff;
    font-size: 20px;
    cursor: pointer;
    padding: 4px;
  }

  #mobile-drawer .drawer-body {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
  }

  /* Drawer overlay */
  #drawer-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.5);
    z-index: 10001;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.3s ease, visibility 0.3s ease;
  }

  #drawer-overlay.visible {
    opacity: 1;
    visibility: visible;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add public/danmaku.css
git commit -m "style: add mobile FAB and drawer styles"
```

---

### Task 6: 移动端观众面板逻辑

**Files:**
- Modify: `public/audience-panel.js`

- [ ] **Step 1: 修改 audience-panel.js 支持移动端**

将 `public/audience-panel.js` 完整替换为：

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
    const isMobile = window.innerWidth < 768;
    if (isMobile) {
      createMobilePanel(socket);
    } else {
      createDesktopPanel(socket);
    }
  };

  // ===== Desktop: side panel =====
  function createDesktopPanel(socket) {
    const panel = document.createElement('div');
    panel.id = 'side-panel';
    panel.innerHTML = `
      <div class="panel-toggle" title="收起/展开">▶</div>
      <div class="panel-header">发送弹幕</div>
      <div class="panel-body"></div>
    `;
    document.body.appendChild(panel);

    const body = panel.querySelector('.panel-body');
    body.appendChild(buildInputArea(socket));

    const toggle = panel.querySelector('.panel-toggle');
    let collapsed = false;
    toggle.addEventListener('click', () => {
      collapsed = !collapsed;
      panel.classList.toggle('collapsed', collapsed);
      toggle.textContent = collapsed ? '◀' : '▶';
    });
  }

  // ===== Mobile: FAB + drawer =====
  function createMobilePanel(socket) {
    // FAB
    const fab = document.createElement('button');
    fab.id = 'mobile-fab';
    fab.textContent = '+';
    fab.setAttribute('aria-label', '发送弹幕');
    document.body.appendChild(fab);

    // Overlay
    const overlay = document.createElement('div');
    overlay.id = 'drawer-overlay';
    document.body.appendChild(overlay);

    // Drawer
    const drawer = document.createElement('div');
    drawer.id = 'mobile-drawer';
    drawer.innerHTML = `
      <div class="drawer-header">
        <span>发送弹幕</span>
        <button class="drawer-close">✕</button>
      </div>
      <div class="drawer-body"></div>
    `;
    document.body.appendChild(drawer);

    const body = drawer.querySelector('.drawer-body');
    body.appendChild(buildInputArea(socket));

    // Open/close
    function openDrawer() {
      drawer.classList.add('open');
      overlay.classList.add('visible');
    }

    function closeDrawer() {
      drawer.classList.remove('open');
      overlay.classList.remove('visible');
    }

    fab.addEventListener('click', openDrawer);
    drawer.querySelector('.drawer-close').addEventListener('click', closeDrawer);
    overlay.addEventListener('click', closeDrawer);
  }

  // ===== Shared input area =====
  function buildInputArea(socket) {
    const wrapper = document.createElement('div');
    wrapper.id = 'audience-input';
    wrapper.innerHTML = `
      <textarea id="dm-text" placeholder="输入弹幕内容..." maxlength="100" rows="3"></textarea>
      <div class="color-picker" id="color-picker"></div>
      <button id="btn-send">发送</button>
      <div class="send-status" id="send-status"></div>
    `;

    // Defer setup to next tick so DOM is ready
    setTimeout(() => {
      const picker = wrapper.querySelector('#color-picker');
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

      const textInput = wrapper.querySelector('#dm-text');
      const sendBtn = wrapper.querySelector('#btn-send');
      const statusEl = wrapper.querySelector('#send-status');

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

      socket.on('danmaku:rejected', () => {
        statusEl.textContent = '弹幕未通过审核';
        setTimeout(() => { statusEl.textContent = ''; }, 3000);
      });

      socket.on('danmaku:approved', () => {
        statusEl.textContent = '';
      });
    }, 0);

    return wrapper;
  }
})();
```

- [ ] **Step 2: 手动验证**

启动服务器：
```bash
node server.js examples/test-deck.html
```

**桌面端验证：**
- 浏览器访问 `http://localhost:3000/audience`
- 确认右侧侧边栏正常显示，可以发送弹幕

**移动端验证：**
- 浏览器 DevTools 切换到手机模式（宽度 < 768px）
- 刷新页面，确认：
  - 右侧侧边栏消失
  - 右下角出现蓝色圆形 FAB（`+` 按钮）
  - 点击 FAB，右侧滑出抽屉，包含输入框、颜色选择、发送按钮
  - 点击遮罩层或 ✕ 按钮关闭抽屉

- [ ] **Step 3: Commit**

```bash
git add public/audience-panel.js
git commit -m "feat: add mobile FAB + drawer for audience panel"
```

---

### Task 7: 演讲者分享弹窗（Ctrl+Alt+S）

**Files:**
- Modify: `public/danmaku-renderer.js:218-261`（`initSpeakerControls` 函数）

- [ ] **Step 1: 替换 initSpeakerControls 函数**

将 `public/danmaku-renderer.js` 中第 218-261 行的 `initSpeakerControls` 函数替换为：

```javascript
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
      pauseBtn.textContent = newPaused ? '恢复' : '暂停';
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

    // Share modal
    setupShareModal();
  }
```

然后在 `initSpeakerControls` 函数之后（第 261 行之后）添加新函数：

```javascript
  function setupShareModal() {
    const publicUrl = window.BS_PUBLIC_URL || '';
    const lanUrl = window.BS_LAN_URL || '';
    const qrCode = window.BS_QR_CODE || '';

    if (!publicUrl && !lanUrl) return;

    // Create modal elements (hidden by default)
    const modal = document.createElement('div');
    modal.id = 'share-modal';
    modal.innerHTML = `
      <div class="share-overlay"></div>
      <div class="share-content">
        <div class="share-header">
          <span>分享演示</span>
          <button class="share-close">✕</button>
        </div>
        <div class="share-body">
          ${qrCode ? `
            <div class="share-qr">
              <p>📱 手机观众请扫码</p>
              <img src="${qrCode}" alt="QR Code" />
            </div>
          ` : ''}
          ${publicUrl ? `
            <div class="share-link">
              <span>🔗 外网</span>
              <input type="text" value="${publicUrl}/" readonly />
              <button class="btn-copy" data-url="${publicUrl}/">复制链接</button>
            </div>
          ` : ''}
          ${lanUrl ? `
            <div class="share-link">
              <span>🏠 局域网</span>
              <input type="text" value="${lanUrl}/" readonly />
              <button class="btn-copy" data-url="${lanUrl}/">复制链接</button>
            </div>
          ` : ''}
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Styles
    const style = document.createElement('style');
    style.textContent = `
      #share-modal { display: none; position: fixed; inset: 0; z-index: 20000; align-items: center; justify-content: center; }
      #share-modal.active { display: flex; }
      #share-modal .share-overlay { position: absolute; inset: 0; background: rgba(0,0,0,0.6); }
      #share-modal .share-content { position: relative; background: #1a1a2e; border-radius: 12px; width: 90%; max-width: 400px; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", sans-serif; overflow: hidden; }
      #share-modal .share-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,0.1); font-size: 16px; font-weight: 600; }
      #share-modal .share-header button { background: none; border: none; color: #fff; font-size: 18px; cursor: pointer; }
      #share-modal .share-body { padding: 20px; display: flex; flex-direction: column; gap: 16px; }
      #share-modal .share-qr { text-align: center; }
      #share-modal .share-qr p { margin: 0 0 12px; font-size: 14px; }
      #share-modal .share-qr img { width: 200px; height: 200px; border-radius: 8px; }
      #share-modal .share-link { display: flex; flex-direction: column; gap: 6px; }
      #share-modal .share-link span { font-size: 13px; color: rgba(255,255,255,0.7); }
      #share-modal .share-link input { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: #fff; padding: 8px 10px; font-size: 13px; font-family: monospace; }
      #share-modal .share-link .btn-copy { align-self: flex-start; background: #4a9eff; border: none; color: #fff; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 13px; }
      #share-modal .share-link .btn-copy:hover { background: #6ab2ff; }
      #share-modal .share-link .btn-copy.copied { background: #3fb950; }
    `;
    document.head.appendChild(style);

    // Open/close
    function openModal() {
      modal.classList.add('active');
    }

    function closeModal() {
      modal.classList.remove('active');
    }

    modal.querySelector('.share-close').addEventListener('click', closeModal);
    modal.querySelector('.share-overlay').addEventListener('click', closeModal);

    // Keyboard shortcut: Ctrl+Alt+S
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.altKey && e.key === 's') {
        e.preventDefault();
        openModal();
      }
      if (e.key === 'Escape' && modal.classList.contains('active')) {
        closeModal();
      }
    });

    // Copy buttons
    modal.querySelectorAll('.btn-copy').forEach(btn => {
      btn.addEventListener('click', async () => {
        const url = btn.dataset.url;
        try {
          if (navigator.clipboard) {
            await navigator.clipboard.writeText(url);
          } else {
            const input = document.createElement('input');
            input.value = url;
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            document.body.removeChild(input);
          }
          const originalText = btn.textContent;
          btn.textContent = '已复制';
          btn.classList.add('copied');
          setTimeout(() => {
            btn.textContent = originalText;
            btn.classList.remove('copied');
          }, 2000);
        } catch (err) {
          btn.textContent = '复制失败';
          setTimeout(() => { btn.textContent = '复制链接'; }, 2000);
        }
      });
    });
  }
```

- [ ] **Step 2: 手动验证**

启动服务器（设置 NGROK_AUTHTOKEN 以获得完整体验）：
```bash
set NGROK_AUTHTOKEN=your_token
node server.js examples/test-deck.html
```

访问 `http://localhost:3000/speaker`，验证：
- 按 `Ctrl + Alt + S`，弹出分享弹窗
- 弹窗显示外网链接、局域网链接、二维码
- 点击「复制链接」按钮，链接被复制到剪贴板，按钮文字变为「已复制」
- 点击 ✕ 或按 `Esc` 关闭弹窗
- 弹窗关闭后，键盘翻页功能正常

**降级验证（不设置 NGROK_AUTHTOKEN）：**
- 弹窗只显示局域网链接，不显示外网区域和二维码

- [ ] **Step 3: Commit**

```bash
git add public/danmaku-renderer.js
git commit -m "feat: add Ctrl+Alt+S share modal with QR code and copy links"
```

---

### Task 8: 更新 README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 更新 README 的相关章节**

修改 `README.md` 中的以下内容：

**A. 功能特性** — 在列表末尾添加：
```markdown
- **一键外网分享** — 集成 ngrok 自动生成公网链接，演讲者按 `Ctrl+Alt+S` 弹出二维码
- **移动端适配** — 手机浏览器自动切换为悬浮按钮 + 侧滑抽屉模式
```

**B. 启动** — 替换启动后的输出示例：
```markdown
启动成功后，控制台会输出访问链接：

```
🎯 弹幕服务器已启动

局域网访问：
  演讲者: http://192.168.3.48:3000/speaker
  管理者: http://192.168.3.48:3000/moderator
  观众:   http://192.168.3.48:3000/

外网访问（ngrok）：
  观众:   https://xxx.ngrok-free.app/

快捷键：Ctrl + Alt + S 打开分享弹窗
```

如需外网访问，请先设置 ngrok token：
```bash
# Windows
set NGROK_AUTHTOKEN=your_token_here
node server.js examples/test-deck.html

# macOS / Linux
export NGROK_AUTHTOKEN=your_token_here
node server.js examples/test-deck.html
```

获取 token：https://dashboard.ngrok.com/get-started/your-authtoken
```

**C. 使用流程** — 更新第 3 步：
```markdown
3. **观众** 打开 `/` 链接（根路径，无需后缀），发送弹幕并观看
```

**D. 角色说明 → 观众** — 更新：
```markdown
### 观众（Audience）

- 同屏展示 HTML 幻灯片
- **桌面端**：右侧可折叠侧边栏，弹幕输入 + 8 色颜色选择器
- **手机端**：右下角悬浮按钮，点击后从右侧滑出抽屉面板
- 发送的弹幕需通过审核后显示（有管理者时）
- 访问地址：`/`（根路径，无需后缀）
```

**E. 角色说明 → 演讲者** — 在末尾添加：
```markdown
- 按 `Ctrl + Alt + S` 弹出分享弹窗，显示外网链接、局域网链接和二维码
```

**F. 配置** — 在表格中添加：
```markdown
| 环境变量 | ngrok 认证令牌 | `NGROK_AUTHTOKEN=xxx node server.js ./talk.html` |
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README with ngrok, mobile, and share modal instructions"
```

---

### Task 9: 端到端验证

- [ ] **Step 1: 完整流程验证（设置 NGROK_AUTHTOKEN）**

```bash
set NGROK_AUTHTOKEN=your_token
node server.js examples/test-deck.html
```

验证清单：
- [ ] 控制台正确输出局域网 URL + 外网 URL + 快捷键提示
- [ ] 访问 `/` → 显示观众视图，侧边栏正常
- [ ] 访问 `/audience` → 与 `/` 效果一致
- [ ] 访问 `/speaker` → 底部控制栏正常，按 `Ctrl+Alt+S` 弹出分享弹窗
- [ ] 分享弹窗显示：外网链接、局域网链接、二维码
- [ ] 点击「复制链接」→ 剪贴板有内容，按钮反馈「已复制」
- [ ] DevTools 手机模式 → 观众页面显示 FAB，点击弹出抽屉，可发送弹幕
- [ ] 手机模式访问 `/speaker` → 分享弹窗正常显示（弹窗本身是响应式的）

- [ ] **Step 2: 降级验证（不设置 NGROK_AUTHTOKEN）**

```bash
node server.js examples/test-deck.html
```

验证清单：
- [ ] 控制台提示未设置 token，只显示局域网 URL
- [ ] 分享弹窗只显示局域网链接，不显示外网区域和二维码
- [ ] 所有其他功能正常

- [ ] **Step 3: 运行现有测试套件**

```bash
npm test
```

Expected: 所有现有测试 + 新增测试全部通过

- [ ] **Step 4: Final commit**

```bash
git commit --allow-empty -m "feat: audience experience optimization complete"
```

---

## Self-Review Checklist

### Spec Coverage

| Spec 需求 | 对应 Task | 状态 |
|-----------|-----------|------|
| 根路径 `/` = 观众视图 | Task 3 | ✅ |
| `/audience` 保留兼容 | Task 3 | ✅ |
| 移动端 FAB + 抽屉 | Task 5 + 6 | ✅ |
| ngrok 集成 | Task 4 | ✅ |
| 二维码生成 | Task 4 | ✅ |
| Ctrl+Alt+S 分享弹窗 | Task 7 | ✅ |
| 外网/局域网链接展示 | Task 7 | ✅ |
| 复制链接功能 | Task 7 | ✅ |
| 未设置 token 降级 | Task 4 + 9 | ✅ |
| README 更新 | Task 8 | ✅ |

### Placeholder Scan

- [x] 无 TBD/TODO/"implement later" — 所有步骤包含完整代码
- [x] 无 "add appropriate error handling" 等模糊描述
- [x] 无 "Similar to Task N" 引用

### Type Consistency

- [x] `injectHtml` 函数签名在所有调用处一致（6 个参数）
- [x] `BS_PUBLIC_URL` / `BS_LAN_URL` / `BS_QR_CODE` 全局变量名在所有使用处一致
- [x] `startTunnel` 返回 `string | null`，调用处正确处理

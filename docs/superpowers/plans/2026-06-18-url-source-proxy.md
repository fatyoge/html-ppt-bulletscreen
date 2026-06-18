# URL 源代理（分享本地已运行的 HTML 服务）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `node server.js http://localhost:8787` 能够把本地已运行的 HTML 服务（如 Hermes WebUI）通过反向代理 + 弹幕层注入共享出去，同时保持原有文件模式行为不变。

**Architecture:** 检测 `argv[2]` 是否以 `http(s)://` 开头以区分「URL 模式 / 文件模式」。URL 模式下，bullet-server 成为上游 origin 的透明反向代理：自有路由（`/public`、`/socket.io`、`/speaker`、`/moderator`、`/audience`）优先匹配，其余请求经 `http-proxy` 转发到上游；对 `text/html` 响应做每请求注入（极简弹幕层 + service-worker 屏蔽），角色由 cookie 解析以跨 Hermes 导航保持。公网隧道在 URL 模式默认关闭，需显式 opt-in。

**Tech Stack:** Node.js (>=18)、Express 4、Socket.IO 4、新增依赖 `http-proxy`、Jest（Node 默认环境用于代理集成测试）。

## Global Constraints

- **Node.js >= 18.0.0**（沿用现有要求）。
- 项目坚持**零构建、最小依赖**风格：前端纯原生 JS/CSS，新增依赖仅 `http-proxy`（一个）。
- 文件模式行为**完全不变**：自动公网隧道、完整 slide-sync/anim-sync 注入保持原样。
- 控制台输出、代码标识符、HTTP header 名保持英文；面向用户的中文提示可用中文。
- URL 模式默认**仅局域网**；公网隧道需 `--allow-public` 或 `BS_ALLOW_PUBLIC=1` 才开启，并打印醒目英文警告。
- 极简注入（URL 模式）只注入：`danmaku.css`、`/socket.io/socket.io.js`、`danmaku-renderer.js`、`audience-panel.js`（观众）/`moderator-panel.js`（管理者）、角色/分享配置块、service-worker 屏蔽 shim；**不注入** `slide-sync.js` 与 `anim-sync/*`。
- 现有测试（`html-injector`/`danmaku-store`/`slide-sync`/`speaker-auth`）必须保持绿色。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `lib/speaker-auth.js` | token/cookie 辅助 | 修改：新增 `buildModeratorCookie`、`resolveRole` |
| `lib/html-injector.js` | HTML 注入 | 修改：`injectHtml` 增加第 7 个参数 `options`，支持 `{ minimal: true }` |
| `lib/url-proxy.js` | URL 模式反向代理引擎 + 上游 HTML 抓取 | 新建 |
| `lib/server-app.js` | 把 Express 路由组装成可测试的 `createApp(opts)`（文件/URL 双模式） | 新建 |
| `tests/helpers/mock-upstream.js` | 测试用 mock 上游 HTTP 服务 | 新建 |
| `tests/speaker-auth.test.js` | speaker-auth 单测 | 修改：补充新函数用例 |
| `tests/html-injector.test.js` | 注入单测 | 修改：补充 minimal 模式用例 |
| `tests/url-proxy.test.js` | 代理引擎集成测试 | 新建 |
| `tests/server-app.test.js` | createApp 文件/URL 模式集成测试 | 新建 |
| `server.js` | 入口：argv 解析、组装 app、Socket.IO、ws 升级、隧道、监听 | 修改：改为薄编排层 |
| `package.json` | 依赖 | 修改：加 `http-proxy` |
| `README.md` | 文档 | 修改：URL 模式用法 + 公网安全门 |

**职责边界说明：**
- `lib/url-proxy.js` 只管「把请求转发到上游 + 对 HTML 响应注入」，不关心路由归属、Socket.IO、监听。
- `lib/server-app.js` 只管「给定配置，返回组装好的 Express app（含路由）」，不关心 Socket.IO 事件、ws 升级、隧道。`createApp` 通过一个**可变 `share` 对象**（`{ publicUrl, lanUrl, qrDataUrl }`）在请求时实时读取分享信息，以便隧道解析后再回填。
- `server.js` 只管编排：解析 argv → `createApp` → `http.createServer(app)` → Socket.IO + 现有 socket 事件处理器（原样保留）→ URL 模式 ws 升级 → 隧道（受安全门控制）→ 监听 → 控制台输出。

---

## Task 1: speaker-auth 增加 moderator cookie 与角色解析

**Files:**
- Modify: `lib/speaker-auth.js`
- Test: `tests/speaker-auth.test.js`

**Interfaces:**
- Consumes: 现有 `parseCookie`、`validateToken`。
- Produces:
  - `buildModeratorCookie()` → 返回 `string`（Set-Cookie 头值）。
  - `resolveRole(cookieHeader, speakerToken)` → 返回 `'speaker' | 'moderator' | 'audience'`。规则：`bs_speaker_token` 通过 `validateToken` 校验成功 → `'speaker'`；否则存在 `bs_moderator` cookie → `'moderator'`；否则 `'audience'`。

- [ ] **Step 1: 写失败测试**

在 `tests/speaker-auth.test.js` 末尾 `describe` 块内追加：

```js
  test('buildModeratorCookie returns expected Set-Cookie string', () => {
    expect(buildModeratorCookie()).toBe(
      'bs_moderator=1; HttpOnly; SameSite=Strict; Path=/'
    );
  });

  test('resolveRole returns speaker for valid speaker token cookie', () => {
    const token = generateToken();
    expect(resolveRole(`bs_speaker_token=${token}`, token)).toBe('speaker');
  });

  test('resolveRole returns moderator when only moderator cookie present', () => {
    expect(resolveRole('bs_moderator=1', 'anyStoredToken')).toBe('moderator');
  });

  test('resolveRole returns audience when no role cookies', () => {
    expect(resolveRole('', 'anyStoredToken')).toBe('audience');
    expect(resolveRole(undefined, 'anyStoredToken')).toBe('audience');
  });

  test('resolveRole prefers speaker over moderator', () => {
    const token = generateToken();
    expect(resolveRole(`bs_speaker_token=${token}; bs_moderator=1`, token)).toBe('speaker');
  });

  test('resolveRole returns audience for invalid speaker token', () => {
    expect(resolveRole('bs_speaker_token=wrong', 'realToken')).toBe('audience');
  });
```

并把文件顶部的解构改为同时引入新函数：

```js
const { generateToken, validateToken, parseCookie, buildSpeakerCookie, buildModeratorCookie, resolveRole } = require('../lib/speaker-auth');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest tests/speaker-auth.test.js`
Expected: FAIL —— `buildModeratorCookie is not a function`（或 `resolveRole is not a function`）。

- [ ] **Step 3: 写最小实现**

在 `lib/speaker-auth.js` 的 `buildSpeakerCookie` 之后、`module.exports` 之前追加：

```js
function buildModeratorCookie() {
  return `bs_moderator=1; HttpOnly; SameSite=Strict; Path=/`;
}

function resolveRole(cookieHeader, storedSpeakerToken) {
  const cookies = parseCookie(cookieHeader);
  if (validateToken(cookies.bs_speaker_token, storedSpeakerToken)) {
    return 'speaker';
  }
  if (cookies.bs_moderator) {
    return 'moderator';
  }
  return 'audience';
}
```

并把 `module.exports` 改为：

```js
module.exports = {
  generateToken,
  validateToken,
  parseCookie,
  buildSpeakerCookie,
  buildModeratorCookie,
  resolveRole
};
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx jest tests/speaker-auth.test.js`
Expected: PASS（全部用例，含原有 7 个）。

- [ ] **Step 5: 提交**

```bash
git add lib/speaker-auth.js tests/speaker-auth.test.js
git commit -m "feat(auth): add moderator cookie and cookie-based role resolution"
```

---

## Task 2: html-injector 支持极简模式 + service-worker 屏蔽

**Files:**
- Modify: `lib/html-injector.js`
- Test: `tests/html-injector.test.js`

**Interfaces:**
- Consumes: 无。
- Produces: `injectHtml(originalHtml, role, serverUrl, publicUrl = '', lanUrl = '', qrDataUrl = '', options = {})`。`options.minimal` 为真时：在 `<head>` 开头插入 SW 屏蔽 shim；注入脚本集合改为「极简集」（去掉 `slide-sync.js` 与全部 `anim-sync/*`）。

**极简注入集（minimal=true）**：
1. `<head>` 顶部：SW 屏蔽 shim。
2. `</head>` 前：`/public/danmaku.css`。
3. `</body>` 前的脚本：配置块 + `/socket.io/socket.io.js` + `/public/danmaku-renderer.js` + `/public/audience-panel.js` + `/public/moderator-panel.js`。

**说明（已验证）**：弹幕引导逻辑（创建 socket、按 `BS_ROLE` 分发 panel、演讲者控制栏）全部位于 `danmaku-renderer.js`，不依赖 `slide-sync.js` 或 `anim-sync/*`，因此极简集无需任何桩代码。

- [ ] **Step 1: 写失败测试**

在 `tests/html-injector.test.js` 的 `describe` 块内追加：

```js
  test('minimal mode injects SW shim at the very top of head', () => {
    const result = injectHtml(sampleHtml, 'audience', '', '', '', '', { minimal: true });
    const headOpenIdx = result.indexOf('<head>');
    const shimIdx = result.indexOf('navigator.serviceWorker.register');
    expect(shimIdx).toBeGreaterThan(-1);
    expect(shimIdx).toBeGreaterThan(headOpenIdx);
    // shim 出现在 danmaku.css 之前
    expect(shimIdx).toBeLessThan(result.indexOf('danmaku.css'));
  });

  test('minimal mode includes danmaku core and panels', () => {
    const result = injectHtml(sampleHtml, 'audience', '', '', '', '', { minimal: true });
    expect(result).toContain('/public/danmaku.css');
    expect(result).toContain('/socket.io/socket.io.js');
    expect(result).toContain('/public/danmaku-renderer.js');
    expect(result).toContain('/public/audience-panel.js');
    expect(result).toContain('/public/moderator-panel.js');
  });

  test('minimal mode excludes slide-sync and anim-sync', () => {
    const result = injectHtml(sampleHtml, 'audience', '', '', '', '', { minimal: true });
    expect(result).not.toContain('/public/slide-sync.js');
    expect(result).not.toContain('/public/anim-sync/');
  });

  test('minimal mode injects role config', () => {
    const result = injectHtml(sampleHtml, 'moderator', '', '', '', '', { minimal: true });
    expect(result).toContain("window.BS_ROLE = 'moderator'");
  });

  test('non-minimal mode still injects slide-sync and anim-sync (unchanged)', () => {
    const result = injectHtml(sampleHtml, 'speaker', 'http://localhost:3000');
    expect(result).toContain('/public/slide-sync.js');
    expect(result).toContain('/public/anim-sync/common.js');
    expect(result).not.toContain('navigator.serviceWorker.register');
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest tests/html-injector.test.js`
Expected: FAIL —— 新增 minimal 用例失败（当前实现没有 minimal 分支 / SW shim）。

- [ ] **Step 3: 写最小实现**

将 `lib/html-injector.js` 整体替换为：

```js
const SW_SHIM = `<script>(function(){if(navigator&&navigator.serviceWorker){navigator.serviceWorker.register=function(){return Promise.reject(new Error('disabled by bullet-screen'));};}})();</script>`;

function buildScriptSet(options) {
  const animSyncScripts = `
    <script src="/public/anim-sync/common.js"></script>
    <script src="/public/anim-sync/replay-engine.js"></script>
    <script src="/public/anim-sync/trigger-hook-layer.js"></script>
    <script src="/public/anim-sync/library-adapters.js"></script>
    <script src="/public/anim-sync/declarative-watcher.js"></script>
  `;
  return `
    <script src="/socket.io/socket.io.js"></script>
    <script src="/public/danmaku-renderer.js"></script>
    ${options && options.minimal ? '' : '<script src="/public/slide-sync.js"></script>'}
    <script src="/public/audience-panel.js"></script>
    <script src="/public/moderator-panel.js"></script>
    ${options && options.minimal ? '' : animSyncScripts}
  `;
}

function injectHtml(originalHtml, role, serverUrl, publicUrl = '', lanUrl = '', qrDataUrl = '', options = {}) {
  if (!originalHtml.includes('</head>')) {
    throw new Error('HTML must contain </head>');
  }
  if (!originalHtml.includes('</body>')) {
    throw new Error('HTML must contain </body>');
  }

  const minimal = !!(options && options.minimal);

  let html = originalHtml;
  if (minimal) {
    // SW shim must be the first executable element inside <head>, before upstream inline scripts.
    html = html.replace(/<head[^>]*>/i, (m) => m + '\n' + SW_SHIM);
  }

  const css = `<link rel="stylesheet" href="/public/danmaku.css">`;
  html = html.replace('</head>', css + '\n</head>');

  let configScript = `
    <script>
      window.BS_ROLE = '${role}';
      window.BS_SERVER = '${serverUrl}';`;

  if (role === 'speaker') {
    if (publicUrl) {
      configScript += `\n      window.BS_PUBLIC_URL = '${publicUrl}';`;
    }
    if (lanUrl) {
      configScript += `\n      window.BS_LAN_URL = '${lanUrl}';`;
    }
    if (qrDataUrl) {
      configScript += `\n      window.BS_QR_CODE = '${qrDataUrl}';`;
    }
  }

  configScript += `\n    </script>`;

  const script = configScript + buildScriptSet(options) + '';
  html = html.replace('</body>', script + '\n</body>');

  return html;
}

module.exports = { injectHtml };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx jest tests/html-injector.test.js`
Expected: PASS（含原有 8 个 + 新增 5 个）。

- [ ] **Step 5: 提交**

```bash
git add lib/html-injector.js tests/html-injector.test.js
git commit -m "feat(injector): add minimal injection mode with service-worker shim"
```

---

## Task 3: url-proxy 反向代理引擎

**Files:**
- Create: `lib/url-proxy.js`
- Create: `tests/helpers/mock-upstream.js`
- Test: `tests/url-proxy.test.js`

**Interfaces:**
- Produces:
  - `fetchUpstreamHtml(upstreamOrigin: string): Promise<string>` —— GET 上游 `/`，返回 HTML 文本（请求 `Accept-Encoding: identity`）。
  - `createUrlProxy({ upstreamOrigin, speakerToken, share })` —— 返回 `{ proxy, middleware }`：
    - `proxy`：`httpProxy` 实例（供 server.js 做 ws 升级用）。
    - `middleware(req, res, next)`：Express 中间件，跳过 `/socket.io/`，其余调用 `proxy.web`。对 `text/html` 响应做极简注入（角色由 `resolveRole(req.headers.cookie, speakerToken)` 解析；speaker 角色读 `share.publicUrl/lanUrl/qrDataUrl`）；非 HTML 直通。转发请求时把 `Accept-Encoding` 改为 `identity`；重写响应头里的 `location`（剥离上游 origin）与 `set-cookie`（剥离 `Domain=`）。

- [ ] **Step 1: 安装 http-proxy 依赖**

```bash
npm install http-proxy@^1.18.1
```

确认 `package.json` 的 `dependencies` 中出现 `"http-proxy": "^1.18.1"`。

- [ ] **Step 2: 新建 mock 上游测试夹具**

`tests/helpers/mock-upstream.js`：

```js
const http = require('http');

const ROOT_HTML = `<!doctype html><html><head><title>Up</title></head><body><div id="x">root</div></body></html>`;
const SESSION_HTML = `<!doctype html><html><head><title>Up</title></head><body><div id="x">session</div></body></html>`;

function startMockUpstream() {
  let lastHeaders = {};
  const server = http.createServer((req, res) => {
    lastHeaders = req.headers;
    if (req.url === '/') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      return res.end(ROOT_HTML);
    }
    if (req.url === '/session/abc') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      return res.end(SESSION_HTML);
    }
    if (req.url === '/redir') {
      const port = server.address().port;
      res.setHeader('location', `http://localhost:${port}/session/abc`);
      res.writeHead(302);
      return res.end();
    }
    if (req.url.startsWith('/static/')) {
      res.setHeader('content-type', 'application/javascript');
      return res.end('// asset ' + req.url);
    }
    if (req.url === '/api/ping') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ ok: true }));
    }
    res.writeHead(404);
    res.end('not found');
  });
  return new Promise((resolve) => {
    server.listen(0, () => {
      const origin = 'http://localhost:' + server.address().port;
      resolve({ server, origin, getLastHeaders: () => lastHeaders });
    });
  });
}

function stop(server) {
  return new Promise((r) => server.close(() => r()));
}

function request(origin, path, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(origin + path, { headers: opts.headers || {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
  });
}

module.exports = { startMockUpstream, stop, request };
```

- [ ] **Step 3: 写失败测试**

`tests/url-proxy.test.js`：

```js
const express = require('express');
const http = require('http');
const { generateToken } = require('../lib/speaker-auth');
const { createUrlProxy, fetchUpstreamHtml } = require('../lib/url-proxy');
const { startMockUpstream, stop, request } = require('./helpers/mock-upstream');

function startProxyApp({ upstreamOrigin, speakerToken }) {
  const share = { publicUrl: 'https://pub.example/', lanUrl: 'http://lan.example/', qrDataUrl: '' };
  const { middleware } = createUrlProxy({ upstreamOrigin, speakerToken, share });
  const app = express();
  app.use(middleware);
  const server = app.listen(0);
  const origin = 'http://localhost:' + server.address().port;
  return { server, origin };
}

describe('url-proxy', () => {
  let upstream, proxyApp;

  beforeEach(async () => {
    upstream = await startMockUpstream();
  });
  afterEach(async () => {
    if (proxyApp) await stop(proxyApp.server);
    proxyApp = null;
    await stop(upstream.server);
  });

  test('proxies static asset verbatim (not injected)', async () => {
    proxyApp = startProxyApp({ upstreamOrigin: upstream.origin, speakerToken: 't' });
    const res = await request(proxyApp.origin, '/static/a.js');
    expect(res.headers['content-type']).toContain('javascript');
    expect(res.body).toBe('// asset /static/a.js');
    expect(res.body).not.toContain('danmaku-renderer.js');
  });

  test('proxies JSON API verbatim', async () => {
    proxyApp = startProxyApp({ upstreamOrigin: upstream.origin, speakerToken: 't' });
    const res = await request(proxyApp.origin, '/api/ping');
    expect(res.body).toBe(JSON.stringify({ ok: true }));
  });

  test('injects minimal danmaku layer into HTML (audience by default)', async () => {
    proxyApp = startProxyApp({ upstreamOrigin: upstream.origin, speakerToken: 't' });
    const res = await request(proxyApp.origin, '/');
    expect(res.body).toContain("window.BS_ROLE = 'audience'");
    expect(res.body).toContain('/public/danmaku-renderer.js');
    expect(res.body).toContain('navigator.serviceWorker.register');
    expect(res.body).not.toContain('/public/slide-sync.js');
    expect(res.body).not.toContain('/public/anim-sync/');
    expect(parseInt(res.headers['content-length'], 10)).toBe(Buffer.byteLength(res.body, 'utf8'));
  });

  test('resolves speaker role from cookie and injects share vars', async () => {
    const token = generateToken();
    proxyApp = startProxyApp({ upstreamOrigin: upstream.origin, speakerToken: token });
    const res = await request(proxyApp.origin, '/', { headers: { Cookie: `bs_speaker_token=${token}` } });
    expect(res.body).toContain("window.BS_ROLE = 'speaker'");
    expect(res.body).toContain("window.BS_PUBLIC_URL = 'https://pub.example/'");
  });

  test('resolves moderator role from cookie', async () => {
    proxyApp = startProxyApp({ upstreamOrigin: upstream.origin, speakerToken: 't' });
    const res = await request(proxyApp.origin, '/', { headers: { Cookie: 'bs_moderator=1' } });
    expect(res.body).toContain("window.BS_ROLE = 'moderator'");
  });

  test('forwards Accept-Encoding: identity to upstream', async () => {
    proxyApp = startProxyApp({ upstreamOrigin: upstream.origin, speakerToken: 't' });
    await request(proxyApp.origin, '/');
    expect(upstream.getLastHeaders()['accept-encoding']).toBe('identity');
  });

  test('rewrites absolute upstream Location to a relative path', async () => {
    proxyApp = startProxyApp({ upstreamOrigin: upstream.origin, speakerToken: 't' });
    const res = await request(proxyApp.origin, '/redir');
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/session/abc');
  });

  test('fetchUpstreamHtml returns the upstream root HTML', async () => {
    const html = await fetchUpstreamHtml(upstream.origin);
    expect(html).toContain('<div id="x">root</div>');
  });
});
```

- [ ] **Step 4: 运行测试确认失败**

Run: `npx jest tests/url-proxy.test.js`
Expected: FAIL —— `Cannot find module '../lib/url-proxy'`。

- [ ] **Step 5: 写实现**

`lib/url-proxy.js`：

```js
const http = require('http');
const https = require('https');
const httpProxy = require('http-proxy');
const { injectHtml } = require('./html-injector');
const { resolveRole } = require('./speaker-auth');

function fetchUpstreamHtml(upstreamOrigin) {
  const lib = upstreamOrigin.startsWith('https://') ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.get(upstreamOrigin + '/', {
      headers: { Accept: 'text/html', 'Accept-Encoding': 'identity' }
    }, (upRes) => {
      const chunks = [];
      upRes.on('data', (c) => chunks.push(c));
      upRes.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('upstream timeout')));
  });
}

function stripOrigin(value, upstreamOrigin) {
  if (typeof value !== 'string') return value;
  if (value.toLowerCase().startsWith(upstreamOrigin.toLowerCase())) {
    return value.slice(upstreamOrigin.length) || '/';
  }
  return value;
}

function rewriteResponseHeaders(headers, upstreamOrigin) {
  const h = { ...headers };
  delete h['content-length'];
  delete h['content-encoding'];
  delete h['transfer-encoding'];
  if (h['location']) {
    h['location'] = stripOrigin(h['location'], upstreamOrigin);
  }
  if (h['set-cookie']) {
    const list = Array.isArray(h['set-cookie']) ? h['set-cookie'] : [h['set-cookie']];
    h['set-cookie'] = list.map((c) => c.replace(/;\s*Domain=[^;]*/gi, ''));
  }
  return h;
}

function handleProxyRes(proxyRes, req, res, ctx) {
  const contentType = proxyRes.headers['content-type'] || '';

  // Non-HTML: pass through untouched (headers + body).
  if (!contentType.includes('text/html')) {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
    return;
  }

  // HTML: buffer, inject, respond with corrected length.
  const chunks = [];
  proxyRes.on('data', (c) => chunks.push(c));
  proxyRes.on('error', () => { try { res.end(); } catch (_) { /* noop */ } });
  proxyRes.on('end', () => {
    let body;
    try {
      body = Buffer.concat(chunks).toString('utf8');
    } catch (_) {
      if (!res.headersSent) res.writeHead(502);
      return res.end('Decode failed');
    }
    const role = resolveRole(req.headers.cookie, ctx.speakerToken);
    const isSpeaker = role === 'speaker';
    const injected = injectHtml(
      body,
      role,
      '',
      isSpeaker ? ctx.share.publicUrl : '',
      isSpeaker ? ctx.share.lanUrl : '',
      isSpeaker ? ctx.share.qrDataUrl : '',
      { minimal: true }
    );
    const buf = Buffer.from(injected, 'utf8');
    const headers = rewriteResponseHeaders(proxyRes.headers, ctx.upstreamOrigin);
    headers['content-length'] = String(buf.length);
    res.writeHead(proxyRes.statusCode, headers);
    res.end(buf);
  });
}

function createUrlProxy({ upstreamOrigin, speakerToken, share }) {
  const proxy = httpProxy.createProxyServer({
    target: upstreamOrigin,
    ws: true,
    selfHandleResponse: true,
    changeOrigin: true,
    autoRewrite: true
  });

  const ctx = { upstreamOrigin, speakerToken, share };

  proxy.on('proxyReq', (proxyReq) => {
    proxyReq.setHeader('Accept-Encoding', 'identity');
  });

  proxy.on('proxyRes', (proxyRes, req, res) => {
    handleProxyRes(proxyRes, req, res, ctx);
  });

  proxy.on('error', (err, req, res) => {
    if (res && !res.headersSent) {
      res.writeHead(502);
    }
    if (res && typeof res.end === 'function') {
      res.end('Upstream error');
    }
  });

  const middleware = (req, res, next) => {
    // Socket.IO owns its own path on the http server; never proxy it.
    if (req.url.startsWith('/socket.io/')) {
      return next();
    }
    proxy.web(req, res, {}, (err) => next(err));
  };

  return { proxy, middleware };
}

module.exports = { fetchUpstreamHtml, createUrlProxy };
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npx jest tests/url-proxy.test.js`
Expected: PASS（8 个用例）。

- [ ] **Step 7: 提交**

```bash
git add lib/url-proxy.js tests/url-proxy.test.js tests/helpers/mock-upstream.js package.json package-lock.json
git commit -m "feat(url-proxy): transparent reverse proxy engine with HTML injection"
```

---

## Task 4: server-app 把路由组装为可测试的 createApp

**Files:**
- Create: `lib/server-app.js`
- Test: `tests/server-app.test.js`

**Interfaces:**
- Consumes: `injectHtml`、`parseCookie/validateToken/buildSpeakerCookie/buildModeratorCookie`、`fetchUpstreamHtml/createUrlProxy`。
- Produces: `createApp(opts)` → Express `app`。
  - `opts = { mode: 'file' | 'url', originalHtml, upstreamOrigin, speakerToken, share }`。
  - `share = { publicUrl: '', lanUrl: '', qrDataUrl: '' }`（**可变对象**，由 server.js 在隧道解析后回填；路由在请求时实时读取）。
  - 两模式都挂载 `/public` 静态；文件模式保持与现状一致的四条路由；URL 模式挂载 `/speaker`、`/moderator`、`/audience` 入口路由（fetch 上游根 + 注入对应角色 + 设置 cookie），其后挂载 catch-all 代理中间件。

- [ ] **Step 1: 写失败测试**

`tests/server-app.test.js`：

```js
const http = require('http');
const { generateToken } = require('../lib/speaker-auth');
const { createApp } = require('../lib/server-app');
const { startMockUpstream, stop, request } = require('./helpers/mock-upstream');

function serve(app) {
  const server = http.createServer(app).listen(0);
  return { server, origin: 'http://localhost:' + server.address().port };
}

const sampleHtml = '<!doctype html><html><head><title>F</title></head><body><div class="deck"></div></body></html>';

describe('createApp file mode', () => {
  let app, httpSrv;
  afterEach(() => { if (httpSrv) return stop(httpSrv); });

  test('serves injected audience HTML at /', async () => {
    app = createApp({ mode: 'file', originalHtml: sampleHtml, speakerToken: 't', share: {} });
    httpSrv = serve(app);
    const res = await request(httpSrv.origin, '/');
    expect(res.body).toContain("window.BS_ROLE = 'audience'");
    expect(res.body).toContain('/public/slide-sync.js'); // file mode = full injection
  });

  test('/speaker without token redirects to /', async () => {
    app = createApp({ mode: 'file', originalHtml: sampleHtml, speakerToken: 't', share: {} });
    httpSrv = serve(app);
    const res = await request(httpSrv.origin, '/speaker');
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/');
  });

  test('/speaker?token sets cookie then serves speaker HTML', async () => {
    const token = generateToken();
    app = createApp({ mode: 'file', originalHtml: sampleHtml, speakerToken: token, share: { publicUrl: 'https://pub/' } });
    httpSrv = serve(app);
    const r1 = await request(httpSrv.origin, '/speaker?token=' + token);
    expect(r1.statusCode).toBe(302);
    expect(r1.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('bs_speaker_token=' + token)])
    );
    const r2 = await request(httpSrv.origin, '/speaker', { headers: { Cookie: 'bs_speaker_token=' + token } });
    expect(r2.body).toContain("window.BS_ROLE = 'speaker'");
    expect(r2.body).toContain("window.BS_PUBLIC_URL = 'https://pub/'");
  });
});

describe('createApp url mode', () => {
  let upstream, app, httpSrv;
  beforeEach(async () => { upstream = await startMockUpstream(); });
  afterEach(async () => { if (httpSrv) await stop(httpSrv); httpSrv = null; await stop(upstream.server); });

  test('/speaker entry sets cookie (valid token) and redirects', async () => {
    const token = generateToken();
    app = createApp({ mode: 'url', upstreamOrigin: upstream.origin, speakerToken: token, share: {} });
    httpSrv = serve(app);
    const res = await request(httpSrv.origin, '/speaker?token=' + token);
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/speaker');
    expect(res.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('bs_speaker_token=' + token)])
    );
  });

  test('/speaker entry with cookie serves upstream HTML + minimal speaker injection', async () => {
    const token = generateToken();
    app = createApp({ mode: 'url', upstreamOrigin: upstream.origin, speakerToken: token, share: { publicUrl: 'https://pub/' } });
    httpSrv = serve(app);
    const res = await request(httpSrv.origin, '/speaker', { headers: { Cookie: 'bs_speaker_token=' + token } });
    expect(res.body).toContain("window.BS_ROLE = 'speaker'");
    expect(res.body).toContain('/public/danmaku-renderer.js');
    expect(res.body).not.toContain('/public/slide-sync.js');
  });

  test('/moderator entry sets moderator cookie and injects moderator role', async () => {
    app = createApp({ mode: 'url', upstreamOrigin: upstream.origin, speakerToken: 't', share: {} });
    httpSrv = serve(app);
    const res = await request(httpSrv.origin, '/moderator');
    expect(res.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('bs_moderator=1')])
    );
    expect(res.body).toContain("window.BS_ROLE = 'moderator'");
  });

  test('catch-all proxies upstream /static and /api verbatim', async () => {
    app = createApp({ mode: 'url', upstreamOrigin: upstream.origin, speakerToken: 't', share: {} });
    httpSrv = serve(app);
    const js = await request(httpSrv.origin, '/static/a.js');
    expect(js.body).toBe('// asset /static/a.js');
    const api = await request(httpSrv.origin, '/api/ping');
    expect(api.body).toBe(JSON.stringify({ ok: true }));
  });

  test('catch-all injects audience role on proxied HTML by default', async () => {
    app = createApp({ mode: 'url', upstreamOrigin: upstream.origin, speakerToken: 't', share: {} });
    httpSrv = serve(app);
    const res = await request(httpSrv.origin, '/session/abc');
    expect(res.body).toContain("window.BS_ROLE = 'audience'");
    expect(res.body).toContain('session'); // upstream body preserved
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest tests/server-app.test.js`
Expected: FAIL —— `Cannot find module '../lib/server-app'`。

- [ ] **Step 3: 写实现**

`lib/server-app.js`：

```js
const express = require('express');
const path = require('path');
const { injectHtml } = require('./html-injector');
const {
  parseCookie,
  validateToken,
  buildSpeakerCookie,
  buildModeratorCookie
} = require('./speaker-auth');
const { fetchUpstreamHtml, createUrlProxy } = require('./url-proxy');

function createApp(opts) {
  const {
    mode,
    originalHtml,
    upstreamOrigin,
    speakerToken,
    share = { publicUrl: '', lanUrl: '', qrDataUrl: '' }
  } = opts;

  const app = express();
  app.use('/public', express.static(path.join(__dirname, '..', 'public')));

  if (mode === 'url') {
    // --- Entry routes: fetch upstream root + inject role + set cookie ---
    app.get('/speaker', async (req, res) => {
      const queryToken = req.query.token;
      const cookies = parseCookie(req.headers.cookie);
      const cookieToken = cookies.bs_speaker_token;

      if (validateToken(queryToken, speakerToken)) {
        res.setHeader('Set-Cookie', buildSpeakerCookie(queryToken));
        return res.redirect('/speaker');
      }
      if (!validateToken(cookieToken, speakerToken)) {
        return res.redirect('/');
      }
      try {
        const html = await fetchUpstreamHtml(upstreamOrigin);
        res.send(injectHtml(html, 'speaker', '', share.publicUrl, share.lanUrl, share.qrDataUrl, { minimal: true }));
      } catch (_) {
        res.status(502).send('Upstream fetch failed');
      }
    });

    app.get('/moderator', async (req, res) => {
      res.setHeader('Set-Cookie', buildModeratorCookie());
      try {
        const html = await fetchUpstreamHtml(upstreamOrigin);
        res.send(injectHtml(html, 'moderator', '', '', '', '', { minimal: true }));
      } catch (_) {
        res.status(502).send('Upstream fetch failed');
      }
    });

    app.get('/audience', async (req, res) => {
      try {
        const html = await fetchUpstreamHtml(upstreamOrigin);
        res.send(injectHtml(html, 'audience', '', '', '', '', { minimal: true }));
      } catch (_) {
        res.status(502).send('Upstream fetch failed');
      }
    });

    // --- Catch-all reverse proxy (everything not matched above) ---
    const { middleware } = createUrlProxy({ upstreamOrigin, speakerToken, share });
    app.use(middleware);
  } else {
    // --- File mode: identical to pre-existing behavior ---
    app.get('/', (req, res) => {
      res.send(injectHtml(originalHtml, 'audience', ''));
    });

    app.get('/speaker', (req, res) => {
      const queryToken = req.query.token;
      const cookies = parseCookie(req.headers.cookie);
      const cookieToken = cookies.bs_speaker_token;

      if (validateToken(queryToken, speakerToken)) {
        res.setHeader('Set-Cookie', buildSpeakerCookie(queryToken));
        return res.redirect('/speaker');
      }
      if (!validateToken(cookieToken, speakerToken)) {
        return res.redirect('/');
      }
      res.send(injectHtml(originalHtml, 'speaker', '', share.publicUrl, share.lanUrl, share.qrDataUrl));
    });

    app.get('/audience', (req, res) => {
      res.send(injectHtml(originalHtml, 'audience', ''));
    });

    app.get('/moderator', (req, res) => {
      res.send(injectHtml(originalHtml, 'moderator', ''));
    });
  }

  return app;
}

module.exports = { createApp };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx jest tests/server-app.test.js`
Expected: PASS（8 个用例）。

- [ ] **Step 5: 跑全量测试确认无回归**

Run: `npx jest`
Expected: 全部 PASS（原有套件 + 新增）。

- [ ] **Step 6: 提交**

```bash
git add lib/server-app.js tests/server-app.test.js
git commit -m "feat(server-app): testable createApp for file and url modes"
```

---

## Task 5: server.js 接线（argv 解析、ws 升级、公网安全门、控制台）

**Files:**
- Modify: `server.js`

**Interfaces:**
- Consumes: `createApp`、现有 Socket.IO 事件处理逻辑（原样保留）、`checkCloudflaredInstalled/startCloudflareTunnel`（保留）。
- 说明：现有 `io.on('connection', …)` 整块（当前 `server.js` 第 95–261 行）**原样保留，不做改动**。本任务只改「入口编排」部分。

- [ ] **Step 1: 重写 server.js 入口编排（保留 io 事件块）**

将 `server.js` 顶部（从开头到 `const store = new DanmakuStore();` 之前，即当前第 1–28 行 + 模块常量）以及文件末尾（`const PORT = ...` 到结尾，即当前第 263–341 行）替换为下面的结构。**中间的 `io.on('connection', …)` 块保持不变。**

新的 `server.js` 顶部：

```js
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const { spawn } = require('child_process');
const QRCode = require('qrcode');
const { createApp } = require('./lib/server-app');
const { DanmakuStore } = require('./lib/danmaku-store');
const { SlideSync } = require('./lib/slide-sync');
const { generateToken } = require('./lib/speaker-auth');

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
```

紧接其后**原样保留**当前的 `io.on('connection', (socket) => { ... });` 整块（含 `DanmakuStore`/`SlideSync` 实例化与所有 socket 事件）。注意：`const store = new DanmakuStore(); const slideSync = new SlideSync();` 这两行原本在 io 块之前，保留其位置（在新的顶部块之后、io 块之前即可）。

新的 `server.js` 末尾（替换原 `const PORT = ...` 到结尾）：

```js
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
```

同时，在 `httpServer.listen` 之前（io 块之后、`const PORT` 之前）加入 URL 模式的 WebSocket 升级转发。需要一个对代理实例的引用——为此把 `createUrlProxy` 的 `proxy` 暴露出来。修改 `lib/server-app.js`：在 URL 模式分支中，把 `app` 上的代理实例挂到 `app.locals`，便于 server.js 取用。

在 `lib/server-app.js` 的 URL 模式分支中，将：

```js
    const { middleware } = createUrlProxy({ upstreamOrigin, speakerToken, share });
    app.use(middleware);
```

改为：

```js
    const urlProxy = createUrlProxy({ upstreamOrigin, speakerToken, share });
    app.locals.urlProxy = urlProxy.proxy;
    app.use(urlProxy.middleware);
```

然后在 `server.js` 的 `const io = new Server(httpServer);` 之后、`io.on('connection', ...)` 块之后、`const PORT` 之前，加入：

```js
// URL mode: forward non-Socket.IO WebSocket upgrades (e.g. xterm terminal) to upstream.
if (isUrlMode && app.locals.urlProxy) {
  const upstreamProxy = app.locals.urlProxy;
  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url && req.url.startsWith('/socket.io/')) {
      return; // Socket.IO handles its own upgrades.
    }
    upstreamProxy.ws(req, socket, head);
  });
}
```

- [ ] **Step 2: 跑全量测试**

Run: `npx jest`
Expected: 全部 PASS（接线改动不破坏 createApp 单测）。

- [ ] **Step 3: 文件模式冒烟（回归）**

Run（文件模式，预期行为不变）：
```bash
node server.js examples/html-ppt-test.html &
SERVER_PID=$!
sleep 2
curl -s http://localhost:3000/ | grep -c "danmaku-renderer.js"   # 预期: 1
curl -s http://localhost:3000/ | grep -c "slide-sync.js"         # 预期: 1（文件模式仍注入 slide-sync）
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/speaker  # 预期: 302
kill $SERVER_PID
```
Expected: 文件模式行为与改动前一致（`/` 含 danmaku + slide-sync；`/speaker` 无 token 返回 302）。

- [ ] **Step 4: URL 模式冒烟（需 Hermes 运行在 :8787）**

前置：确保 `http://localhost:8787/` 可访问（Hermes WebUI 已启动）。

Run：
```bash
node server.js http://localhost:8787 &
SERVER_PID=$!
sleep 2
# 观众根路径：上游 Hermes HTML + 极简注入
curl -s http://localhost:3000/ | grep -c "danmaku-renderer.js"   # 预期: 1
curl -s http://localhost:3000/ | grep -c "slide-sync.js"         # 预期: 0（极简注入不注入 slide-sync）
curl -s http://localhost:3000/ | grep -c "navigator.serviceWorker.register"  # 预期: 1（SW shim）
# 上游静态资源与 API 透传
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/static/style.css  # 预期: 200
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/sessions      # 预期: 200
# 默认无公网隧道（URL 模式）
# 控制台应出现：外网访问：已关闭（URL 模式默认仅局域网...）
kill $SERVER_PID
```

Expected: 极简注入生效（有 danmaku、有 SW shim、无 slide-sync）；上游静态资源与 API 200 透传；控制台提示公网默认关闭。

- [ ] **Step 5: URL 模式公网门冒烟（可选，需 cloudflared）**

Run：
```bash
BS_ALLOW_PUBLIC=1 node server.js http://localhost:8787 &
SERVER_PID=$!
sleep 6
# 控制台应出现外网 trycloudflare 链接，并紧跟 WARNING 行
kill $SERVER_PID
```
Expected: 出现公网链接 + `⚠️ WARNING` 提示。

- [ ] **Step 6: 提交**

```bash
git add server.js lib/server-app.js
git commit -m "feat(server): wire url mode (argv, ws upgrade, public-opt-in gate, console)"
```

---

## Task 6: README 文档更新

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 在「快速开始 > 启动」一节后追加 URL 模式小节**

在 `README.md` 现有「启动」示例之后插入：

```markdown
### 共享本地已运行的 HTML 服务（URL 模式）

除了传入 HTML 文件，也可以直接把一个**已经在本地运行的 HTML 服务**通过弹幕服务器共享出去：

```bash
# Hermes WebUI 已运行在 :8787
node server.js http://localhost:8787
```

此时弹幕服务器会成为上游服务的**透明反向代理**：

- 观众打开 `http://<弹幕服务器>/`（或具体会话路径，如 `/session/<id>`）即可看到上游页面 + 弹幕层。
- 演讲者入口 `/speaker?token=…`、管理者 `/moderator`、观众 `/` 与文件模式一致。
- 上游的静态资源、API、WebSocket（如终端）自动透传；角色由 cookie 跨页保持。

> ⚠️ **安全提示**：URL 模式默认**仅局域网**开放。因为上游可能是带终端的可交互应用，
> 公网隧道会让任何拿到链接的人都能操作它（RCE 级风险）。如需公网访问，需显式开启：
>
> ```bash
> node server.js http://localhost:8787 --allow-public
> # 或
> BS_ALLOW_PUBLIC=1 node server.js http://localhost:8787
> ```
>
> 开启后控制台会打印醒目 WARNING，建议演示结束后立即关闭。文件模式行为不变（照旧自动尝试公网隧道）。
```

- [ ] **Step 2: 在「配置」表格中追加 URL 模式相关项**

把「配置」一节的表格更新为：

```markdown
| 方式 | 说明 | 示例 |
|------|------|------|
| 命令行参数 | HTML 文件路径 | `node server.js ./talk.html` |
| 命令行参数 | 上游 origin（URL 模式） | `node server.js http://localhost:8787` |
| 命令行 flag | URL 模式开启公网隧道 | `node server.js http://localhost:8787 --allow-public` |
| 环境变量 | URL 模式开启公网隧道 | `BS_ALLOW_PUBLIC=1 node server.js http://localhost:8787` |
| 环境变量 | 服务端口号 | `PORT=8080 node server.js ./talk.html` |
```

- [ ] **Step 3: 提交**

```bash
git add README.md
git commit -m "docs: document URL source mode and public-sharing security gate"
```

---

## Self-Review（计划作者自检，已对照规范）

**1. 规范覆盖：**
- 模式检测 + CLI（origin-only）→ Task 5（argv 解析）+ Task 4（createApp mode）。✅
- 路由优先级表 → Task 4（`/public` 静态、入口路由、catch-all 代理；`/socket.io` 由 io 接管 + 代理跳过）。✅
- 反向代理机制（http-proxy、剥 Accept-Encoding、location/cookie 重写、WS 升级）→ Task 3（引擎）+ Task 5（ws 接线）。✅
- 每请求抓取注入 → Task 3 `handleProxyRes` + Task 4 入口路由 `fetchUpstreamHtml`。✅
- 角色 cookie 化（speaker/moderator/audience，跨导航保持）→ Task 1 `resolveRole` + Task 3/4 注入时解析。✅
- `<base>` 保留 → 注入逻辑不动 `<base>`（`injectHtml` 只动 `</head>`/`</body>` 与 `<head>` 开头 shim）。✅
- 极简注入 + SW shim → Task 2。✅（已验证 danmaku-renderer 自包含，无需桩）
- 公网安全门（默认 LAN、opt-in + 警告）→ Task 5 `allowPublic` + 控制台输出。✅
- 共享/隧道透明 → Task 5（隧道指向 bullet-server，share 回填）。✅
- 测试（mock 上游 + 角色解析单测）→ Task 1/2/3/4。✅
- 风险记录（会话共享实时性依赖 Hermes、终端 WS、压缩权衡）→ 已在规范；Task 5 冒烟覆盖终端 WS 的路径转发（实际终端需手动验）。

**2. 占位符扫描：** 无 TBD/TODO；每个代码步骤均含完整可执行代码与命令。✅

**3. 类型/命名一致性：** `buildModeratorCookie`、`resolveRole(cookieHeader, speakerToken)`、`createUrlProxy({ upstreamOrigin, speakerToken, share })`、`fetchUpstreamHtml(upstreamOrigin)`、`createApp({ mode, originalHtml, upstreamOrigin, speakerToken, share })`、`injectHtml(..., options={})`、`app.locals.urlProxy` 在各 Task 间签名一致。`share` 始终为 `{ publicUrl, lanUrl, qrDataUrl }` 可变对象。✅

**4. 残留风险（实现期注意，非计划缺陷）：**
- `http-proxy` 的 `selfHandleResponse: true` 依赖其跳过默认管道的行为；Task 3 的集成测试会验证，若该版本行为异常，回退方案是在 `proxyRes` 中自行 `proxyRes.pause()`+消费（已被测试覆盖，失败即暴露）。
- 真实 Hermes 的「同会话多端实时性」与终端 WS 实际端到端连通需 Task 5 Step 4/5 之外的手动最终验证（在两个代理客户端打开同一 `/session/<id>` 观察）。

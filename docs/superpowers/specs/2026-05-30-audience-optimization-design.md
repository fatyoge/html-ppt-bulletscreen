# 观众体验优化设计文档

## 概述

基于 `raw/idea_20260530.md` 的三项需求，对弹幕服务器进行观众体验优化：简化访问路径、支持手机浏览器、提供互联网访问能力。

## 需求

1. **观众访问简化**：观众只需访问根路径 `/`，无需记忆后缀 `/audience`
2. **手机浏览器支持**：观众面板在手机上可用，不依赖桌面端侧边栏布局
3. **互联网访问**：演讲者开播时自动生成外网链接 + 二维码，手机观众扫码即可进入

## 非目标

- 不改变现有演讲者和管理者的工作流程
- 不改变弹幕审核、幻灯片同步等核心逻辑
- 不引入前端框架（保持零构建依赖）

## 技术栈变更

| 依赖 | 用途 | 版本 |
|------|------|------|
| `@ngrok/ngrok` | 内网穿透，生成公网访问链接 | ^1.4.0 |
| `qrcode` | 服务端生成二维码 data URL | ^1.5.4 |

## 详细设计

### 1. 路由变更

新增根路径 `/` 作为观众入口，现有路由保留兼容。

```javascript
// server.js
app.get('/', (req, res) => {
  const html = injectHtml(originalHtml, 'audience', '');
  res.send(html);
});

app.get('/speaker', (req, res) => { ... });   // 不变
app.get('/audience', (req, res) => { ... });  // 保留兼容
app.get('/moderator', (req, res) => { ... }); // 不变
```

- `/` — 观众视图（新增）
- `/audience` — 观众视图（保留兼容，避免破坏现有书签）
- `/speaker` — 演讲者视图（不变）
- `/moderator` — 管理者视图（不变）

### 2. 移动端观众面板

桌面端保持现有 280px 右侧侧边栏不变。通过 CSS 媒体查询（`max-width: 768px`）检测手机端，切换为悬浮按钮 + 右侧抽屉模式。

**桌面端（≥768px）**：
```
+------------------------+---------------+
|                        |  文本输入框   |
|  HTML 幻灯片           |  [发送]       |
|                        |  颜色选择     |
|  <- 弹幕飘过 ->        |  o o o o      |
|                        |               |
+------------------------+---------------+
```

**移动端（<768px）**：
```
┌────────────────────────┐
│                        │
│  HTML 幻灯片           │
│                        │
│  <- 弹幕飘过 ->        │
│                        │
│                    [+] │  ← FAB（右下）
└────────────────────────┘

点击 FAB 后从右侧滑出抽屉：
┌─────────────────────┬──┐
│                     │文│
│  HTML 幻灯片        │本│
│  （半透明遮罩）     │输│
│                     │入│
│  <- 弹幕飘过 ->     │框│
│                     │[发│
│                     │色│
│                     └──┘
└────────────────────────┘
```

**实现要点**：
- 隐藏桌面端 `#side-panel`，显示 `#mobile-fab` 和 `#mobile-drawer`
- FAB：固定定位右下角，56px 圆形，主色调
- 抽屉：宽度 80vw（最大 320px），从右侧滑入，`transform: translateX(100%) → 0`
- 点击 FAB 打开抽屉，点击遮罩层或抽屉内关闭按钮关闭
- 复用现有输入框、颜色选择器、发送逻辑，仅容器布局不同

### 3. ngrok 内网穿透集成

**启动流程**：

```
启动 server → 监听本地端口
                  ↓
       检查 NGROK_AUTHTOKEN 环境变量
                  ↓
       存在: 调用 ngrok.connect({ addr: PORT })
       不存在: 跳过，仅局域网模式
                  ↓
       成功: 获得 https://xxx.ngrok-free.app
       失败: 控制台报错，仅局域网模式
                  ↓
       将外网 URL 和局域网 URL 注入演讲者页面
       生成二维码（指向根路径 `/`）
       控制台输出所有可用链接
```

**代码示意**：

```javascript
const ngrok = require('@ngrok/ngrok');
const QRCode = require('qrcode');

async function setupTunnel(port) {
  const token = process.env.NGROK_AUTHTOKEN;
  if (!token) {
    console.log('\n⚠️ 未设置 NGROK_AUTHTOKEN，仅提供局域网访问');
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

### 4. 分享弹窗

**交互**：
- 快捷键 `Ctrl + Alt + S` 呼出/关闭
- 弹窗出现时拦截背景键盘事件（防止翻页）
- 点击遮罩层或按 `Esc` 关闭

**弹窗内容**：

```
┌──────────────────────────────────────┐
│  分享演示  [✕]                        │
├──────────────────────────────────────┤
│                                      │
│  📱 手机观众请扫码                    │
│                                      │
│  ┌────────────┐                     │
│  │  二维码     │  ← 指向外网/局域网   │
│  │  (qrcode)   │     根路径 `/`      │
│  └────────────┘                     │
│                                      │
│  🔗 外网: https://xxx.ngrok.app/     │
│     [复制链接]                        │
│                                      │
│  🏠 局域网: http://192.168.1.x:3000/ │
│     [复制链接]                        │
│                                      │
└──────────────────────────────────────┘
```

**实现要点**：
- 外网链接通过 `window.BS_PUBLIC_URL` 全局变量传入
- 局域网链接通过 `window.BS_LAN_URL` 全局变量传入
- 二维码在服务端用 `qrcode.toDataURL()` 生成 base64 图片，通过注入脚本传入
- 复制功能使用 Clipboard API，fallback 到 `document.execCommand('copy')`

### 5. HTML 注入变更

`lib/html-injector.js` 新增注入变量：

```javascript
function injectHtml(originalHtml, role, serverUrl, publicUrl, lanUrl) {
  // ... 原有注入逻辑 ...
  const script = `
    <script>
      window.BS_ROLE = '${role}';
      window.BS_SERVER = '${serverUrl}';
      window.BS_PUBLIC_URL = '${publicUrl || ''}';
      window.BS_LAN_URL = '${lanUrl}';
      window.BS_QR_CODE = '${qrDataUrl || ''}';
    </script>
  `;
  // ...
}
```

仅 `role === 'speaker'` 时注入 `BS_PUBLIC_URL`、`BS_LAN_URL`、`BS_QR_CODE`。

### 6. 控制台输出

启动成功后，控制台输出格式：

```
🎯 弹幕服务器已启动

局域网访问：
  演讲者: http://192.168.1.x:3000/speaker
  管理者: http://192.168.1.x:3000/moderator
  观众:   http://192.168.1.x:3000/

外网访问（ngrok）：
  观众:   https://xxx.ngrok-free.app/

快捷键：Ctrl + Alt + S 打开分享弹窗
```

## 错误处理

| 场景 | 处理 |
|------|------|
| 未设置 `NGROK_AUTHTOKEN` | 控制台红色提示获取方式；分享弹窗不显示外网区域 |
| ngrok 连接失败 | 控制台报错；分享弹窗外网区域显示「连接失败，请检查网络或 token」 |
| ngrok 隧道中途断开 | 弹幕服务不受影响（Socket.IO 走本地端口）；分享弹窗外网区域变灰提示 |
| 二维码生成失败 | 弹窗中不显示二维码，仅显示文字链接 |
| 复制链接失败 | Clipboard API → execCommand fallback → 提示手动复制 |
| 多网卡环境 | 遍历取第一个非 internal IPv4，弹窗中只展示一个 |

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `package.json` | 修改 | 新增 `@ngrok/ngrok`、`qrcode` 依赖 |
| `server.js` | 修改 | 新增根路径路由、ngrok 隧道初始化、注入变量扩展 |
| `lib/html-injector.js` | 修改 | 新增 `publicUrl`、`lanUrl`、`qrDataUrl` 注入参数 |
| `public/danmaku.css` | 修改 | 新增移动端媒体查询（FAB + 抽屉样式） |
| `public/audience-panel.js` | 修改 | 新增移动端 FAB + 抽屉初始化逻辑 |
| `public/speaker-controls.js` | 修改 | 新增 `Ctrl+Alt+S` 分享弹窗、二维码展示、复制功能 |
| `README.md` | 修改 | 补充 ngrok 配置说明、移动端使用说明 |

## 未来考虑（超出范围）

- ngrok 自定义子域名（需付费）
- 多局域网 IP 选择（当前取第一个）
- 分享弹窗自定义快捷键

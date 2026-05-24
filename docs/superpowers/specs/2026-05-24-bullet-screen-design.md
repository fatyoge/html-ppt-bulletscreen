# 弹幕服务器设计文档

## 概述

一个本地 Node.js 服务端，用于在 html-ppt 演示文稿上展示实时弹幕（子弹评论）。三种角色：**演讲者**（演示 + 控制）、**管理者**（审核与拦截）、**观众**（观看 + 发送）。

## 目标

- 允许观众在 html-ppt 演示期间发送弹幕
- 在所有连接的客户端之间同步幻灯片导航
- 支持管理者审核：默认自动通过，有管理者时手动拦截
- 零构建步骤，零前端框架依赖

## 非目标

- 弹幕历史记录的持久化存储
- 支持非 html-ppt 的 HTML 文件
- 用户认证或身份系统
- 移动端优化的 UI

## 技术栈

- **运行时**: Node.js
- **HTTP 服务器**: Express
- **实时通信**: Socket.IO
- **前端**: 原生 JavaScript (IIFE), CSS
- **HTML 处理**: 字符串注入（不解析 DOM）

## 架构

### 服务端组件

| 组件 | 文件 | 职责 |
|-----------|------|----------------|
| HTTP 服务器 | `server.js` | Express 应用、路由处理、静态文件服务 |
| HTML 注入器 | `lib/html-injector.js` | 读取用户 HTML，注入弹幕 CSS/JS |
| 弹幕存储 | `lib/danmaku-store.js` | 内存队列、审批状态、管理者追踪 |
| 幻灯片同步 | `lib/slide-sync.js` | 当前幻灯片索引、演讲者身份识别 |

### 客户端组件（注入）

| 组件 | 文件 | 职责 |
|-----------|------|----------------|
| 角色路由 | 注入脚本内联代码 | 检测 `?role=` 参数，初始化对应 UI |
| 幻灯片同步客户端 | `public/slide-sync.js` | 拦截翻页、WebSocket 同步 |
| 弹幕渲染器 | `public/danmaku-renderer.js` | 基于 DOM 的弹幕动画、轨道管理 |
| 演讲者控制栏 | `public/speaker-controls.js` | 底部控制栏：清空、暂停、速度、密度 |
| 观众面板 | `public/audience-panel.js` | 可折叠侧边栏：文本输入、颜色选择器 |
| 管理者面板 | `public/moderator-panel.js` | 可折叠侧边栏：待处理队列、通过/拦截按钮 |

## 文件结构

```
bullet-screen/
├── server.js              # 入口：Express + Socket.IO
├── lib/
│   ├── html-injector.js   # HTML 字符串注入
│   ├── danmaku-store.js   # 弹幕 + 审核状态的内存存储
│   └── slide-sync.js      # 幻灯片状态追踪
├── public/                # Express 提供的静态资源
│   ├── danmaku.css        # 弹幕层 + 角色特定 UI 样式
│   ├── slide-sync.js      # 幻灯片同步客户端
│   ├── danmaku-renderer.js # 弹幕渲染引擎
│   ├── speaker-controls.js # 演讲者控制栏
│   ├── audience-panel.js  # 观众侧边栏
│   └── moderator-panel.js # 管理者侧边栏
└── package.json
```

## HTML 注入

服务器在启动时读取用户的 HTML 文件一次，并缓存注入后的版本。

```javascript
function injectHtml(originalHtml, role) {
  // 在 </head> 前注入弹幕 CSS
  const css = `<link rel="stylesheet" href="/public/danmaku.css">`;
  let html = originalHtml.replace('</head>', css + '</head>');

  // 在 </body> 前注入弹幕 JS
  const script = `
    <script>
      window.BS_ROLE = '${role}';
      window.BS_SERVER = '${serverUrl}';
    </script>
    <script src="/socket.io/socket.io.js"></script>
    <script src="/public/danmaku-renderer.js"></script>
  `;
  html = html.replace('</body>', script + '</body>');

  return html;
}
```

### 路由

| 路由 | 注入角色 | 描述 |
|-------|--------------|-------------|
| `GET /speaker` | `speaker` | 带控制栏的演讲者视图 |
| `GET /audience` | `audience` | 带发送侧边栏的观众视图 |
| `GET /moderator` | `moderator` | 带审核侧边栏的管理者视图 |
| `GET /public/*` | - | 静态资源（CSS/JS） |

## WebSocket 协议

所有通信使用 Socket.IO 默认命名空间（`/`）。

### 客户端 → 服务端事件

| 事件 | 负载 | 发送者 | 描述 |
|-------|---------|--------|-------------|
| `danmaku:send` | `{ text: string, color: string }` | audience | 发送一条弹幕 |
| `danmaku:block` | `{ id: string }` | moderator | 拦截一条待处理弹幕 |
| `slide:go` | `{ idx: number }` | speaker | 导航到第 N 张幻灯片（从0开始） |
| `control:clear` | `{}` | speaker | 清空屏幕上所有弹幕 |
| `control:pause` | `{ paused: boolean }` | speaker | 暂停/恢复弹幕显示 |
| `control:speed` | `{ speed: number }` | speaker | 调整弹幕速度（0.5~3.0） |
| `control:density` | `{ density: number }` | speaker | 调整同时显示的最大弹幕数（1~10） |

### 服务端 → 客户端事件

| 事件 | 负载 | 目标 | 描述 |
|-------|---------|--------|-------------|
| `danmaku:approved` | `{ id, text, color, senderId }` | all | 广播已通过的弹幕 |
| `danmaku:rejected` | `{ id }` | sender only | 通知发送者被拒绝 |
| `danmaku:blocked` | `{ id }` | all | 从所有屏幕移除被拦截的弹幕 |
| `slide:go` | `{ idx: number }` | audience, moderator | 同步幻灯片导航 |
| `slide:sync` | `{ idx, total }` | 新连接 | 当前幻灯片位置 |
| `control:state` | `{ paused, speed, density }` | 新连接 | 当前控制设置 |

## 弹幕系统

### 渲染

- **方法**: 基于 DOM（非 Canvas）
- **动画**: CSS `transform: translateX()` 配合 `transition`
- **层**: 固定定位覆盖全视口，`pointer-events: none`
- **单个弹幕**: `pointer-events: auto` 用于悬停暂停

### 轨道管理

- 屏幕垂直方向划分为 8 条轨道
- 新弹幕分配到上一条弹幕已清除屏幕宽度 >50% 的轨道
- 防止文字重叠

### 样式

- 字体：系统无衬线字体，18px，粗体，文字阴影确保在任何背景上可见
- 颜色：8 种预定义颜色（白、红、黄、绿、青、蓝、粉、橙）
- 可选：每条弹幕半透明的深色背景条

### 控制

| 控制项 | 行为 |
|---------|----------|
| 清空 | 立即从 DOM 和队列中移除所有弹幕 |
| 暂停/恢复 | 切换所有弹幕的 `animation-play-state: paused` |
| 速度 | 滑动条 0.5x~3x，调整 CSS 过渡时长 |
| 密度 | 滑动条 1~10，限制同时显示的最大弹幕数 |

### 生命周期

1. 观众点击发送 → Socket.IO `danmaku:send`
2. 服务端检查审核模式 → 立即通过或加入审核队列
3. 已通过的弹幕 → `danmaku:approved` → 客户端进入渲染队列
4. 弹幕从右侧进入，以恒定速度向左移动，离开视口后移除

## 角色页面布局

### 演讲者（`/speaker`）

```
+------------------------------------------+
|                                          |
|      用户 HTML 幻灯片内容                |
|      (100% 宽度 x 100% 高度)             |
|                                          |
|  <- 弹幕飘过 ->                          |
|                                          |
|  [清空] [暂停] 速度: ===|-- 密度:  |     <- 底部控制栏
+------------------------------------------+
```

- 控制栏：固定底部，约 48px 高度，半透明毛玻璃效果
- 控制栏区域：`pointer-events: auto`

### 观众（`/audience`）

```
+------------------------+---------------+
|                        |  文本输入框   |
|  用户 HTML 幻灯片      |  [发送]       |
|  (可调整主区域)        |               |
|                        |  颜色选择     |
|  <- 弹幕飘过 ->        |  o o o o o    |
|                        |               |
|                        |  -----------  |
|                        |               |
+------------------------+---------------+
```

- 侧边栏：默认 280px，可通过箭头按钮折叠
- 主内容随侧边栏宽度自适应调整

### 管理者（`/moderator`）

```
+------------------------+---------------+
|                        |  待处理       |
|  用户 HTML 幻灯片      |  +----------+ |
|  (可调整主区域)        |  |弹幕文字  | |
|                        |  |[v] [x]   | |
|  <- 弹幕飘过 ->        |  +----------+ |
|                        |               |
|                        |  -----------  |
|                        |               |
+------------------------+---------------+
```

- 侧边栏显示待处理弹幕卡片，带有通过/拦截按钮
- 已通过的弹幕自动从列表移除，出现在主屏幕上
- 被拦截的弹幕从列表移除，发送者收到拒绝通知

## 幻灯片同步

### 挑战

html-ppt 使用自定义的 `go(n)` 函数和 `BroadcastChannel` 进行内部同步。弹幕系统必须无缝集成。

### 检测策略

**主方案**: 监听 html-ppt 的 `BroadcastChannel('html-ppt-presenter-' + location.pathname)` 以获取 `{ type: 'go', idx: n }` 消息。转发到 Socket.IO。

**备用方案**: 拦截 `keydown` 事件（方向键、空格、PgUp/PgDn）并发送带当前幻灯片索引的 `slide:go`。

### 同步流程

```
演讲者按键 → html-ppt go(n) → BroadcastChannel
                                          ↓
                                   注入的 JS 捕获
                                          ↓
                                   Socket.IO slide:go → 服务端
                                                            ↓
                              观众/管理者 ← Socket.IO ←┘
                                          ↓
                                   调用 go(n, true)
```

### 新连接同步

- 服务端维护 `currentSlideIdx`（默认 0）
- 新连接接收带当前索引的 `slide:sync`
- 客户端调用 `go(idx, true)` 跳转到正确幻灯片
- `fromRemote=true` 防止 BroadcastChannel 重新广播（防循环）

### 防循环设计

- 服务端只接受来自 `role === 'speaker'` 的 `slide:go`
- 接收 `slide:go` 的客户端调用 `go(n, true)` —— `fromRemote` 标志阻止 BroadcastChannel 回声

## 审核流程

### 模式判定

- 服务端追踪 `moderatorCount`（活跃管理者连接数）
- `moderatorCount === 0`: **自动通过模式** —— 弹幕立即广播
- `moderatorCount > 0`: **审核模式** —— 弹幕进入待处理队列

### 审核模式流程

```
观众发送 → 服务端加入 pendingQueue → 广播给所有管理者
                                                        ↓
管理者点击 [通过] → 从队列移除 → 广播 danmaku:approved
管理者点击 [拦截] → 从队列移除 → 广播 danmaku:blocked
```

### 管理者侧边栏

- 顶部标签："自动通过" 或 "审核中 (X条待审)"
- 待处理弹幕卡片：文字 + 时间戳 + [通过] [拦截] 按钮
- 多个管理者：所有人均看到相同队列，任意管理者的操作立即生效

### 边界情况

| 场景 | 处理 |
|----------|----------|
| 管理者断开连接 | `moderatorCount` → 0，所有待处理弹幕自动通过 |
| 多个管理者 | 共享队列，先到先得操作 |
| 管理者刷新 | 重新连接，接收当前幻灯片 + 待处理队列同步 |

## 错误处理与边界情况

| 场景 | 处理 |
|----------|----------|
| 断开/重新连接 | Socket.IO 自动重连；服务端发送 `slide:sync` + `control:state` + 待处理队列 |
| 多个演讲者 | 第一个连接的演讲者拥有控制权；后续演讲者为只读 |
| HTML 文件缺失 | 启动时校验；退出并显示错误消息提示用法：`node server.js <path-to-html>` |
| 观众在演讲者之前打开 | 正常连接，显示第 1 页；演讲者加入后幻灯片同步激活 |
| 同一人多角色 | 允许；服务端按 socket 连接管理，不按 IP |
| BroadcastChannel 不可用 | 降级为键盘事件拦截以检测翻页同步 |
| 无 ES Module 支持 | 所有注入的 JS 使用 IIFE 格式 |

## 性能限制

| 指标 | 限制 | 理由 |
|--------|-------|-----------|
| 并发客户端 | 无限制（Socket.IO 默认） | 本地场景预计 < 100 |
| 弹幕历史 | 500 条（循环缓冲区） | 防止内存泄漏 |
| 待处理队列 | 无限制 | 本地场景不会超过合理限制 |
| 屏幕上的并发弹幕 | 可配置 1-10 | 由密度滑动条控制 |

## 启动流程

1. 用户运行：`node server.js ./my-talk/index.html`
2. 服务端验证 HTML 文件存在
3. 服务端读取并缓存每个角色的注入版本
4. 服务端打印本地网络 URL：
   ```
   演讲者:    http://192.168.1.100:3000/speaker
   管理者:    http://192.168.1.100:3000/moderator
   观众:      http://192.168.1.100:3000/audience
   ```
5. 客户端打开 URL，通过 Socket.IO 自动连接，接收同步状态

## 未来考虑（超出范围）

- 弹幕历史导出到文件
- 多场演示同时进行
- 移动端响应式侧边栏
- 弹幕中的表情/贴纸支持
- 每个客户端的速率限制

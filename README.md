# Bullet Screen — 弹幕服务器

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D18-green?logo=node.js" alt="Node.js">
  <img src="https://img.shields.io/badge/Socket.IO-4.8-blue?logo=socket.io" alt="Socket.IO">
  <img src="https://img.shields.io/badge/license-MIT-yellow" alt="License">
</p>

<p align="center">为 html-ppt 演示文稿提供实时弹幕互动的本地服务器</p>

<p align="center">
  <a href="README.md">中文</a> | <a href="README.en.md">English</a>
</p>

---

## 功能特性

- **三角色架构** — 演讲者、管理者、观众，各自独立界面
- **实时弹幕** — 基于 WebSocket 的即时弹幕推送，DOM 驱动渲染
- **翻页同步** — 演讲者翻页自动同步到所有观众和管理者终端
- **管理者审核** — 自动通过模式 + 手动拦截模式，支持多管理者协同
- **演讲者控制** — 清空弹幕、暂停/恢复、调节速度、调节密度
- **零构建** — 纯原生 JavaScript + CSS，无需任何前端构建工具
- **html-ppt 深度集成** — 自动检测翻页，通过 BroadcastChannel 与原生运行时协作
- **动画同步** — 演讲者端触发的 CSS / WAAPI / GSAP / Anime.js / Lottie 动画自动同步到观众端
- **一键外网分享** — 自动创建外网隧道，演讲者按 `Ctrl+Alt+S` 弹出二维码
- **移动端适配** — 手机浏览器自动切换为悬浮按钮 + 侧滑抽屉模式

## 效果预览

```
演讲者页面                观众页面                    管理者页面
┌──────────────────┐     ┌────────────┬──────────┐    ┌────────────┬──────────┐
│                  │     │            │ 弹幕输入  │    │            │ 待审核    │
│   HTML 幻灯片     │     │  HTML 幻灯片 │  [发送]   │    │  HTML 幻灯片 │  ┌─────┐  │
│                  │     │            │ 颜色选择  │    │            │  │弹幕 │  │
│  ←弹幕飘过→      │     │  ←弹幕飘过→ │  ○○○○○  │    │  ←弹幕飘过→ │  │[✓][✗]│  │
│                  │     │            │          │    │            │  └─────┘  │
│ [清空][暂停]     │     │            │          │    │            │           │
│ 速度: ===|--     │     │            │          │    │            │           │
│ 密度: |====      │     │            │          │    │            │           │
└──────────────────┘     └────────────┴──────────┘    └────────────┴──────────┘
```

## 系统要求

- **Node.js** >= 18.0.0
- **npm** >= 9.0.0
- 一个基于 html-ppt 生成的 HTML 演示文稿（或其他支持键盘翻页的 HTML 幻灯片）

## 快速开始

### 安装

```bash
# 克隆仓库
git clone https://github.com/yourusername/bullet-screen.git
cd bullet-screen

# 安装依赖
npm install
```

### 启动

```bash
node server.js <path-to-your-html-ppt-file>
```

示例：

```bash
# 使用项目自带的测试幻灯片
node server.js examples/html-ppt-test.html

# 使用你自己的 html-ppt 文件
node server.js ~/my-talk/index.html
```

启动成功后，控制台会输出访问链接：

```
🎯 弹幕服务器已启动

局域网访问：
  演讲者: http://192.168.3.48:3000/speaker
  管理者: http://192.168.3.48:3000/moderator
  观众:   http://192.168.3.48:3000/

外网访问：
  观众:   https://xxx.loca.lt/

快捷键：Ctrl + Alt + S 打开分享弹窗
```

> 外网访问使用 Cloudflare Tunnel，需提前安装 cloudflared。
>
> **安装 cloudflared：**
> https://github.com/cloudflare/cloudflared/releases
> https://github.com/cloudflare/cloudflared/releases/download/2026.5.2/cloudflared-windows-amd64.msi
> ```bash
> # Windows (PowerShell)
> winget install --id Cloudflare.cloudflared
>
> # macOS
> brew install cloudflare/cloudflare/cloudflared
>
> # 其他系统参见 https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/
> ```
>
> 未安装 cloudflared 时仅提供局域网访问，不生成外网链接。

### 使用流程

1. **演讲者** 打开 `/speaker` 链接，用 `→` / `←` / `空格` 翻页
2. **管理者**（可选）打开 `/moderator` 链接，审核弹幕
3. **观众** 打开 `/` 链接（根路径，无需后缀），发送弹幕并观看

> 当没有管理者在线时，弹幕自动通过；有管理者在线时，弹幕进入审核队列。

## 动画同步

演讲者端触发的动画会自动同步到所有观众端，无需额外配置。

### 支持的动画类型

| 类型 | 支持情况 | 说明 |
|------|---------|------|
| CSS `@keyframes` Animation | ✅ 自动同步 | 通过 `classList.add()` 触发的动画 |
| CSS Transition | ✅ 自动同步 | 通过 `style` 或 `class` 变化触发的过渡 |
| Web Animations API | ✅ 自动同步 | `element.animate()` 调用 |
| GSAP | ✅ 自动同步 | `gsap.to()` / `gsap.from()` / `gsap.timeline()` |
| Anime.js | ✅ 自动同步 | `anime({...})` 调用 |
| Lottie | ✅ 自动同步 | `anim.play()` / `anim.pause()` / `anim.stop()` |
| 声明式标注 | ✅ 手动标注 | `data-bs-sync-anim` 属性（见下方） |
| `:hover` / `:focus` 伪类 | ⚠️ 需标注 | 无法自动拦截，通过声明式标注实现 |

### 声明式标注用法

对于 Hook 无法自动拦截的场景（如 `:hover` 触发的动画），可使用 `data-bs-sync-anim` 标注：

```html
<!-- hover 触发动画同步 -->
<div data-bs-sync-anim="hover-glow" data-bs-sync-trigger="hover">...</div>

<!-- click 触发动画同步 -->
<button data-bs-sync-anim="button-pulse" data-bs-sync-trigger="click">...</button>

<!-- 进入视口时同步 -->
<div data-bs-sync-anim="scroll-reveal" data-bs-sync-trigger="visible">...</div>

<!-- 自动跟随 class 变化同步 -->
<div data-bs-sync-anim="fade-in" data-bs-sync-trigger="auto">...</div>
```

### 动画同步测试

项目内置了 5 个动画同步测试页面：

```bash
# CSS Animation + Transition
node server.js examples/anim-test-css.html

# Web Animations API
node server.js examples/anim-test-waapi.html

# GSAP
node server.js examples/anim-test-gsap.html

# Anime.js
node server.js examples/anim-test-anime.html

# 声明式标注
node server.js examples/anim-test-declarative.html
```

## 角色说明

### 演讲者（Speaker）

- 同屏展示 HTML 幻灯片
- 底部控制栏：清空弹幕、暂停/恢复、调节速度/密度
- 翻页自动同步到所有观众和管理者
- 按 `Ctrl + Alt + S` 弹出分享弹窗，显示外网链接、局域网链接和二维码

### 观众（Audience）

- 同屏展示 HTML 幻灯片
- **桌面端**：右侧可折叠侧边栏，弹幕输入 + 8 色颜色选择器
- **手机端**：右下角悬浮按钮，点击后从右侧滑出抽屉面板
- 发送的弹幕需通过审核后显示（有管理者时）
- 访问地址：`/`（根路径，无需后缀）

### 管理者（Moderator）

- 同屏展示 HTML 幻灯片
- 右侧可折叠侧边栏：待审核弹幕列表
- 每条弹幕可单独「通过」或「拦截」
- 支持多个管理者同时在线，共享审核队列

## 技术架构

```
┌─────────────────────────────────────────────────────────────┐
│                        用户 HTML 文件                         │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              服务端注入的弹幕系统层                      │  │
│  │  ┌─────────────┐  ┌──────────┐  ┌──────────────────┐ │  │
│  │  │ 弹幕渲染层   │  │ 控制栏   │  │ 侧边栏（角色）    │ │  │
│  │  │ Danmaku     │  │ Controls │  │ Panel            │ │  │
│  │  └─────────────┘  └──────────┘  └──────────────────┘ │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │   WebSocket (Socket.IO)  │
                    └─────────┬─────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │ Danmaku  │   │  Slide   │   │ Moderator│
        │  Store   │   │  Sync    │   │  Count   │
        └──────────┘   └──────────┘   └──────────┘
```

## 项目结构

```
bullet-screen/
├── server.js                  # Express + Socket.IO 入口
├── lib/
│   ├── html-injector.js       # HTML 注入器
│   ├── danmaku-store.js       # 弹幕存储（内存队列 + 审核）
│   └── slide-sync.js          # 幻灯片同步状态管理
├── public/                    # 前端静态资源
│   ├── danmaku.css            # 弹幕层 + UI 样式
│   ├── danmaku-renderer.js    # 弹幕渲染引擎
│   ├── slide-sync.js          # 翻页同步客户端
│   ├── audience-panel.js      # 观众侧边栏
│   └── moderator-panel.js     # 管理者侧边栏
├── tests/                     # 单元测试
│   ├── html-injector.test.js
│   ├── danmaku-store.test.js
│   └── slide-sync.test.js
├── examples/                  # 示例
│   ├── html-ppt-test.html     # html-ppt 测试幻灯片
│   └── test-deck.html         # 最小化测试文件
├── docs/
│   └── superpowers/           # 设计与实现文档
└── package.json
```

## 配置

目前项目通过环境变量和命令行参数进行最小化配置：

| 方式 | 说明 | 示例 |
|------|------|------|
| 命令行参数 | HTML 文件路径 | `node server.js ./talk.html` |
| 环境变量 | 服务端口号 | `PORT=8080 node server.js ./talk.html` |

## 开发

```bash
# 运行测试
npm test

# 启动开发模式
node server.js examples/html-ppt-test.html
```

### 测试覆盖

- `html-injector.test.js` — HTML 注入逻辑（6 个测试）
- `danmaku-store.test.js` — 弹幕队列与审核（7 个测试）
- `slide-sync.test.js` — 幻灯片同步状态（8 个测试）

## 与 html-ppt 集成

本项目深度集成 [html-ppt-skill](https://github.com/lewislulu/html-ppt-skill)，支持以下特性：

- **BroadcastChannel 监听** — 自动捕获 html-ppt 演讲者模式的翻页事件
- **键盘备用方案** — BroadcastChannel 不可用时自动降级为键盘事件拦截
- **动画同步** — 观众端翻页时重新触发 html-ppt 的 CSS 进入动画
- **Presenter Mode 兼容** — 演讲者按 `S` 键打开演讲者窗口不影响弹幕同步

支持的 html-ppt 快捷键：

| 按键 | 功能 |
|------|------|
| `← →` / `空格` | 翻页 |
| `T` | 切换主题 |
| `F` | 全屏 |
| `S` | 演讲者模式 |
| `O` | 幻灯片概览 |

## 协议

服务端与客户端通过 Socket.IO 通信，主要事件：

### 客户端 → 服务端

| 事件 | 发送者 | 说明 |
|------|--------|------|
| `danmaku:send` | audience | 发送弹幕 |
| `danmaku:block` | moderator | 拦截弹幕 |
| `slide:go` | speaker | 翻页 |
| `control:*` | speaker | 控制指令 |

### 服务端 → 客户端

| 事件 | 目标 | 说明 |
|------|------|------|
| `danmaku:approved` | all | 弹幕已通过 |
| `danmaku:blocked` | all | 弹幕被拦截 |
| `slide:go` | audience/moderator | 翻页同步 |
| `slide:sync` | new connection | 当前幻灯片位置 |

完整协议详见 [`docs/superpowers/specs/2026-05-24-bullet-screen-design.md`](docs/superpowers/specs/2026-05-24-bullet-screen-design.md)。

## 浏览器兼容性

- Chrome / Edge >= 90
- Firefox >= 88
- Safari >= 14

> 依赖 BroadcastChannel API，Safari 14 以下版本将自动降级为键盘事件方案。

## 许可证

[MIT](LICENSE) © 2026

## 相关项目

- [html-ppt-skill](https://github.com/lewislulu/html-ppt-skill) — 零构建的 HTML 幻灯片生成工具

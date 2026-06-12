# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-06-12

### Added

- Speaker token authentication with cookie-based validation
- Protected `/speaker` route requiring token or valid cookie
- Socket.IO speaker role validation via token cookie
- Speaker token helpers for generation, validation, and cookie handling
- Protected speaker URL printed in server console on startup

### 新增

- 演讲者 Token 认证，支持基于 Cookie 的验证
- 保护 `/speaker` 路由，需要 Token 或有效 Cookie
- 通过 Token Cookie 验证 Socket.IO 演讲者角色
- Token 生成、验证和 Cookie 处理辅助函数
- 服务启动时在控制台打印受保护的演讲者 URL

## [1.2.0] - 2026-06-11

### Added

- Universal HTML animation sync (`anim-sync`) for speaker-audience consistency
- Animation replay engine with 9 built-in replay handlers
- Library adapters for GSAP, Anime.js, and Lottie
- Declarative animation sync via `data-bs-sync-anim` annotations
- Trigger hook layer for DOM API interception and broadcast
- Shared animation sync utilities (`isSpeaker`, `getStableSelector`, `broadcastTrigger`)
- Server route `bs:anim:trigger` and automatic script injection
- Test pages for CSS, WAAPI, GSAP, Anime.js, and declarative animations
- Design spec and implementation plan for universal HTML animation sync

### Fixed

- Guarded `window` references in animation sync code for Node.js test compatibility

### 新增

- 通用 HTML 动画同步（anim-sync），实现演讲者与观众端演示效果一致
- 动画回放引擎，内置 9 种回放处理器
- GSAP、Anime.js、Lottie 库适配器
- 通过 `data-bs-sync-anim` 注解实现声明式动画同步
- 触发器钩子层，拦截 DOM API 并广播动画事件
- 动画同步通用工具（`isSpeaker`、`getStableSelector`、`broadcastTrigger`）
- 服务器路由 `bs:anim:trigger` 及脚本自动注入
- CSS、WAAPI、GSAP、Anime.js 和声明式动画测试页面
- 通用 HTML 动画同步设计规范与实现计划

### 修复

- 为动画同步代码中的 `window` 引用添加保护，兼容 Node.js 测试环境

## [1.1.0] - 2026-05-30

### Added

- Audience experience optimization: mobile-friendly UI and sharing
- Root path `/` as the audience entry point
- Floating Action Button (FAB) + drawer for audience panel on mobile
- `Ctrl+Alt+S` share modal with QR code and copyable links
- Cloudflare Tunnel support for public URLs (via `cloudflared`)
- Automatic public URL and QR code variables in HTML injector
- Dependency: `qrcode` for QR generation

### Changed

- Replaced earlier ngrok/localtunnel tunnel experiments with Cloudflare Tunnel as the stable solution

### Documentation

- Updated README with tunnel, mobile, and share modal instructions
- Added audience optimization design spec and implementation plan

### 新增

- 观众体验优化：移动端友好 UI 与分享功能
- 根路径 `/` 作为观众入口
- 移动端观众面板悬浮按钮（FAB）+ 抽屉
- `Ctrl+Alt+S` 分享弹窗，支持二维码和链接复制
- Cloudflare Tunnel 公网隧道支持（通过 `cloudflared`）
- HTML 注入器自动替换公网 URL 和二维码变量
- 依赖：`qrcode` 用于二维码生成

### 变更

- 将早期的 ngrok/localtunnel 隧道方案替换为稳定的 Cloudflare Tunnel

### 文档

- 更新 README：隧道、移动端和分享弹窗使用说明
- 添加观众体验优化设计规范与实现计划

## [1.0.0] - 2026-05-24

### Added

- Initial release with full danmaku server functionality
- Three-role architecture: Speaker, Moderator, and Audience
- Real-time danmaku delivery via Socket.IO with DOM-based rendering
- 8-track danmaku layout system to prevent text overlap
- Slide synchronization across all connected clients
- Moderation system with auto-approve and manual review modes
- Speaker control bar: clear, pause/resume, speed and density adjustment
- Deep html-ppt integration via BroadcastChannel and keyboard fallback
- Collapsible side panels for audience (send) and moderator (review)
- 8-color picker for danmaku customization
- Unit tests with Jest (21 tests, 100% passing)
- Project documentation: design doc, implementation plan, README (CN/EN)

### Technical Details

- **Backend**: Express + Socket.IO
- **Frontend**: Vanilla JavaScript (IIFE) + CSS, zero build step
- **HTML Processing**: String injection (no DOM parsing)
- **Communication**: Socket.IO default namespace with role-based event filtering
- **State Management**: In-memory only (no persistence)
- **Danmaku Lifecycle**: audience sends → server queues/approves → broadcast to all

### 新增

- 初始版本，完整的弹幕服务器功能
- 三角色架构：演讲者、管理者、观众
- 基于 Socket.IO 的实时弹幕推送，DOM 驱动渲染
- 8 轨道弹幕布局系统，防止文字重叠
- 所有连接客户端之间的幻灯片同步
- 审核系统：自动通过 + 手动拦截双模式
- 演讲者控制栏：清空、暂停/恢复、速度和密度调节
- 通过 BroadcastChannel 和键盘备用方案深度集成 html-ppt
- 观众（发送）和管理者（审核）的可折叠侧边栏
- 8 色颜色选择器，自定义弹幕颜色
- Jest 单元测试（21 个测试，100% 通过）
- 项目文档：设计文档、实现计划、中英文 README

### 技术细节

- **后端**: Express + Socket.IO
- **前端**: 原生 JavaScript (IIFE) + CSS，零构建步骤
- **HTML 处理**: 字符串注入（不解析 DOM）
- **通信**: Socket.IO 默认命名空间，基于角色的事件过滤
- **状态管理**: 纯内存（无持久化）
- **弹幕生命周期**: 观众发送 → 服务端排队/审核 → 广播给所有客户端

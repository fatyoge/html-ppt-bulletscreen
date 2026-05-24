# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

## [1.0.0] - 2026-05-24

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

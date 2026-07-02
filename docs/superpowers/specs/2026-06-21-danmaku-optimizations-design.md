# 弹幕优化设计文档

## 背景

现有弹幕系统将屏幕垂直方向划分为 8 条轨道，弹幕可出现在全屏任意轨道；观众面板默认选中白色；弹幕内容直接渲染文本，未对 Emoji 做额外支持。本次优化针对这三个点进行改进。

## 目标

1. 弹幕出现位置限制在屏幕上方可控比例区域内，并在该区域内随机选择轨道。
2. 观众弹幕颜色预选默认从白色改为从现有预设中随机。
3. 观众面板增加 Emoji 选择器，支持插入常用 Unicode 表情。

## 非目标

- 不改变审核流程、幻灯片同步、角色权限等现有机制。
- 不引入外部 Emoji 字体或第三方 Emoji 库。
- 不做表情自动转换（如 `:)` 转 😊）。

## 技术栈

沿用现有技术栈：Node.js、Express、Socket.IO、原生 JavaScript (IIFE)、CSS。

## 详细设计

### 1. 弹幕位置：上方区域轨道随机 + 演讲者可控

#### 行为变更

- 屏幕上方 `topRatio` 比例区域（默认 30%）作为弹幕可出现的垂直范围。
- 在该范围内仍按原有轨道概念划分，但**随机**选择可用轨道，而非顺序查找。
- 演讲者控制栏新增“高度”滑块，实时调整 `topRatio`，范围 10%~100%，步进 10%。
- `topRatio` 纳入服务端控制状态，新连接自动同步当前值，行为与 `speed`、`density` 一致。

#### 轨道计算

- 总轨道数保持 `TRACK_COUNT = 8`。
- 可用轨道数：`usableTracks = max(1, floor(TRACK_COUNT * topRatio))`。
- 轨道索引范围：`0 ~ usableTracks - 1`。
- `findAvailableTrack()` 仅在该索引范围内查找，返回轨道索引后再随机打乱视觉效果：实际 `top = trackIdx * TRACK_HEIGHT_PCT`。

> 注：由于轨道本身等分全屏，当 `topRatio = 30%` 时，可用轨道约为 `floor(8 * 0.3) = 2` 条，弹幕将出现在最上方 2 条轨道内，视觉上约占屏幕顶部 25%，接近“上方 30%”的预期。

#### 接口变更

**客户端 → 服务端**

| 事件 | 负载 | 发送者 | 描述 |
|------|------|--------|------|
| `control:topRatio` | `{ topRatio: number }` | speaker | 调整弹幕可出现的上方区域比例 |

**服务端 → 客户端**

| 事件 | 负载 | 目标 | 描述 |
|------|------|------|------|
| `control:topRatio` | `{ topRatio: number }` | all | 广播当前上方区域比例 |
| `control:state` | `{ paused, speed, density, topRatio }` | 新连接 | 包含当前 `topRatio` |

#### 文件改动

- `lib/slide-sync.js`：`controlState` 新增 `topRatio: 0.3`；`getControlState()` / `setControlState()` 处理该字段。
- `server.js`：监听并广播 `control:topRatio`。
- `public/speaker-controls.js`：新增高度滑块及事件绑定。
- `public/danmaku-renderer.js`：保存 `topRatio`；根据 `topRatio` 限制可用轨道并随机选择。

### 2. 观众默认颜色随机

#### 行为变更

- 观众面板打开时，从现有的 8 种预设颜色中随机选择一种作为默认选中色。
- 用户仍可手动点击其他颜色切换。

#### 文件改动

- `public/audience-panel.js`：`buildInputArea()` 中初始化 `selectedColor = COLORS[Math.floor(Math.random() * COLORS.length)].value`，并正确设置初始 `selected` 类。

### 3. Emoji 选择器

#### 行为变更

- 在观众面板输入区增加一个 Emoji 按钮。
- 点击按钮展开常用 Emoji 面板（约 20 个）。
- 点击表情插入到输入框当前光标位置；若输入框未聚焦，则先聚焦并在末尾插入。
- 用户仍可直接使用系统输入法输入任意 Unicode Emoji。

#### Emoji 列表

硬编码常用表情，无需外部依赖：

```
😀 😂 🤔 👍 ❤️ 🎉 🔥 ✨ 👏 🙏
😭 😅 😍 🤩 😎 🤯 🥳 👀 💡 💯
```

#### 文件改动

- `public/audience-panel.js`：新增 Emoji 按钮、面板展开/收起、插入逻辑。
- `public/danmaku.css`：Emoji 按钮与面板样式。

## 错误处理与边界情况

| 场景 | 处理 |
|------|------|
| `topRatio` 越界 | 客户端和服务端均 clamp 到 `[0.1, 1.0]` |
| `topRatio` 导致可用轨道为 0 | 使用 `max(1, floor(...))` 保证至少 1 条轨道 |
| Emoji 面板外点击 | 关闭面板 |
| 输入框未聚焦时点击 Emoji | 聚焦输入框并在末尾插入 |

## 测试计划

### 单元测试

- `tests/slide-sync.test.js`：
  - `getControlState()` 默认包含 `topRatio: 0.3`
  - `setControlState({ topRatio: 0.5 })` 成功更新

### 手动验证

1. 启动服务，打开演讲者、观众、管理者页面。
2. 演讲者调整“高度”滑块，观察所有页面弹幕只出现在上方对应区域。
3. 多次刷新观众页面，确认默认选中颜色随机变化。
4. 在观众面板点击 Emoji 按钮，选择表情插入输入框并发送，确认弹幕中正确显示。

## 文件清单

- `lib/slide-sync.js`
- `server.js`
- `public/speaker-controls.js`
- `public/danmaku-renderer.js`
- `public/audience-panel.js`
- `public/danmaku.css`
- `tests/slide-sync.test.js`
- `docs/superpowers/specs/2026-06-21-danmaku-optimizations-design.md`（本文档）

## 未来考虑（超出范围）

- 支持更多 Emoji 分类或搜索。
- 允许演讲者锁定观众颜色选择。
- 弹幕按内容长度动态选择轨道以避免遮挡标题。

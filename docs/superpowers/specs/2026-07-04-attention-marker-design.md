# 双击注意力动效设计文档

> **实现演进（2026-07-05 更新）**：动效节奏统一为单次快速扩散（~0.9s、不重复）——脉冲圈改为 MacBook 风格渐变软圈、波纹/聚光同步为单次扩散；颜色选择由「暖/冷/黑白」模板改为「自动」+ 8 个直选色块。本文下方颜色章节已同步；§3 各动效的视觉细节以代码（`public/attention.css`）为准。

## 背景

现有系统是一个「演讲者—观众」HTML 幻灯片演示工具：演讲者在 `/speaker` 控制，观众在 `/` 观看并叠加弹幕。演讲者已是所有交互（翻页、清空/暂停/速度/密度/高度、动画触发）的唯一来源，Socket.IO 负责把演讲者的动作广播给全员。

演示过程中，演讲者希望能用一个简单的动效把观众的注意力引向屏幕上的某个点。本期新增「双击注意力动效」：演讲者双击幻灯片任意位置，全员（含演讲者本机）在该落点播放一次短动效作为注意力提醒。

## 目标

1. 演讲者双击幻灯片区域，所有客户端（含演讲者本机）在双击落点同步播放一次注意力动效。
2. 提供三种动效样式：**脉冲圈（默认）**、水波纹、聚光灯，演讲者可在控制栏切换。
3. 动效颜色根据落点底色**自动选取高对比色、避开相近色**；同时提供「自动」+ 8 个直选色块，演讲者可手动指定颜色覆盖自动。
4. 动效为单次触发，播放完成后自动消失，不常驻、不干扰。

## 非目标

- 不做持续跟随鼠标的激光笔模式（单次提醒语义已足够；激光笔留待未来）。
- 不做动效样式 / 颜色模板的服务端持久化或跨标签同步——这两项是演讲者本地 UI 状态。
- 不改变弹幕审核、翻页同步、角色权限等任何现有机制。
- 不引入新的第三方依赖（不用 html2canvas 等做像素级取色）。

## 技术栈

沿用现有技术栈：Node.js、Express、Socket.IO、原生 JavaScript（IIFE）、CSS。

## 实现路线

采用**独立通道 + 独立模块**，不复用现有 `bs:anim:trigger` 动画同步通道。

理由：`bs:anim:trigger` 那套（`trigger-hook-layer` + `replay-engine`）的核心假设是「按 DOM 选择器在匹配到的元素上回放动画」，消息必须带 `selector`，且 `replay-engine` 在找不到元素时直接丢弃。注意力动效是「按屏幕坐标定位」的全屏浮层，与元素无关；若硬塞进去，需要在 `querySelector` 之前对 `attention` 类型做特判，且服务端现有 `socket.broadcast`（不含演讲者）无法给演讲者本机回显，等于绕开它的核心假设，反而更复杂。

因此新增一条独立的 `attention:ping` 通道、一个独立的前端模块 `attention.js` 和样式 `attention.css`。

## 详细设计

### 1. 触发与同步

#### 演讲者端

- 在 `document` 上监听 `dblclick`。
- 用 `event.target.closest()` 忽略来自以下 UI 的双击，避免误触发：`#speaker-controls`、`#speaker-controls-trigger`、`#side-panel`、`#mobile-fab`、`#mobile-drawer`、`#drawer-overlay`、`#share-modal`、`#danmaku-layer`。
- 命中有效区域后，计算落点相对视口的百分比坐标：
  - `xPct = clientX / window.innerWidth * 100`
  - `yPct = clientY / window.innerHeight * 100`
- 通过 `window._danmakuSocket` 发送 `attention:ping`，payload 携带当前演讲者本地选择的样式与颜色选择（`colorMode` + `color`）。

#### 消息格式

```jsonc
{
  "id": "<uuid>",          // 去重用，由 attention.js 自建 UUID 生成
  "xPct": 53.2,            // 0~100，相对视口宽度
  "yPct": 41.7,            // 0~100，相对视口高度
  "effect": "ping",        // ping | ripple | spotlight
  "colorMode": "auto",     // auto | fixed（fixed = 演讲者手动选色）
  "color": null,           // 仅 fixed 有效：演讲者选定的 #rrggbb；auto 时为 null
  "bgRgb": [26, 22, 40]    // 演讲者端在落点取到的底色（便于观众端复算/兜底）
}
```

> `bgRgb` 由演讲者端取色后随消息发出。观众端优先用本地取色（各设备底色可能不同，例如响应式布局），`bgRgb` 仅在本地取色失败时兜底。这样跨设备仍各自取到正确的对比色。

#### 服务端

```js
socket.on('attention:ping', (msg) => {
  if (socket.data.role !== 'speaker') return;
  if (!msg || typeof msg.xPct !== 'number' || typeof msg.yPct !== 'number') return;
  io.emit('attention:ping', msg);   // 含演讲者本机，单一渲染路径、天然回显
});
```

用 `io.emit`（而非 `socket.broadcast`）的原因：与现有 `control:*` 事件一致，演讲者本机也走同一条渲染回调，保证所有端使用同一段渲染代码、视觉完全一致，免去「本地立即渲染 + 广播给他人」的双路径维护。

#### 所有客户端

收到 `attention:ping` 后：
1. 以 `id` 去重（Set 记录，防止重复播放）。
2. 在 `#bs-attention-layer` 内于 `(xPct%, yPct%)` 创建动效元素，按 `effect` 套对应 class，按算出的颜色设置 `--accent` / `--core` 内联变量。
3. 约 1.5s 后自动移除该元素。

### 2. 渲染层

- 新增 `#bs-attention-layer`：`position: fixed; inset: 0; pointer-events: none;`，`z-index` 设为高于 `#danmaku-layer`（具体值在 `attention.css` 中与弹幕层协调）。
- 由 `attention.js` 在初始化时创建，所有角色共用。

### 3. 三种动效（CSS + CSS 变量动态着色）

所有动效的颜色通过元素内联的 CSS 变量 `--accent`（主色）与 `--core`（中心实心点色）注入，因此同一套 class 可按实例换色。

- **脉冲圈 Ping（默认）**：一个常驻 `core` 实心点 + 两个 `ring` 圈做雷达式扩散淡出（错开 0.8s）。
- **水波纹 Ripple**：三个 `ring` 同心圈依次扩散淡出（错开 0.6s）+ 中心 `core` 点。
- **聚光灯 Spotlight**：一个 `glow` 径向光晕在原处呼吸缩放 + 一个 `dot` 中心亮点；`glow` 用 `mix-blend-mode: screen` 在深底上更通透。

动效总时长约 1.5s（单次）。`core`/`ring`/`glow` 永远带描边或外光晕，作为「取色失准也能看清」的兜底。

### 4. 颜色自适应算法（核心）

抽成纯函数，便于 Node 单测：

```ts
pickAccent(bgRgb: [number,number,number], mode: Mode, fixedColor?: string): { accent: string, core: string }
// Mode = 'auto' | 'fixed'；mode='fixed' 且 fixedColor 合法时直接用该色（core 按其亮度取深/浅），非法则回退 auto
```

#### 取色（落点底色）

- `el = document.elementFromPoint(x, y)`，从 `el` 起向上遍历父节点，取第一个 `getComputedStyle(...).backgroundColor` 解析出不透明（alpha ≈ 1）的 RGB。
- 解析失败或全透明（例如落点是图片/视频/渐变半透明层）→ 回退为当前激活幻灯片 `.slide.is-active` 的底色；仍失败 → 回退 `[17, 17, 24]`（与 UI 深底一致）。

#### 候选色板（跨色相，每个自带推荐 core）

| 名称 | accent | core |
|------|--------|------|
| 橙 | `#ff8c1a` | `#ffffff` |
| 青 | `#16c2ff` | `#06314a` |
| 暖黄 | `#ffd23f` | `#5a4400` |
| 砖红 | `#e8362f` | `#7a1209` |
| 品红 | `#ff3d9a` | `#5a0830` |
| 翠绿 | `#2ee676` | `#0a4022` |

#### 评分（auto 模式）

对每个候选 `c` 相对底色 `bg` 计算：

- 亮度对比 `dL = | relativeLuminance(c) − relativeLuminance(bg) |`，范围 0~1。
- 色相距离 `dH = min(|Hc−Hbg|, 360−|Hc−Hbg|)`，范围 0~180，归一化为 `dH/180`。
- `score = 0.7 * dL + 0.3 * (dH/180)`，取分数最高的候选。

权重以亮度对比为主、色相避让为辅——既保证可读性，又能在底色与默认橙相近时自动切到冷色（解决「同色陷阱」）。

> `relativeLuminance` 使用 sRGB 反 gamma 线性化后的标准公式 `0.2126R + 0.7152G + 0.0722B`；`H` 取 RGB→HSL 的色相分量。

#### 手动选色（fixed 模式）

跳过评分，直接用演讲者选定的颜色：

- accent = 演讲者所选 `#rrggbb`。
- core = `relativeLuminance(accent) > 0.5 ? '#111111' : '#ffffff'`（浅色配深芯、深色配浅芯，保证中心点可见）。
- `fixedColor` 非法（非 `#rrggbb`）→ 回退到 auto 评分。
- 描边/光晕沿用 §3 所有模式共用的固定兜底样式，即使所选色与底色相近仍可见。

演讲者色板（与观众弹幕色板一致）：`#ff4444 #ffcc00 #44ff44 #00ffff #4488ff #ff88cc #ff8844 #ffffff`。

### 5. 演讲者控制栏 UI

在 `public/danmaku-renderer.js` 的 `initSpeakerControls()` 现有控制栏（`#speaker-controls`）末尾追加两个紧凑选择器组（初始化与事件绑定逻辑放在 `attention.js`，由 `initSpeakerControls` 调用，保持职责单一）：

- **动效**：三个小按钮 `脉冲 / 波纹 / 聚光`，默认「脉冲」。
- **颜色**：「自动」chip + 8 个直选色块（红/黄/绿/青/蓝/粉/橙/白），默认「自动」。点色块进入 fixed 模式用该色，点「自动」回到智能选色。

两项为纯演讲者本地状态（模块内变量），每次发送 `attention:ping` 时把当前值写入 payload。不进入服务端 `controlState`，不参与新连接同步——因为它们只影响「下一次双击」的瞬时表现，不像 `speed/density/topRatio` 那样影响持续状态。

### 6. 模块职责划分

- `public/attention.js`（IIFE，所有角色加载）：
  - 创建 `#bs-attention-layer`。
  - 暴露 `window.BS_Attention = { pickAccent, render, initSpeakerUI }`。
  - 演讲者端绑定 `dblclick` → 取色 → 发送 `attention:ping`。
  - 所有端监听 `attention:ping` → 取色 → 渲染 → 自动清理。
  - 导出 `pickAccent` 供 Node 单测（`module.exports`，与 `common.js` 一致）。
- `public/attention.css`：`#bs-attention-layer` 及三种动效的全部样式与 `@keyframes`。
- `lib/html-injector.js`：在 `</head>` 前注入 `attention.css`，在 `</body>` 前注入 `attention.js`（所有角色）。
- `server.js`：新增 `attention:ping` 监听 + 校验 + `io.emit`。

## 接口变更

**客户端 → 服务端**

| 事件 | 负载 | 发送者 | 描述 |
|------|------|--------|------|
| `attention:ping` | `{ id, xPct, yPct, effect, colorMode, color, bgRgb }` | speaker | 双击触发一次注意力动效 |

**服务端 → 客户端**

| 事件 | 负载 | 目标 | 描述 |
|------|------|------|------|
| `attention:ping` | 同上 | all（含演讲者） | 在落点渲染一次动效 |

## 错误处理与边界情况

| 场景 | 处理 |
|------|------|
| 双击落在控制栏/弹幕面板/分享弹窗 | `closest` 命中忽略列表 → 不触发 |
| 双击落在 `#danmaku-layer` 等浮层 | 同上，忽略 |
| html-ppt runtime 已占用 `dblclick`（如双击全屏） | 实现时先验证；若冲突，把监听收窄到 `.slide` 内，或加修饰键（如 Alt+双击） |
| `elementFromPoint` 取到图片/视频/全透明层 | 向上回退到 `.slide.is-active` 底色，再回退到默认深色 |
| 取色失准（复杂背景） | `core`/`ring`/`glow` 常驻描边与外光晕兜底，保证可见 |
| 观众端屏幕宽高比与演讲者不同 | 用视口百分比定位，落点映射到对应比例位置（轻微偏移可接受） |
| 重复消息（网络重发等） | 以 `id` 去重 |
| 非演讲者发送 `attention:ping` | 服务端 `role !== 'speaker'` 拒绝 |
| payload 缺字段 / 坐标非数字 | 服务端校验后丢弃 |
| 动效未清理（如标签页切到后台） | 用 `setTimeout` 兜底移除，不依赖 animation 事件 |

## 测试计划

### 单元测试（`tests/attention.test.js`）

对纯函数 `pickAccent(bgRgb, mode, fixedColor)` 覆盖：

- 深色底（如 `[17,17,24]`）+ `auto` → 命中高亮暖色（亮度对比最大者），core 为浅色。
- 浅色底（如 `[255,255,255]`）+ `auto` → 命中饱和深色，core 为深色。
- **同色陷阱**：橙底（如 `[255,140,26]`）+ `auto` → 不选橙色，选冷色（青/翠绿等色相距离大者）。
- `fixed` 模式 → accent = 指定色，core 按亮度取深/浅；指定色非法时回退 auto。
- 输入非法（null / 空数组）→ 回退安全默认值，不抛异常。

### 手动验证

1. `node server.js examples/html-ppt-test.html`，分别打开演讲者、观众页。
2. 演讲者双击幻灯片不同位置：确认演讲者本机与观众页在同一落点出现动效，约 1.5s 后消失。
3. 切换动效样式（脉冲/波纹/聚光），双击确认三种都能正确播放。
4. 在深色、浅色、橙色、蓝色等不同底色的幻灯片上双击，确认颜色自动取高对比色且不与底色相近。
5. 点不同色块切换手动选色，确认覆盖生效；点「自动」回到智能选色。
6. 双击控制栏、弹幕面板区域，确认不触发。
7. 观众页弹幕暂停时双击（由演讲者），确认注意力动效仍正常播放（与弹幕暂停相互独立）。

## 文件清单

- 新增 `public/attention.js`
- 新增 `public/attention.css`
- 改 `lib/html-injector.js`（注入上述两文件）
- 改 `server.js`（`attention:ping` 监听 + 广播）
- 改 `public/danmaku-renderer.js`（`initSpeakerControls()` 调用 `BS_Attention.initSpeakerUI()`）
- 新增 `tests/attention.test.js`
- 新增 `docs/superpowers/specs/2026-07-04-attention-marker-design.md`（本文档）

## 未来考虑（超出范围）

- 持续跟随鼠标的「激光笔」模式（按住某键或开关切换）。
- 用 `localStorage` 记住演讲者上次选择的动效样式与颜色选择（自动/指定色）。
- 动效样式扩展更多种类（如标记箭头、爆炸星等）。
- 允许观众也能触发本地注意力标记（需评估是否会互相干扰）。

# 双击防误选开关设计文档

## 背景

现有系统是一个「演讲者—观众」HTML 幻灯片演示工具：演讲者在 `/speaker` 双击幻灯片任意位置，触发一次注意力动效（`attention:ping`）并广播给全员。

双击触发注意力动效时，浏览器原生的「双击选词」行为会同时选中落点下的文字（部分情况下还会高亮/拖拽图片），在演讲画面上留下干扰性的选区。本期为演讲者增加一个**防误选开关**：打开后，幻灯片内容不再被选中，双击只触发动效、不留选区。

## 目标

1. 演讲者控制栏新增「防误选」开关，默认**关**。
2. 开关打开时，幻灯片内容的文字与图片均不可被选中（双击选词、拖拽框选都不触发）；关闭后恢复浏览器默认可选行为。
3. 开关状态用 `localStorage` 记住，刷新后保持上次的选择。
4. 开关只作用于演讲者本机，不影响观众/审核端。

## 非目标

- 不做服务端同步/广播——这是演讲者本地浏览体验设置，观众端既不双击、也不需要被控制。
- 不做「只挡双击选词、保留拖拽框选」的克制模式——直接全量禁选，最干净，也最稳。
- 不改变注意力动效本身（动效样式、颜色自适应、`attention:ping` 通道均不变）。
- 不引入新依赖。

## 技术栈

沿用现有技术栈：原生 JavaScript（IIFE）、CSS。仅改 `public/attention.js` 与 `public/attention.css`，不动服务端、不动 `html-injector.js`。

## 实现路线

采用 **`<body>` 加类 + CSS 禁选 + 显式放开工具栏/输入框** 的方案，逻辑与 UI 都收口在 `attention.js`（它已拥有双击处理与演讲者控件 UI）。

理由：本工具用 `html-injector` 包装**任意** HTML 演示稿，没有统一的「内容根容器」可靠选择（有的用 `#stage`，有的用 `.slide`，外部 deck 结构千差万别）。因此不在内容侧做白名单选择，而是反向操作：给 `<body>` 加 `bs-no-select` 类全量禁选，再把工具自身的 UI 与输入元素显式放开。这与项目里已有的 `body.is-dragging-card * { user-select: none !important; }` 是同一套思路。

作用范围天然限定为演讲者：开关只出现在演讲者控制栏（`initSpeakerUI`），只有演讲者会把它打开 → 只有演讲者的 `<body>` 会被加上 `bs-no-select` → 观众/审核端永不被加该类，自然不受影响，无需任何服务端改动。

## 详细设计

### 1. 开关 UI

- 挂载点：`attention.js` 的 `initSpeakerUI(container)`，追加到现有注意力控件组 `.bs-attn-controls` 末尾。
- 形态：一个 `<label>` 内嵌 `<input type="checkbox">` + 文案「防误选」，紧凑、与现有色板/分段按钮同一行风格。（文案可调。）
- 默认状态：**不勾选**（关）。

### 2. 状态与持久化

- 模块内新增本地状态 `state.noSelect`（布尔），与现有 `state.effect / colorMode / color` 同级。
- `localStorage` 键：`bs-attn-noSelect`，存字符串 `"1"`（开）或 `"0"`（关）。
- 读取容错抽成纯函数，便于 Node 单测：

```ts
resolveNoSelect(stored: string | null): boolean
// stored === '1' → true；其余（"0"、null、异常值）→ false
```

- 初始化时（`init()` 内）：`state.noSelect = resolveNoSelect(localStorage.getItem('bs-attn-noSelect'))`，随即调用 `applyNoSelect(state.noSelect)` 套用 body 类。
- 切换时：翻转 `state.noSelect` → `applyNoSelect(...)` → `localStorage.setItem('bs-attn-noSelect', v ? '1' : '0')` → 更新 checkbox 勾选态。
- `resetState()`（测试用）一并重置 `state.noSelect = false`（仅重置内存状态，不清 `localStorage`，与现有 effect/color 的 reset 语义一致）。
- `localStorage` 不可用（隐私模式/被禁/访问异常）时：读取按 `false` 处理、写入 try/catch 静默吞掉，开关当次会话内仍可用，只是不持久化。

### 3. 套用 body 类

```js
function applyNoSelect(on) {
  document.body.classList.toggle('bs-no-select', !!on);
}
```

### 4. CSS 规则（写入 `public/attention.css`）

```css
/* 防误选：开时禁止幻灯片内容选中 */
body.bs-no-select { user-select: none; }
body.bs-no-select img { -webkit-user-drag: none; }   /* 图片不产生拖拽幽灵 */

/* 放开：工具自身 UI + 任何输入/可编辑元素（含分享链接可复制） */
body.bs-no-select #speaker-controls,
body.bs-no-select #speaker-controls-trigger,
body.bs-no-select #side-panel,
body.bs-no-select #mobile-fab,
body.bs-no-select #mobile-drawer,
body.bs-no-select #drawer-overlay,
body.bs-no-select #share-modal,
body.bs-no-select input,
body.bs-no-select textarea,
body.bs-no-select [contenteditable] { user-select: text; }
```

放开清单 = `attention.js` 现有 `IGNORE_SELECTOR`（工具自身 UI）+ 通用输入/可编辑元素，复用既有约定。其中 `#share-modal` 含分享链接，必须保持可选可复制。

开关自身样式（checkbox + 文案）追加在 `attention.css` 末尾，沿用 `#speaker-controls .bs-attn-controls …` 前缀抬高优先级的既有写法。

### 5. 与注意力动效的关系

完全独立：防误选只通过 CSS 控制 `<body>` 类，**不改动** `bindDblclick` 与 `attention:ping` 的任何逻辑。开关开/关都不影响双击发 ping、不影响动效渲染。

### 6. 模块改动清单

- `public/attention.js`：
  - `state` 新增 `noSelect`。
  - 新增纯函数 `resolveNoSelect(stored)`（导出供单测）。
  - 新增 `applyNoSelect(on)`。
  - `init()`：读 `localStorage` → `resolveNoSelect` → `applyNoSelect`。
  - `initSpeakerUI()`：追加 checkbox 开关 UI 与 change 事件（翻转状态、套类、写 `localStorage`、更新勾选态）。
  - `resetState()`：重置 `noSelect = false`。
  - `getState()`：返回值增补 `noSelect`（与 `effect/colorMode/color` 同级，保持对外状态完整）。
  - `module.exports` 增补 `resolveNoSelect`。
- `public/attention.css`：上述 `body.bs-no-select` 规则 + 开关样式。

## 错误处理与边界情况

| 场景 | 处理 |
|------|------|
| 双击落在工具栏/弹幕面板/分享弹窗 | 不变（现有 `IGNORE_SELECTOR` 已忽略，不触发 ping；这些区域在开关打开时也保持可选） |
| 开关打开后双击幻灯片文字 | 不留选区，只触发注意力动效 |
| 开关打开后拖拽框选幻灯片 | 不可框选（全量禁选的预期行为） |
| 图片 | `user-select:none` 去高亮 + `-webkit-user-drag:none` 去拖拽幽灵 |
| 分享链接 / 输入框 / 可编辑元素 | 放开清单显式 `user-select:text`，仍可复制/输入 |
| 刷新页面 | 读 `localStorage` 还原上次状态 |
| `localStorage` 不可用（隐私模式/禁用） | 读取按关处理、写入静默吞；当次会话内开关仍生效，仅不持久化 |
| 观众 / 审核端 | 不含开关、永不被加 `bs-no-select`，行为完全不变 |
| 关闭开关 | 移除 `bs-no-select` 类，立即恢复浏览器默认可选 |

## 测试计划

### 单元测试（`tests/attention.test.js`，增补）

对纯函数 `resolveNoSelect(stored)` 覆盖：

- `"1"` → `true`。
- `"0"` / `null` / `""` / 任意非 `"1"` 字符串 → `false`。

### 手动验证

1. `node server.js examples/html-ppt-test.html`，打开演讲者页。
2. 默认开关为关：双击幻灯片文字 → 仍会选词（确认默认行为未变）。
3. 打开「防误选」开关：双击幻灯片文字 → 不留选区，只出注意力动效；拖拽框选文字 → 不可选；图片不可拖拽出幽灵。
4. 打开分享弹窗 → 分享链接仍可选中复制；速度/密度/高度等滑杆仍可操作。
5. 关闭开关 → 双击/拖拽恢复可选。
6. 打开开关后刷新页面 → 开关仍为开（`localStorage` 生效）。
7. 打开观众页同步验证 → 观众端双击/选中行为不受影响（观众端本就不双击；其文字仍可选，未被波及）。

## 文件清单

- 改 `public/attention.js`（开关 UI、状态、`resolveNoSelect`、`applyNoSelect`、`init`/`resetState` 调整、导出）
- 改 `public/attention.css`（`body.bs-no-select` 规则 + 开关样式）
- 改 `tests/attention.test.js`（`resolveNoSelect` 单测）
- 新增 `docs/superpowers/specs/2026-07-06-no-select-toggle-design.md`（本文档）

## 未来考虑（超出范围）

- 持久化其它注意力本地状态（effect / colorMode / color）一并接入 `localStorage`。
- 可选的「只挡双击选词、保留拖拽框选」克制模式（如有人需要偶尔复制幻灯片文字）。
- 真空 prevent-default 路线与 `user-select` 路线的兼容性矩阵细调（老浏览器）。

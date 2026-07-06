# 双击防误选开关 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为演讲者控制栏新增一个「防误选」开关,打开后幻灯片内容(文字/图片)不可被选中,使双击触发注意力动效时不再误选落点下的文字。

**Architecture:** 在 `public/attention.js`(已拥有双击处理与演讲者控件 UI)中新增开关逻辑:开关挂在注意力控件组 `.bs-attn-controls` 内;翻转时给 `<body>` 加/移 `bs-no-select` 类;`public/attention.css` 用该类全量 `user-select:none` 并显式放开工具栏/输入框;状态用 `localStorage`(`bs-attn-noSelect`)持久化,默认关,仅演讲者本机生效(开关与 `loadNoSelect()` 调用都只在演讲者侧运行)。不动服务端、不动 `html-injector.js`。

**Tech Stack:** 原生 JavaScript(IIFE)、CSS、Jest(`jest-environment-jsdom` 提供 DOM 与 `localStorage`,用于 DOM/UI 测试)。

## Global Constraints

- 不引入任何新依赖。
- 不改 `server.js`、不改 `lib/html-injector.js`、不改其它 `public/*.js`。仅改 `public/attention.js`、`public/attention.css`、`tests/attention.test.js`、`tests/attention-dom.test.js`。
- 代码/标识符用英文;注释/文案用中文。开关文案固定为「防误选」。
- 命名约定(全任务统一):`localStorage` 键 `bs-attn-noSelect`(值 `"1"`/`"0"`);body 类 `bs-no-select`;checkbox 类 `attn-noselect`;label 类 `attn-noselect-label`;纯函数 `resolveNoSelect(stored)`;DOM 函数 `applyNoSelect(on)`、`loadNoSelect()`;内部存储读写 `readNoSelectStored()`、`writeNoSelectStored(on)`。
- 默认状态:关(`noSelect=false`)。`resetState()` 只重置内存 `state.noSelect=false`,不清 `localStorage`、不动 body 类(测试 beforeEach 负责 DOM/storage 清理)。
- 仅演讲者本机:开关 UI 与 `loadNoSelect()` 的调用都位于演讲者代码路径(`initSpeakerUI`、`init()` 的 `window.BS_ROLE === 'speaker'` 分支),观众/审核端不会执行,即使 `localStorage`(同源共享)存有 `"1"`。

---

## File Structure

- `public/attention.js`(改):新增 5 个函数(`resolveNoSelect`、`readNoSelectStored`、`writeNoSelectStored`、`applyNoSelect`、`loadNoSelect`)、`state` 增 `noSelect`、`getState`/`resetState`/`init`/`initSpeakerUI`/`module.exports` 同步更新。
- `public/attention.css`(改):新增 `body.bs-no-select` 禁选规则 + 放开清单 + checkbox 开关样式。
- `tests/attention.test.js`(改):新增 `resolveNoSelect` 纯函数单测(node 环境)。
- `tests/attention-dom.test.js`(改):`beforeEach` 增 localStorage/body 类清理;新增 `applyNoSelect`、`loadNoSelect`、checkbox UI 的 jsdom 测试。

---

### Task 1: 纯函数 `resolveNoSelect` + 导出

把 `localStorage` 字符串解析成布尔的纯函数,可独立单测,也是后续 `loadNoSelect` 的依赖。

**Files:**
- Modify: `public/attention.js`(在 `function bindDblclick(socket)` 之前插入新函数;更新 `module.exports`)
- Test: `tests/attention.test.js`

**Interfaces:**
- Consumes: 无。
- Produces: `resolveNoSelect(stored: string | null): boolean`(`stored === '1'` → `true`,其余 → `false`)。

- [ ] **Step 1: 写失败测试**

在 `tests/attention.test.js` 顶部把 require 改为:

```js
const { pickAccent, relativeLuminance, hueDistance, hexToRgb, resolveNoSelect } = require('../public/attention');
```

在文件末尾追加:

```js
describe('resolveNoSelect', () => {
  test('"1" → true', () => {
    expect(resolveNoSelect('1')).toBe(true);
  });

  test('"0" / null / "" / 其它字符串 → false', () => {
    expect(resolveNoSelect('0')).toBe(false);
    expect(resolveNoSelect(null)).toBe(false);
    expect(resolveNoSelect('')).toBe(false);
    expect(resolveNoSelect('garbage')).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npx jest tests/attention.test.js`
Expected: FAIL,报 `resolveNoSelect is not a function`(尚未导出)。

- [ ] **Step 3: 实现 `resolveNoSelect` 并导出**

在 `public/attention.js` 中,找到 `  function bindDblclick(socket) {`(约 181 行),在它**之前**插入:

```js
  /* ============ no-select(防误选)============ */

  // localStorage 字符串 → 布尔。仅 "1" 视为开,其余(含 null/异常)视为关。
  function resolveNoSelect(stored) {
    return stored === '1';
  }

```

在 `module.exports = { ... }` 内追加一行(在 `resetState: resetState` 之后):

```js
      resetState: resetState,
      resolveNoSelect: resolveNoSelect
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `npx jest tests/attention.test.js`
Expected: PASS,所有原有 + 新增 `resolveNoSelect` 用例通过。

- [ ] **Step 5: 提交**

```bash
git add public/attention.js tests/attention.test.js
git commit -m "feat(attention): 新增 resolveNoSelect 纯函数 + 单测"
```

---

### Task 2: 存储读写 + `applyNoSelect` + `loadNoSelect` + state 接入

实现防误选的核心机制:读/写 `localStorage`(带异常容错)、给 body 加类、统一入口 `loadNoSelect`(读 → 设 state → 套类),并把 `noSelect` 接入 `state`/`getState`/`resetState` 与 `init()` 演讲者分支。

**Files:**
- Modify: `public/attention.js`(`state`、新函数块、`getState`、`resetState`、`init`、`module.exports`)
- Test: `tests/attention-dom.test.js`

**Interfaces:**
- Consumes: Task 1 的 `resolveNoSelect(stored)`。
- Produces: `applyNoSelect(on: boolean): void`、`loadNoSelect(): boolean`(返回当前持久化的开关值);`getState()` 返回值新增 `noSelect: boolean`;`resetState()` 重置 `state.noSelect=false`。

- [ ] **Step 1: 写失败测试**

在 `tests/attention-dom.test.js` 顶部把 require 改为:

```js
const { renderAt, sampleBgRgb, initSpeakerUI, getState, resetState, applyNoSelect, loadNoSelect } = require('../public/attention');
```

把 `beforeEach` 改为(新增两行清理,避免用例间残留):

```js
beforeEach(() => {
  document.body.innerHTML = '';
  document.body.classList.remove('bs-no-select');
  localStorage.clear();
  resetState();
  jest.useFakeTimers();
});
```

在文件末尾追加:

```js
describe('applyNoSelect', () => {
  test('在 body 上加/移 bs-no-select 类', () => {
    applyNoSelect(true);
    expect(document.body.classList.contains('bs-no-select')).toBe(true);
    applyNoSelect(false);
    expect(document.body.classList.contains('bs-no-select')).toBe(false);
  });
});

describe('loadNoSelect(持久化读取)', () => {
  test('storage 为 "1" → 返回 true 且设 state + body 类', () => {
    localStorage.setItem('bs-attn-noSelect', '1');
    expect(loadNoSelect()).toBe(true);
    expect(getState().noSelect).toBe(true);
    expect(document.body.classList.contains('bs-no-select')).toBe(true);
  });

  test('默认(无 storage)→ false,不加类', () => {
    expect(loadNoSelect()).toBe(false);
    expect(getState().noSelect).toBe(false);
    expect(document.body.classList.contains('bs-no-select')).toBe(false);
  });

  test('resetState 清掉 noSelect', () => {
    localStorage.setItem('bs-attn-noSelect', '1');
    loadNoSelect();
    resetState();
    expect(getState().noSelect).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npx jest tests/attention-dom.test.js`
Expected: FAIL,报 `applyNoSelect is not a function` / `loadNoSelect is not a function` / `getState(...).noSelect` 为 `undefined`。

- [ ] **Step 3: 实现:state + 5 个函数 + getState/resetState + init 接入**

(3a) 把 `state` 初始化(约 143 行)改为:

```js
  var state = { effect: 'ping', colorMode: 'auto', color: null, noSelect: false };
```

(3b) 在 Task 1 插入的 `resolveNoSelect` 之后、`function bindDblclick(socket)` 之前,继续追加:

```js
  var NO_SELECT_KEY = 'bs-attn-noSelect';

  // 读 localStorage(隐私模式/被禁/Node 环境均不抛异常,返回 null)。
  function readNoSelectStored() {
    try {
      return (typeof localStorage !== 'undefined') ? localStorage.getItem(NO_SELECT_KEY) : null;
    } catch (e) {
      return null;
    }
  }

  // 写 localStorage(同上,失败静默吞)。
  function writeNoSelectStored(on) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(NO_SELECT_KEY, on ? '1' : '0');
    } catch (e) {
      /* 隐私模式/被禁:当次会话内仍可用,仅不持久化 */
    }
  }

  // 给 body 加/移 bs-no-select 类(Node/无 body 时安全返回)。
  function applyNoSelect(on) {
    if (typeof document === 'undefined' || !document.body) return;
    document.body.classList.toggle('bs-no-select', !!on);
  }

  // 统一入口:读持久化 → 设 state → 套 body 类。幂等,可重复调用。
  function loadNoSelect() {
    var v = resolveNoSelect(readNoSelectStored());
    state.noSelect = v;
    applyNoSelect(v);
    return v;
  }

```

(3c) 把 `getState`(约 221 行)改为:

```js
  function getState() {
    return { effect: state.effect, colorMode: state.colorMode, color: state.color, noSelect: state.noSelect };
  }
```

(3d) 把 `resetState`(约 225 行)改为:

```js
  function resetState() { state.effect = 'ping'; state.colorMode = 'auto'; state.color = null; state.noSelect = false; }
```

(3e) 把 `init` 内的演讲者分支(约 214-216 行)改为(新增 `loadNoSelect()` 调用,保证刷新后即便控件未挂载也已套上 body 类):

```js
    if (window.BS_ROLE === 'speaker') {
      bindDblclick(socket);
      loadNoSelect();
    }
```

(3f) 在 `module.exports = { ... }` 内追加(在 `resolveNoSelect: resolveNoSelect` 之后):

```js
      resolveNoSelect: resolveNoSelect,
      applyNoSelect: applyNoSelect,
      loadNoSelect: loadNoSelect
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `npx jest tests/attention-dom.test.js`
Expected: PASS,新增 `applyNoSelect` / `loadNoSelect` 用例与原有 `renderAt`/`sampleBgRgb`/`initSpeakerUI` 用例全部通过。

- [ ] **Step 5: 提交**

```bash
git add public/attention.js tests/attention-dom.test.js
git commit -m "feat(attention): 接入防误选状态机(存储/body 类/loadNoSelect)"
```

---

### Task 3: 防误选 checkbox UI + 切换持久化

在 `initSpeakerUI` 的注意力控件组里追加「防误选」checkbox:初始勾选态读自 `loadNoSelect()`;change 时翻转 `state.noSelect` → `applyNoSelect` → `writeNoSelectStored`。

**Files:**
- Modify: `public/attention.js`(`initSpeakerUI` 函数体)
- Test: `tests/attention-dom.test.js`

**Interfaces:**
- Consumes: Task 2 的 `loadNoSelect(): boolean`、`applyNoSelect(on)`、`writeNoSelectStored(on)`、`state.noSelect`。
- Produces:`initSpeakerUI` 内新增 checkbox(`.attn-noselect`)+ label(`.attn-noselect-label`,文案「防误选」);切换时更新 `state.noSelect`、body 类、`localStorage`。

- [ ] **Step 1: 写失败测试**

在 `tests/attention-dom.test.js` 末尾追加:

```js
describe('防误选 checkbox UI', () => {
  test('无 storage 时默认不勾选', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    initSpeakerUI(container);
    const cb = container.querySelector('.attn-noselect');
    expect(cb).not.toBeNull();
    expect(cb.checked).toBe(false);
    expect(getState().noSelect).toBe(false);
  });

  test('storage 为 "1" 时预勾选且 body 类已套上', () => {
    localStorage.setItem('bs-attn-noSelect', '1');
    const container = document.createElement('div');
    document.body.appendChild(container);
    initSpeakerUI(container);
    const cb = container.querySelector('.attn-noselect');
    expect(cb.checked).toBe(true);
    expect(document.body.classList.contains('bs-no-select')).toBe(true);
  });

  test('勾上 → state + body 类 + storage 同步', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    initSpeakerUI(container);
    const cb = container.querySelector('.attn-noselect');
    cb.checked = true;
    cb.dispatchEvent(new window.Event('change'));
    expect(getState().noSelect).toBe(true);
    expect(document.body.classList.contains('bs-no-select')).toBe(true);
    expect(localStorage.getItem('bs-attn-noSelect')).toBe('1');
  });

  test('取消勾选 → 一并清掉', () => {
    localStorage.setItem('bs-attn-noSelect', '1');
    const container = document.createElement('div');
    document.body.appendChild(container);
    initSpeakerUI(container);
    const cb = container.querySelector('.attn-noselect');
    cb.checked = false;
    cb.dispatchEvent(new window.Event('change'));
    expect(getState().noSelect).toBe(false);
    expect(document.body.classList.contains('bs-no-select')).toBe(false);
    expect(localStorage.getItem('bs-attn-noSelect')).toBe('0');
  });
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npx jest tests/attention-dom.test.js`
Expected: FAIL,`container.querySelector('.attn-noselect')` 为 `null`(checkbox 尚未渲染)。

- [ ] **Step 3: 在 `initSpeakerUI` 末尾追加 checkbox**

在 `public/attention.js` 的 `initSpeakerUI` 内,找到 `group.addEventListener('click', function (e) { ... });` 整段,在它**之后**、`return group;` **之前**插入:

```js
    // 防误选开关:初始态读自持久化(loadNoSelect 同时套上 body 类),change 时翻转并持久化。
    var noSelectNow = loadNoSelect();
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'attn-noselect';
    cb.checked = noSelectNow;
    var noSelectLabel = document.createElement('label');
    noSelectLabel.className = 'attn-noselect-label';
    noSelectLabel.textContent = '防误选';
    noSelectLabel.appendChild(cb);
    group.appendChild(noSelectLabel);
    cb.addEventListener('change', function () {
      state.noSelect = cb.checked;
      applyNoSelect(cb.checked);
      writeNoSelectStored(cb.checked);
    });
```

> 说明:checkbox 在 `group` 内,但既无 `data-v` 也非 `[data-kind]` 子节点,现有 `group` 的 click 委托(`e.target.closest('[data-v]')` 命中为 null 即 return)不会误处理它;勾选只走 checkbox 自己的 `change`。

- [ ] **Step 4: 运行测试,确认通过**

Run: `npx jest tests/attention-dom.test.js`
Expected: PASS,新增「防误选 checkbox UI」4 个用例与全部既有用例通过。

- [ ] **Step 5: 跑全量单测确认无回归**

Run: `npm test`
Expected: PASS,所有测试文件全绿。

- [ ] **Step 6: 提交**

```bash
git add public/attention.js tests/attention-dom.test.js
git commit -m "feat(attention): 演讲者控件栏新增防误选开关 UI + 切换持久化"
```

---

### Task 4: CSS 禁选规则 + 开关样式 + 端到端手动验证

加上 `body.bs-no-select` 的全量禁选与工具栏/输入框放开,以及 checkbox/label 的样式;然后在真实浏览器跑一遍端到端验证。

**Files:**
- Modify: `public/attention.css`(文件末尾追加)

**Interfaces:**
- Consumes: Task 3 产出的 `.attn-noselect` / `.attn-noselect-label` 类、`body.bs-no-select` 类。
- Produces: 无 JS 接口;纯样式 + 行为验证。

- [ ] **Step 1: 追加 CSS**

在 `public/attention.css` 末尾追加:

```css

/* ===== 防误选:开时禁止幻灯片内容选中 ===== */
body.bs-no-select { user-select: none; }
body.bs-no-select img { -webkit-user-drag: none; }   /* 图片不产生拖拽幽灵 */

/* 放开:工具自身 UI + 任何输入/可编辑元素(含分享链接可复制) */
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

/* 防误选开关(挂载于 #speaker-controls,需前缀抬高优先级,与上面 .bs-attn-controls 同理) */
#speaker-controls .bs-attn-controls .attn-noselect-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 4px;
  padding: 2px 6px;
  font-size: 12px;
  color: #fff;
  cursor: pointer;
  user-select: none;
}
#speaker-controls .bs-attn-controls .attn-noselect {
  width: 14px;
  height: 14px;
  margin: 0;
  cursor: pointer;
  accent-color: #ff8c1a;
}
```

- [ ] **Step 2: 启动服务**

Run: `node server.js examples/html-ppt-test.html`
Expected: 控制台输出服务已启动(含本机/LAN 地址,具体文案以现有 server.js 为准),无报错。

- [ ] **Step 3: 端到端手动验证(演讲者页)**

打开演讲者页(终端给出的地址 + `/speaker`,或按现有入口),逐项确认:

1. 控制栏注意力控件组内出现「防误选」checkbox,**默认未勾选**。
2. 不勾选时双击幻灯片上的文字 → 浏览器照常选词(确认默认行为未变)。
3. 勾选「防误选」:
   - 双击幻灯片文字 → 不留选区,只出现注意力动效;
   - 在幻灯片文字上拖拽框选 → 无法选中;
   - 幻灯片上的图片 → 拖拽不出现拖拽幽灵。
4. 打开分享弹窗 → 分享链接**仍可选中复制**;速度/密度/高度滑杆仍可拖动。
5. 取消勾选 → 双击/拖拽恢复可选,body 上的 `bs-no-select` 类移除。
6. 勾选后刷新页面 → checkbox 仍为勾选,且刷新后幻灯片内容依旧不可选(说明 `init()` 的 `loadNoSelect()` 与 `localStorage` 均生效)。
7. 打开观众页(同址根路径 `/`) → 观众端不受影响:其文字仍可选、双击不触发任何东西(观众端无开关、无 `bs-no-select` 类)。

- [ ] **Step 4: 提交**

```bash
git add public/attention.css
git commit -m "style(attention): 防误选 CSS 禁选规则 + 开关样式"
```

---

## Self-Review(写计划后自查)

- **Spec 覆盖**:
  - 目标 1(控制栏开关,默认关)→ Task 3 + Task 4 Step 3-1。✅
  - 目标 2(开则文字/图片不可选;关则恢复)→ Task 4 CSS + Task 3 切换。✅
  - 目标 3(localStorage 记住)→ Task 2 `loadNoSelect`/`readNoSelectStored` + Task 3 change 持久化,Task 4 Step 3-6 验证刷新。✅
  - 目标 4(仅演讲者本机)→ 开关与 `loadNoSelect()` 均在演讲者路径;Task 4 Step 3-7 验证观众页不受影响。✅
  - §4 CSS 规则(含放开清单 = IGNORE_SELECTOR + 输入元素)→ Task 4 Step 1 一致。✅
  - §6 模块改动(`state`/`getState`/`resetState`/`init`/`initSpeakerUI`/`module.exports`)→ Task 1-3 全覆盖。✅
  - 测试计划(`resolveNoSelect` 单测 + 手动验证 7 条)→ Task 1 单测、Task 4 Step 3 七条。✅
- **占位符扫描**:无 TBD/TODO;每个代码步均给出完整代码与精确锚点。✅
- **类型/命名一致性**:`resolveNoSelect` / `applyNoSelect` / `loadNoSelect` / `readNoSelectStored` / `writeNoSelectStored` / `bs-no-select` / `attn-noselect` / `attn-noselect-label` / `bs-attn-noSelect` 跨任务一致;`getState().noSelect` 在 Task 2 定义、Task 3 断言一致。✅

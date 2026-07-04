# 双击注意力动效 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 演讲者双击幻灯片任意位置，所有客户端（含演讲者本机）在落点播放一次自适应配色的注意力动效（脉冲圈/水波纹/聚光灯）。

**Architecture:** 新增独立 Socket.IO 通道 `attention:ping`（演讲者→服务端→`io.emit` 全员含演讲者）+ 独立前端模块 `public/attention.js`（IIFE）与样式 `public/attention.css`，由 `lib/html-injector.js` 注入所有角色。动效渲染在独立浮层 `#bs-attention-layer`。颜色由纯函数 `pickAccent(bgRgb, mode)` 按落点底色评分选取。

**Tech Stack:** Node.js、Express、Socket.IO、原生 JavaScript（IIFE）、CSS、Jest（含 `jest-environment-jsdom`）。

## Global Constraints

- 不引入任何新的第三方依赖（不用 html2canvas 等）。
- 前端脚本沿用现有 IIFE 风格（见 `public/anim-sync/common.js`），浏览器侧挂 `window.BS_Attention`，Node 侧 `module.exports` 供 Jest 测试，模块在 Node 环境下 `require` 不能抛错（DOM 访问须在函数体内或 `typeof window` 守卫之后）。
- UI 中文文案；代码标识符用英文。
- 测试用 `npm test`（Jest）；纯函数走 node 环境，DOM 相关用 `/** @jest-environment jsdom */`。
- 坐标一律用视口百分比 `{xPct, yPct}`（0~100）。
- z-index：`#bs-attention-layer` 设为 `15000`（高于 `#danmaku-layer` 的 `9999` 与 `10xxx` 的 UI，低于 `#share-modal` 的 `20000`）。
- 频繁提交，每个任务结束一次 commit。

---

## File Structure

- **新建 `public/attention.js`**（IIFE，所有角色加载）：颜色纯函数（`pickAccent` 等）、渲染（`renderAt`）、取色（`sampleBgRgb`）、Socket 接线（`init`/`bindDblclick`）、演讲者 UI（`initSpeakerUI`/`getState`）。本计划分 4 个任务往里加代码。
- **新建 `public/attention.css`**：`#bs-attention-layer` 浮层 + 三种动效的 class 与 `@keyframes` + 控制栏选择器样式。
- **改 `lib/html-injector.js`**：注入 `attention.css`（`</head>` 前）与 `attention.js`（`</body>` 前，所有角色）。
- **改 `server.js`**：监听并广播 `attention:ping`。
- **改 `public/danmaku-renderer.js`**：`initSpeakerControls()` 内调用 `BS_Attention.initSpeakerUI(controls)`。
- **新建 `tests/attention.test.js`**：`pickAccent` 等纯函数单测（node 环境）。
- **新建 `tests/attention-dom.test.js`**：`renderAt` / `sampleBgRgb` / `initSpeakerUI` 单测（jsdom 环境）。
- **改 `tests/html-injector.test.js`**：补充对 `attention.css` / `attention.js` 注入的断言。

---

## Task 1: 颜色自适应纯函数（TDD，node 环境）

**Files:**
- Create: `public/attention.js`
- Create: `tests/attention.test.js`

**Interfaces:**
- Produces（导出，供本任务及后续测试/模块使用）：
  - `hexToRgb(hex: string): [number,number,number] | null`
  - `relativeLuminance(rgb: [number,number,number]): number`（0~1，sRGB 反 gamma 标准公式）
  - `hueDistance(a: [number,number,number], b: [number,number,number]): number`（0~180）
  - `pickAccent(bgRgb, mode): { accent: string, core: string }`，`mode ∈ {'auto','warm','cool','hc'}`，默认 `'auto'`；`bgRgb` 非法时回退 `[17,17,24]`。

- [ ] **Step 1: 写失败测试** — 创建 `tests/attention.test.js`：

```js
const { pickAccent, relativeLuminance, hueDistance, hexToRgb } = require('../public/attention');

describe('pickAccent', () => {
  test('deep background + auto → bright accent (high luminance)', () => {
    const { accent } = pickAccent([17, 17, 24], 'auto');
    expect(relativeLuminance(hexToRgb(accent))).toBeGreaterThan(0.5);
  });

  test('light background + auto → dark accent (low luminance)', () => {
    const { accent } = pickAccent([255, 255, 255], 'auto');
    expect(relativeLuminance(hexToRgb(accent))).toBeLessThan(0.35);
  });

  test('same-hue trap: orange background + auto → not orange, far hue', () => {
    const { accent } = pickAccent([255, 140, 26], 'auto');
    expect(accent.toLowerCase()).not.toBe('#ff8c1a');
    expect(hueDistance(hexToRgb(accent), [255, 140, 26])).toBeGreaterThan(90);
  });

  test('warm mode → accent chosen from warm palette only', () => {
    const warm = ['#ff8c1a', '#e8362f', '#ffd23f'];
    const { accent } = pickAccent([17, 17, 24], 'warm');
    expect(warm).toContain(accent.toLowerCase());
  });

  test('cool mode → accent chosen from cool palette only', () => {
    const cool = ['#16c2ff', '#4d7cff', '#2ee676'];
    const { accent } = pickAccent([17, 17, 24], 'cool');
    expect(cool).toContain(accent.toLowerCase());
  });

  test('hc mode → black on light bg, white on dark bg', () => {
    expect(pickAccent([255, 255, 255], 'hc').accent).toBe('#111111');
    expect(pickAccent([17, 17, 24], 'hc').accent).toBe('#ffffff');
  });

  test('invalid input does not throw and returns strings', () => {
    expect(() => pickAccent(null, 'auto')).not.toThrow();
    expect(() => pickAccent([], 'auto')).not.toThrow();
    expect(() => pickAccent([17, 17, 24], 'weird')).not.toThrow();
    const r = pickAccent(null, 'auto');
    expect(typeof r.accent).toBe('string');
    expect(typeof r.core).toBe('string');
  });
});

describe('color helpers', () => {
  test('relativeLuminance extremes', () => {
    expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0, 5);
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5);
  });

  test('hexToRgb parses #rrggbb', () => {
    expect(hexToRgb('#ff8c1a')).toEqual([255, 140, 26]);
    expect(hexToRgb('nope')).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `npm test -- attention.test.js`
  Expected: FAIL（`Cannot find module '../public/attention'`）。

- [ ] **Step 3: 写最小实现** — 创建 `public/attention.js`（仅颜色部分 + 最小导出，不含任何 DOM 代码）：

```js
(function () {
  'use strict';

  /* ============ Color helpers (pure, no DOM) ============ */

  function hexToRgb(hex) {
    if (typeof hex !== 'string') return null;
    var m = hex.replace(/^#/, '').match(/^([0-9a-f]{6})$/i);
    if (!m) return null;
    var n = m[1];
    return [
      parseInt(n.slice(0, 2), 16),
      parseInt(n.slice(2, 4), 16),
      parseInt(n.slice(4, 6), 16)
    ];
  }

  function chan(c) {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function relativeLuminance(rgb) {
    if (!rgb) return 0;
    return 0.2126 * chan(rgb[0]) + 0.7152 * chan(rgb[1]) + 0.0722 * chan(rgb[2]);
  }

  function rgbToHsl(rgb) {
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var d = max - min;
    var h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    var l = (max + min) / 2;
    var s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    return [h, s, l];
  }

  function hueDistance(a, b) {
    var ha = rgbToHsl(a)[0];
    var hb = rgbToHsl(b)[0];
    var d = Math.abs(ha - hb) % 360;
    return Math.min(d, 360 - d);
  }

  var CANDIDATES = [
    { name: 'orange',  accent: '#ff8c1a', core: '#ffffff' },
    { name: 'cyan',    accent: '#16c2ff', core: '#06314a' },
    { name: 'yellow',  accent: '#ffd23f', core: '#5a4400' },
    { name: 'red',     accent: '#e8362f', core: '#7a1209' },
    { name: 'magenta', accent: '#ff3d9a', core: '#5a0830' },
    { name: 'green',   accent: '#2ee676', core: '#0a4022' },
    { name: 'blue',    accent: '#4d7cff', core: '#0a1f4a' }
  ];
  var BY_NAME = {};
  CANDIDATES.forEach(function (c) { BY_NAME[c.name] = c; });

  var PALETTES = {
    warm: ['orange', 'red', 'yellow'],
    cool: ['cyan', 'blue', 'green']
  };

  function normalizeBg(bgRgb) {
    if (!Array.isArray(bgRgb) || bgRgb.length < 3 ||
        ![0, 1, 2].every(function (i) { return Number.isFinite(bgRgb[i]); })) {
      return [17, 17, 24];
    }
    return [bgRgb[0], bgRgb[1], bgRgb[2]];
  }

  function pickAccent(bgRgb, mode) {
    bgRgb = normalizeBg(bgRgb);
    if (mode !== 'warm' && mode !== 'cool' && mode !== 'hc') mode = 'auto';

    if (mode === 'hc') {
      var fg = relativeLuminance(bgRgb) > 0.5 ? '#111111' : '#ffffff';
      return { accent: fg, core: fg };
    }

    var pool = mode === 'auto'
      ? CANDIDATES
      : PALETTES[mode].map(function (n) { return BY_NAME[n]; });

    var best = null, bestScore = -1, bestDL = -1;
    var bgLum = relativeLuminance(bgRgb);
    pool.forEach(function (c) {
      var rgb = hexToRgb(c.accent);
      var dL = Math.abs(relativeLuminance(rgb) - bgLum);
      var dH = hueDistance(rgb, bgRgb) / 180;
      var score = 0.7 * dL + 0.3 * dH;
      if (score > bestScore || (score === bestScore && dL > bestDL)) {
        bestScore = score; bestDL = dL; best = c;
      }
    });
    return { accent: best.accent, core: best.core };
  }

  /* ============ Exports ============ */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      pickAccent: pickAccent,
      relativeLuminance: relativeLuminance,
      hueDistance: hueDistance,
      hexToRgb: hexToRgb
    };
  }
})();
```

- [ ] **Step 4: 跑测试确认通过** — Run: `npm test -- attention.test.js`
  Expected: PASS（全部用例）。

- [ ] **Step 5: 提交**

```bash
git add public/attention.js tests/attention.test.js
git commit -m "feat(attention): pickAccent color-adaptive pure function"
```

---

## Task 2: 动效样式表 `attention.css`

**Files:**
- Create: `public/attention.css`

**Interfaces:** 无代码接口；定义 `.bs-attn`、`.bs-attn--ping`、`.bs-attn--ripple`、`.bs-attn--spotlight` 及子元素 class，消费 CSS 变量 `--accent` / `--core`（由 JS 内联设置）。动画延时由 JS 在每个 `.bs-attn__ring` 上以 inline `animation-delay` 给出。

- [ ] **Step 1: 创建样式文件** — `public/attention.css`：

```css
/* ===== Attention Marker Layer ===== */
#bs-attention-layer {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 15000;            /* 高于 danmaku(9999) 与 10xxx UI；低于 share-modal(20000) */
  overflow: hidden;
}

.bs-attn {
  --accent: #ff8c1a;
  --core: #ffffff;
  position: absolute;
  transform: translate(-50%, -50%);
}

/* 中心实心点（ping / ripple 共用） */
.bs-attn__core {
  position: absolute;
  left: 0;
  top: 0;
  width: 12px;
  height: 12px;
  margin: -6px 0 0 -6px;
  background: var(--core);
  border-radius: 50%;
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.25), 0 0 12px var(--accent);
}

/* 扩散圈（ping / ripple 共用结构，动画由修饰类决定，延时由 inline 给出） */
.bs-attn__ring {
  position: absolute;
  left: 0;
  top: 0;
  width: 12px;
  height: 12px;
  margin: -6px 0 0 -6px;
  border: 2px solid var(--accent);
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.20);   /* 兜底描边：任意底色都可见 */
  opacity: 0;
}

/* ---- Ping（默认）：常驻 core + 两圈雷达扩散 ---- */
.bs-attn--ping .bs-attn__ring {
  animation: bs-attn-ping 1.5s cubic-bezier(0, 0.5, 0.4, 1) forwards;
}
@keyframes bs-attn-ping {
  0%   { transform: scale(1); opacity: 0.9; }
  80%  { opacity: 0; }
  100% { transform: scale(6); opacity: 0; }
}

/* ---- Ripple：三圈同心扩散 + core ---- */
.bs-attn--ripple .bs-attn__ring {
  animation: bs-attn-ripple 1.5s ease-out forwards;
}
@keyframes bs-attn-ripple {
  0%   { transform: scale(0.4); opacity: 0.85; }
  100% { transform: scale(4.5); opacity: 0; }
}

/* ---- Spotlight：径向光晕呼吸 + 亮点 ---- */
.bs-attn--spotlight .bs-attn__glow {
  position: absolute;
  left: 0;
  top: 0;
  width: 140px;
  height: 140px;
  margin: -70px 0 0 -70px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--accent) 0%, rgba(0, 0, 0, 0) 68%);
  mix-blend-mode: screen;
  opacity: 0.85;
  animation: bs-attn-spot 1.5s ease-in-out forwards;
}
.bs-attn--spotlight .bs-attn__dot {
  position: absolute;
  left: 0;
  top: 0;
  width: 8px;
  height: 8px;
  margin: -4px 0 0 -4px;
  background: #fff;
  border-radius: 50%;
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.25), 0 0 14px #fff, 0 0 26px var(--accent);
}
@keyframes bs-attn-spot {
  0%, 100% { transform: scale(0.7); opacity: 0.4; }
  35%      { transform: scale(1.25); opacity: 1; }
  70%      { transform: scale(1.0); opacity: 0.8; }
}

/* ===== Speaker control selectors ===== */
.bs-attn-controls {
  display: flex;
  gap: 12px;
  align-items: center;
}
.bs-attn-controls .attn-seg {
  display: inline-flex;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  overflow: hidden;
}
.bs-attn-controls .attn-seg-btn {
  background: rgba(255, 255, 255, 0.08);
  border: none;
  border-right: 1px solid rgba(255, 255, 255, 0.12);
  color: #fff;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.bs-attn-controls .attn-seg-btn:last-child {
  border-right: none;
}
.bs-attn-controls .attn-seg-btn:hover {
  background: rgba(255, 255, 255, 0.18);
}
.bs-attn-controls .attn-seg-btn.active {
  background: #ff8c1a;
  color: #1a1205;
  font-weight: 600;
}
```

- [ ] **Step 2: 提交**

```bash
git add public/attention.css
git commit -m "feat(attention): marker layer + ping/ripple/spotlight styles"
```

---

## Task 3: 渲染逻辑 `renderAt`（TDD，jsdom）

**Files:**
- Modify: `public/attention.js`（在颜色 `Exports` 段之前插入渲染段；并把 `renderAt` 加入导出）
- Create: `tests/attention-dom.test.js`

**Interfaces:**
- Consumes: `pickAccent`（Task 1）。
- Produces:
  - `renderAt({ xPct:number, yPct:number, effect:string, accent:string, core:string }): void` —— 在 `#bs-attention-layer` 内落点创建 `.bs-attn.bs-attn--<effect>`，设置内联 `left/top` 与 `--accent/--core`，1.5s 后自动移除。
  - `createLayer(): HTMLElement` —— 幂等创建 `#bs-attention-layer`。
  - `innerHtmlFor(effect): string` —— 返回该动效的子元素 HTML。

- [ ] **Step 1: 写失败测试** — 创建 `tests/attention-dom.test.js`：

```js
/**
 * @jest-environment jsdom
 */
const { renderAt } = require('../public/attention');

beforeEach(() => {
  document.body.innerHTML = '';
  jest.useFakeTimers();
});

describe('renderAt', () => {
  test('creates layer + ping marker at point', () => {
    renderAt({ xPct: 50, yPct: 50, effect: 'ping', accent: '#ff8c1a', core: '#ffffff' });
    const layer = document.getElementById('bs-attention-layer');
    expect(layer).not.toBeNull();
    const marker = layer.querySelector('.bs-attn--ping');
    expect(marker).not.toBeNull();
    expect(marker.style.left).toBe('50%');
    expect(marker.style.top).toBe('50%');
    expect(marker.querySelectorAll('.bs-attn__core')).toHaveLength(1);
    expect(marker.querySelectorAll('.bs-attn__ring')).toHaveLength(2);
  });

  test('ripple has 3 rings', () => {
    renderAt({ xPct: 10, yPct: 20, effect: 'ripple', accent: '#16c2ff', core: '#06314a' });
    const marker = document.querySelector('.bs-attn--ripple');
    expect(marker.querySelectorAll('.bs-attn__ring')).toHaveLength(3);
  });

  test('auto-removes after 1.5s', () => {
    renderAt({ xPct: 50, yPct: 50, effect: 'ping', accent: '#ff8c1a', core: '#ffffff' });
    expect(document.querySelector('.bs-attn')).not.toBeNull();
    jest.advanceTimersByTime(1600);
    expect(document.querySelector('.bs-attn')).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `npm test -- attention-dom.test.js`
  Expected: FAIL（`renderAt` 不是导出函数 / undefined）。

- [ ] **Step 3: 实现** — 在 `public/attention.js` 的 `/* ============ Exports ============ */` 段**之前**插入：

```js
  /* ============ Rendering (DOM) ============ */

  function createLayer() {
    var layer = document.getElementById('bs-attention-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'bs-attention-layer';
      document.body.appendChild(layer);
    }
    return layer;
  }

  function innerHtmlFor(effect) {
    if (effect === 'spotlight') {
      return '<span class="bs-attn__glow"></span><span class="bs-attn__dot"></span>';
    }
    if (effect === 'ripple') {
      return '<span class="bs-attn__core"></span>' +
        '<span class="bs-attn__ring" style="animation-delay:0s"></span>' +
        '<span class="bs-attn__ring" style="animation-delay:.35s"></span>' +
        '<span class="bs-attn__ring" style="animation-delay:.7s"></span>';
    }
    // ping (default)
    return '<span class="bs-attn__core"></span>' +
      '<span class="bs-attn__ring" style="animation-delay:0s"></span>' +
      '<span class="bs-attn__ring" style="animation-delay:.5s"></span>';
  }

  function renderAt(opts) {
    var layer = createLayer();
    var wrap = document.createElement('div');
    wrap.className = 'bs-attn bs-attn--' + opts.effect;
    wrap.style.left = opts.xPct + '%';
    wrap.style.top = opts.yPct + '%';
    wrap.style.setProperty('--accent', opts.accent);
    wrap.style.setProperty('--core', opts.core);
    wrap.innerHTML = innerHtmlFor(opts.effect);
    layer.appendChild(wrap);
    setTimeout(function () {
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    }, 1500);
  }

```

  并把 `module.exports` 更新为（新增 `renderAt`）：

```js
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      pickAccent: pickAccent,
      relativeLuminance: relativeLuminance,
      hueDistance: hueDistance,
      hexToRgb: hexToRgb,
      renderAt: renderAt
    };
  }
```

- [ ] **Step 4: 跑测试确认通过** — Run: `npm test -- attention-dom.test.js`
  Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add public/attention.js tests/attention-dom.test.js
git commit -m "feat(attention): renderAt layer + effect markup, auto-clear"
```

---

## Task 4: 取色 + Socket 接线 + 双击触发（部分 TDD）

**Files:**
- Modify: `public/attention.js`（新增 `state`、`uuid`、`sampleBgRgb`、`init`、`bindDblclick`；新增浏览器 bootstrap 段；导出新增 `sampleBgRgb`）

**Interfaces:**
- Consumes: `renderAt`、`pickAccent`（前序任务）；`window._danmakuSocket`、`window.BS_ROLE`（运行时注入）。
- Produces:
  - `sampleBgRgb(xPct, yPct): [number,number,number] | null` —— `elementFromPoint` 向上找首个不透明 `background-color`；找不到回退 `.slide.is-active`；再找不到返回 `null`。
  - `init(socket): void` —— 注册 `attention:ping` 接收（去重→取色→`pickAccent`→`renderAt`）；演讲者额外绑定双击。
  - `bindDblclick(socket): void` —— 双击忽略 UI 区，算百分比，取色，发 `attention:ping`。
  - 模块内 `state = { effect:'ping', colorMode:'auto' }`（供 Task 5 UI 读写）。

- [ ] **Step 1: 写失败测试** — 在 `tests/attention-dom.test.js` 顶部 require 处新增 `sampleBgRgb`，并追加测试块：

```js
const { renderAt, sampleBgRgb } = require('../public/attention');
```

  在文件末尾追加：

```js
describe('sampleBgRgb', () => {
  test('returns null when nothing opaque found (empty jsdom)', () => {
    expect(sampleBgRgb(50, 50)).toBeNull();
  });

  test('reads opaque inline background at the point', () => {
    const el = document.createElement('div');
    el.style.backgroundColor = 'rgb(255, 140, 26)';
    document.body.appendChild(el);
    const real = document.elementFromPoint;
    document.elementFromPoint = () => el;
    try {
      expect(sampleBgRgb(50, 50)).toEqual([255, 140, 26]);
    } finally {
      document.elementFromPoint = real;
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `npm test -- attention-dom.test.js`
  Expected: FAIL（`sampleBgRgb` 未导出 / undefined）。

- [ ] **Step 3: 实现** — 在 `public/attention.js` 的 Rendering 段之后、Exports 段之前插入：

```js
  /* ============ Background sampling + socket wiring ============ */

  var state = { effect: 'ping', colorMode: 'auto' };
  var seen = new Set();
  var IGNORE_SELECTOR =
    '#speaker-controls,#speaker-controls-trigger,#side-panel,#mobile-fab,' +
    '#mobile-drawer,#drawer-overlay,#share-modal,#danmaku-layer';

  function uuid() {
    return 'a-' + Date.now().toString(36) + '-' +
      Math.random().toString(36).slice(2, 8);
  }

  function readBg(el) {
    var bg = getComputedStyle(el).backgroundColor;
    var m = bg.match(/[\d.]+/g);
    if (!m) return null;
    var a = m.length >= 4 ? parseFloat(m[3]) : 1;
    if (a < 0.9) return null;            // 半透明 → 继续向上
    return [parseInt(m[0], 10), parseInt(m[1], 10), parseInt(m[2], 10)];
  }

  function sampleBgRgb(xPct, yPct) {
    var x = Math.round(xPct / 100 * window.innerWidth);
    var y = Math.round(yPct / 100 * window.innerHeight);
    var el = (typeof document.elementFromPoint === 'function')
      ? document.elementFromPoint(x, y) : null;
    while (el) {
      var c = readBg(el);
      if (c) return c;
      el = el.parentElement;
    }
    var slide = document.querySelector('.slide.is-active');
    if (slide) {
      var sc = readBg(slide);
      if (sc) return sc;
    }
    return null;
  }

  function bindDblclick(socket) {
    document.addEventListener('dblclick', function (e) {
      if (e.target && e.target.closest && e.target.closest(IGNORE_SELECTOR)) return;
      var xPct = e.clientX / window.innerWidth * 100;
      var yPct = e.clientY / window.innerHeight * 100;
      socket.emit('attention:ping', {
        id: uuid(),
        xPct: xPct,
        yPct: yPct,
        effect: state.effect,
        colorMode: state.colorMode,
        bgRgb: sampleBgRgb(xPct, yPct) || [17, 17, 24]
      });
    });
  }

  function init(socket) {
    socket.on('attention:ping', function (msg) {
      if (!msg || typeof msg.id === 'undefined') return;
      if (seen.has(msg.id)) return;
      seen.add(msg.id);
      var bgRgb = sampleBgRgb(msg.xPct, msg.yPct) || msg.bgRgb || [17, 17, 24];
      var picked = pickAccent(bgRgb, msg.colorMode || 'auto');
      renderAt({
        xPct: msg.xPct,
        yPct: msg.yPct,
        effect: msg.effect || 'ping',
        accent: picked.accent,
        core: picked.core
      });
    });
    if (window.BS_ROLE === 'speaker') {
      bindDblclick(socket);
    }
  }

```

  在 Exports 段的 `module.exports` 中新增 `sampleBgRgb`：

```js
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      pickAccent: pickAccent,
      relativeLuminance: relativeLuminance,
      hueDistance: hueDistance,
      hexToRgb: hexToRgb,
      renderAt: renderAt,
      sampleBgRgb: sampleBgRgb
    };
  }
```

  并在 Exports 段**之后**（IIFE 闭合 `})();` 之前）新增浏览器 bootstrap：

```js
  /* ============ Browser bootstrap ============ */
  if (typeof window !== 'undefined') {
    window.BS_Attention = {
      pickAccent: pickAccent,
      renderAt: renderAt,
      init: init
    };
    var _poll = setInterval(function () {
      if (window._danmakuSocket) {
        clearInterval(_poll);
        init(window._danmakuSocket);
      }
    }, 100);
    setTimeout(function () { clearInterval(_poll); }, 10000);
  }
```

- [ ] **Step 4: 跑测试确认通过** — Run: `npm test -- attention-dom.test.js`
  Expected: PASS（含新增 `sampleBgRgb` 用例；jsdom 下 `elementFromPoint` 默认返回 null → 第一个用例返回 null；第二个用例 stub 后返回解析值）。

- [ ] **Step 5: 提交**

```bash
git add public/attention.js tests/attention-dom.test.js
git commit -m "feat(attention): bg sampling, socket wiring, dblclick trigger"
```

---

## Task 5: 演讲者控制栏选择器（TDD，jsdom）

**Files:**
- Modify: `public/attention.js`（新增 `getState`/`setEffect`/`setColorMode`/`initSpeakerUI`；导出新增 `initSpeakerUI`/`getState`；`window.BS_Attention` 新增 `initSpeakerUI`）

**Interfaces:**
- Consumes: 模块内 `state`（Task 4）。
- Produces:
  - `getState(): { effect:string, colorMode:string }`。
  - `initSpeakerUI(container: HTMLElement): HTMLElement` —— 往 `#speaker-controls` 追加「动效」「颜色」两组分段按钮，点击更新 `state` 并切换 `.active`；返回新增的 `.bs-attn-controls` 元素。

- [ ] **Step 1: 写失败测试** — 在 `tests/attention-dom.test.js` 的 require 行新增 `initSpeakerUI, getState`：

```js
const { renderAt, sampleBgRgb, initSpeakerUI, getState } = require('../public/attention');
```

  文件末尾追加：

```js
describe('initSpeakerUI', () => {
  test('defaults are ping / auto', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    initSpeakerUI(container);
    expect(getState().effect).toBe('ping');
    expect(getState().colorMode).toBe('auto');
  });

  test('clicking 波纹 sets effect to ripple', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    initSpeakerUI(container);
    const rippleBtn = container.querySelector('.attn-seg[data-kind="effect"] .attn-seg-btn[data-v="ripple"]');
    rippleBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(getState().effect).toBe('ripple');
  });

  test('clicking 暖 sets colorMode to warm', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    initSpeakerUI(container);
    const warmBtn = container.querySelector('.attn-seg[data-kind="colorMode"] .attn-seg-btn[data-v="warm"]');
    warmBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(getState().colorMode).toBe('warm');
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `npm test -- attention-dom.test.js`
  Expected: FAIL（`initSpeakerUI`/`getState` 未导出）。

- [ ] **Step 3: 实现** — 在 `public/attention.js` 的「Background sampling + socket wiring」段之后、Exports 段之前插入：

```js
  /* ============ Speaker UI ============ */

  function getState() {
    return { effect: state.effect, colorMode: state.colorMode };
  }

  function selectBtn(group, kind, value) {
    var seg = group.querySelector('.attn-seg[data-kind="' + kind + '"]');
    if (!seg) return;
    seg.querySelectorAll('.attn-seg-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-v') === value);
    });
  }

  function initSpeakerUI(container) {
    var group = document.createElement('div');
    group.className = 'control-group bs-attn-controls';
    group.innerHTML =
      '<div class="attn-seg" data-kind="effect">' +
        '<button type="button" class="attn-seg-btn" data-v="ping">脉冲</button>' +
        '<button type="button" class="attn-seg-btn" data-v="ripple">波纹</button>' +
        '<button type="button" class="attn-seg-btn" data-v="spotlight">聚光</button>' +
      '</div>' +
      '<div class="attn-seg" data-kind="colorMode">' +
        '<button type="button" class="attn-seg-btn" data-v="auto">自动</button>' +
        '<button type="button" class="attn-seg-btn" data-v="warm">暖</button>' +
        '<button type="button" class="attn-seg-btn" data-v="cool">冷</button>' +
        '<button type="button" class="attn-seg-btn" data-v="hc">黑白</button>' +
      '</div>';
    container.appendChild(group);
    selectBtn(group, 'effect', state.effect);
    selectBtn(group, 'colorMode', state.colorMode);
    group.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('.attn-seg-btn');
      if (!btn) return;
      var seg = btn.closest('.attn-seg');
      var kind = seg.getAttribute('data-kind');
      var v = btn.getAttribute('data-v');
      if (kind === 'effect') state.effect = v;
      else state.colorMode = v;
      selectBtn(group, kind, v);
    });
    return group;
  }

```

  把 `module.exports` 更新为（新增 `initSpeakerUI`、`getState`）：

```js
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      pickAccent: pickAccent,
      relativeLuminance: relativeLuminance,
      hueDistance: hueDistance,
      hexToRgb: hexToRgb,
      renderAt: renderAt,
      sampleBgRgb: sampleBgRgb,
      initSpeakerUI: initSpeakerUI,
      getState: getState
    };
  }
```

  把 `window.BS_Attention` 更新为（新增 `initSpeakerUI`）：

```js
    window.BS_Attention = {
      pickAccent: pickAccent,
      renderAt: renderAt,
      initSpeakerUI: initSpeakerUI,
      init: init
    };
```

- [ ] **Step 4: 跑测试确认通过** — Run: `npm test -- attention-dom.test.js`
  Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add public/attention.js tests/attention-dom.test.js
git commit -m "feat(attention): speaker effect/color selectors + state"
```

---

## Task 6: 注入到 HTML（TDD）

**Files:**
- Modify: `lib/html-injector.js`
- Modify: `tests/html-injector.test.js`

**Interfaces:**
- Consumes: `public/attention.css`、`public/attention.js`（Task 1/2 已创建文件）。
- Produces: 所有角色的注入 HTML 在 `</head>` 前含 `<link ... href="/public/attention.css">`，在 `</body>` 前含 `<script src="/public/attention.js"></script>`。

- [ ] **Step 1: 写失败测试** — 在 `tests/html-injector.test.js` 的 `describe('injectHtml', ...)` 内追加：

```js
  test('injects attention css and script for all roles', () => {
    const result = injectHtml(sampleHtml, 'audience', 'http://localhost:3000');
    expect(result).toContain('<link rel="stylesheet" href="/public/attention.css">');
    expect(result.indexOf('attention.css')).toBeLessThan(result.indexOf('</head>'));
    expect(result).toContain('/public/attention.js');
    expect(result.indexOf('/public/attention.js')).toBeLessThan(result.indexOf('</body>'));
  });
```

- [ ] **Step 2: 跑测试确认失败** — Run: `npm test -- html-injector.test.js`
  Expected: FAIL（注入 HTML 不含 attention 资源）。

- [ ] **Step 3: 实现** — 在 `lib/html-injector.js` 中：

  把
  ```js
  const css = `<link rel="stylesheet" href="/public/danmaku.css">`;
  ```
  改为
  ```js
  const css = `<link rel="stylesheet" href="/public/danmaku.css">\n  <link rel="stylesheet" href="/public/attention.css">`;
  ```

  把 `const script = configScript + animSyncScripts + ...` 中、`<script src="/public/slide-sync.js"></script>` **之后**、`<script src="/public/audience-panel.js"></script>` **之前**插入一行：

  ```js
      <script src="/public/attention.js"></script>
  ```

  即 `script` 变为：
  ```js
  const script = configScript + animSyncScripts + `
    <script src="/socket.io/socket.io.js"></script>
    <script src="/public/danmaku-renderer.js"></script>
    <script src="/public/slide-sync.js"></script>
    <script src="/public/attention.js"></script>
    <script src="/public/audience-panel.js"></script>
    <script src="/public/moderator-panel.js"></script>
  `;
  ```

- [ ] **Step 4: 跑测试确认通过** — Run: `npm test -- html-injector.test.js`
  Expected: PASS（含新增用例）。

- [ ] **Step 5: 提交**

```bash
git add lib/html-injector.js tests/html-injector.test.js
git commit -m "feat(injector): inject attention css/js for all roles"
```

---

## Task 7: 服务端 `attention:ping` 通道

**Files:**
- Modify: `server.js`

**Interfaces:**
- Consumes: 现有 `socket.data.role`（角色校验）。
- Produces: 监听 speaker 的 `attention:ping` 并 `io.emit('attention:ping', msg)` 给全员（含演讲者）。

> 说明：`server.js` 现无单测（仓库既有约定）；本任务靠 Task 9 的端到端手动验证覆盖。

- [ ] **Step 1: 实现** — 在 `server.js` 的 `io.on('connection', ...)` 内，紧接现有 `bs:anim:trigger` 处理块（即 `socket.on('bs:anim:trigger', ...)` 的闭合之后）插入：

```js
  // Attention marker broadcast (speaker -> all, incl. speaker echo)
  socket.on('attention:ping', (msg) => {
    if (socket.data.role !== 'speaker') return;
    if (!msg || typeof msg.xPct !== 'number' || typeof msg.yPct !== 'number') return;
    io.emit('attention:ping', msg);
  });
```

- [ ] **Step 2: 提交**

```bash
git add server.js
git commit -m "feat(server): broadcast attention:ping from speaker to all"
```

---

## Task 8: 演讲者控制栏挂载选择器

**Files:**
- Modify: `public/danmaku-renderer.js`

**Interfaces:**
- Consumes: `window.BS_Attention.initSpeakerUI`（Task 5），`#speaker-controls` 元素。
- Produces: 演讲者控制栏出现「动效」「颜色」两组选择器。

- [ ] **Step 1: 实现** — 在 `public/danmaku-renderer.js` 的 `initSpeakerControls()` 中，紧接 `document.body.appendChild(controls);` 之后插入一行：

```js
    if (window.BS_Attention && typeof window.BS_Attention.initSpeakerUI === 'function') {
      window.BS_Attention.initSpeakerUI(controls);
    }
```

  （该行位于 `document.body.appendChild(controls);` 与 `// Bottom hover trigger zone` 注释之间。）

- [ ] **Step 2: 提交**

```bash
git add public/danmaku-renderer.js
git commit -m "feat(speaker): mount attention effect/color selectors"
```

---

## Task 9: 端到端手动验证

**Files:** 无（验证 only）。

- [ ] **Step 1: 全量单测** — Run: `npm test`
  Expected: 全部 PASS（含 `attention.test.js`、`attention-dom.test.js`、`html-injector.test.js` 及既有用例）。

- [ ] **Step 2: 启动服务** — Run: `node server.js examples/html-ppt-test.html`
  按控制台输出的链接，分别打开「演讲者」与「观众」页。

- [ ] **Step 3: 基础同步** — 演讲者双击幻灯片不同位置：确认演讲者本机与观众页在同一落点出现脉冲圈，约 1.5s 后消失。

- [ ] **Step 4: 三种动效** — 演讲者控制栏切换「脉冲/波纹/聚光」后双击，确认三种样式都能正确播放。

- [ ] **Step 5: 颜色自适应** — 在深色、浅色、橙色、蓝色等不同底色的幻灯片上双击，确认颜色自动取高对比色且不与底色相近（橙底应切到冷色）。

- [ ] **Step 6: 颜色模板** — 切换「暖/冷/黑白」，确认覆盖生效（黑白模式在浅底显示深色、深底显示浅色）。

- [ ] **Step 7: 忽略区** — 双击控制栏、弹幕面板区域，确认不触发动效。

- [ ] **Step 8: 与弹幕暂停独立** — 演讲者点「暂停」弹幕后双击，确认注意力动效仍正常播放。

- [ ] **Step 9: dblclick 冲突核查** — 确认 html-ppt runtime 未把双击占用为其它功能（如全屏切换）。若发现冲突，回到 Task 4 把 `bindDblclick` 的监听收窄到 `.slide` 内（`if (!e.target.closest('.slide')) return;`）。

---

## Self-Review（写完计划后的自查记录）

- **Spec 覆盖**：
  - 触发与同步 → Task 4（双击/emit/init）、Task 7（服务端）。
  - 三种动效 → Task 2（CSS）、Task 3（`innerHtmlFor`）。
  - 颜色自适应 + 模板 → Task 1（`pickAccent`）、Task 4（取色）。
  - 控制栏 UI → Task 5、Task 8。
  - 注入 → Task 6。
  - 边界（忽略区、取色失准兜底、去重、坐标百分比、与弹幕暂停独立）→ Task 4 + Task 9。
  - 单测 `pickAccent` → Task 1；手动验证 → Task 9。
- **占位符扫描**：无 TBD/TODO；每个代码步骤都给了完整代码。
- **类型/命名一致性**：`renderAt` / `sampleBgRgb` / `initSpeakerUI` / `getState` / `pickAccent` / `init` 在各任务间签名一致；CSS class（`bs-attn`、`bs-attn--ping/ripple/spotlight`、`bs-attn__core/ring/glow/dot`、`bs-attn-controls`、`attn-seg`、`attn-seg-btn`）与 JS 生成的 markup 一致；事件名 `attention:ping`、payload 字段 `id/xPct/yPct/effect/colorMode/bgRgb` 在前后端一致。

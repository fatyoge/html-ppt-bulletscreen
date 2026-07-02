# 弹幕优化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现三个弹幕优化：屏幕上方区域可控的随机轨道、观众默认颜色随机、观众面板 Emoji 选择器。

**Architecture:** 在现有控制状态（`speed`、`density`）中新增 `topRatio`，由服务端 `SlideSync` 维护并通过 Socket.IO 同步；渲染器根据 `topRatio` 计算可用轨道数并在其中随机选择；观众面板初始化时随机预设颜色并增加 Emoji 按钮/面板。

**Tech Stack:** Node.js, Express, Socket.IO, Vanilla JS (IIFE), CSS, Jest

---

## 文件结构

| 文件 | 操作 | 说明 |
|------|------|------|
| `lib/slide-sync.js` | 修改 | 控制状态新增 `topRatio` |
| `tests/slide-sync.test.js` | 修改 | 补充 `topRatio` 相关测试 |
| `server.js` | 修改 | 处理 `control:topRatio` 事件 |
| `public/danmaku-renderer.js` | 修改 | 应用 `topRatio`、随机选轨道、新增演讲者“高度”滑块 |
| `public/audience-panel.js` | 修改 | 默认颜色随机 + Emoji 选择器 |
| `public/danmaku.css` | 修改 | Emoji 面板样式 |

---

## Task 1: 服务端控制状态增加 `topRatio`

**Files:**
- Modify: `lib/slide-sync.js:5-9`
- Modify: `lib/slide-sync.js:46-50`
- Test: `tests/slide-sync.test.js:57-66`

- [ ] **Step 1: 修改 `SlideSync` 默认控制状态**

```javascript
    this._controlState = {
      paused: false,
      speed: 1.0,
      density: 5,
      topRatio: 0.3
    };
```

- [ ] **Step 2: 修改 `setControlState` 支持 `topRatio`**

```javascript
    if (state.topRatio !== undefined) this._controlState.topRatio = state.topRatio;
```

- [ ] **Step 3: 更新现有测试断言**

将 `tests/slide-sync.test.js` 中：

```javascript
  test('getControlState returns default values', () => {
    const state = sync.getControlState();
    expect(state).toEqual({ paused: false, speed: 1.0, density: 5 });
  });

  test('setControlState updates state', () => {
    sync.setControlState({ paused: true, speed: 2.0, density: 8 });
    const state = sync.getControlState();
    expect(state).toEqual({ paused: true, speed: 2.0, density: 8 });
  });
```

改为：

```javascript
  test('getControlState returns default values', () => {
    const state = sync.getControlState();
    expect(state).toEqual({ paused: false, speed: 1.0, density: 5, topRatio: 0.3 });
  });

  test('setControlState updates state', () => {
    sync.setControlState({ paused: true, speed: 2.0, density: 8, topRatio: 0.5 });
    const state = sync.getControlState();
    expect(state).toEqual({ paused: true, speed: 2.0, density: 8, topRatio: 0.5 });
  });
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx jest tests/slide-sync.test.js
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add lib/slide-sync.js tests/slide-sync.test.js
git commit -m "feat: add topRatio to control state"
```

---

## Task 2: 服务端处理 `control:topRatio` 事件

**Files:**
- Modify: `server.js:240-244` 之后

- [ ] **Step 1: 在 `server.js` 中新增事件处理**

在 `control:density` 事件处理之后、`// Disconnect` 注释之前插入：

```javascript
  socket.on('control:topRatio', ({ topRatio }) => {
    if (socket.data.role !== 'speaker') return;
    const clamped = Math.max(0.1, Math.min(1.0, parseFloat(topRatio) || 0.3));
    slideSync.setControlState({ topRatio: clamped });
    io.emit('control:topRatio', { topRatio: clamped });
  });
```

- [ ] **Step 2: 提交**

```bash
git add server.js
git commit -m "feat: server handles control:topRatio event"
```

---

## Task 3: 演讲者控制栏新增“高度”滑块

**Files:**
- Modify: `public/danmaku-renderer.js` 中的 `initSpeakerControls()` 函数

- [ ] **Step 1: 在控制栏 HTML 中新增高度滑块**

找到 `controls.innerHTML` 中密度滑块的末尾，在其后新增一个控制组：

```html
      <div class="control-group">
        <label>高度</label>
        <input type="range" id="top-ratio-slider" min="10" max="100" step="10" value="30">
        <span id="top-ratio-val">30%</span>
      </div>
```

完整 `controls.innerHTML` 应变为：

```javascript
    controls.innerHTML = `
      <button id="btn-clear">清空</button>
      <button id="btn-pause">暂停</button>
      <div class="control-group">
        <label>速度</label>
        <input type="range" id="speed-slider" min="0.5" max="3" step="0.1" value="1">
        <span id="speed-val">1.0x</span>
      </div>
      <div class="control-group">
        <label>密度</label>
        <input type="range" id="density-slider" min="1" max="10" step="1" value="5">
        <span id="density-val">5</span>
      </div>
      <div class="control-group">
        <label>高度</label>
        <input type="range" id="top-ratio-slider" min="10" max="100" step="10" value="30">
        <span id="top-ratio-val">30%</span>
      </div>
    `;
```

- [ ] **Step 2: 绑定高度滑块事件**

在密度滑块事件绑定之后插入：

```javascript
    const topRatioSlider = document.getElementById('top-ratio-slider');
    topRatioSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      document.getElementById('top-ratio-val').textContent = val + '%';
      socket.emit('control:topRatio', { topRatio: val / 100 });
    });
```

- [ ] **Step 3: 提交**

```bash
git add public/danmaku-renderer.js
git commit -m "feat: speaker height slider for topRatio"
```

---

## Task 4: 渲染器应用 `topRatio` 并在可用轨道中随机选择

**Files:**
- Modify: `public/danmaku-renderer.js`

- [ ] **Step 1: 新增 `topRatio` 状态变量和随机轨道辅助函数**

在文件顶部变量声明区（`let pendingDanmaku = [];` 之后）新增：

```javascript
  let topRatio = 0.3;

  function getUsableTrackCount() {
    return Math.max(1, Math.floor(TRACK_COUNT * topRatio));
  }

  function getRandomUsableTrack() {
    const usableCount = getUsableTrackCount();
    return Math.floor(Math.random() * usableCount);
  }
```

- [ ] **Step 2: 监听 `control:topRatio` 事件**

在 `connectSocket()` 中 `control:density` 监听器之后插入：

```javascript
    socket.on('control:topRatio', ({ topRatio: ratio }) => {
      topRatio = Math.max(0.1, Math.min(1.0, parseFloat(ratio) || 0.3));
    });
```

- [ ] **Step 3: 在 `control:state` 初始化中同步 `topRatio`**

将：

```javascript
    socket.on('control:state', (state) => {
      isPaused = state.paused;
      speedMultiplier = state.speed;
      maxConcurrent = state.density;
    });
```

改为：

```javascript
    socket.on('control:state', (state) => {
      isPaused = state.paused;
      speedMultiplier = state.speed;
      maxConcurrent = state.density;
      if (state.topRatio !== undefined) {
        topRatio = Math.max(0.1, Math.min(1.0, parseFloat(state.topRatio) || 0.3));
      }
    });
```

- [ ] **Step 4: 修改 `findAvailableTrack` 为可用轨道内随机查找**

将：

```javascript
  function findAvailableTrack() {
    const now = performance.now();
    for (let i = 0; i < TRACK_COUNT; i++) {
      if (now >= tracks[i].busyUntil) {
        return i;
      }
    }
    return -1;
  }
```

改为：

```javascript
  function findAvailableTrack() {
    const now = performance.now();
    const usableCount = getUsableTrackCount();
    const available = [];
    for (let i = 0; i < usableCount; i++) {
      if (now >= tracks[i].busyUntil) {
        available.push(i);
      }
    }
    if (available.length === 0) return -1;
    const randomIndex = Math.floor(Math.random() * available.length);
    return available[randomIndex];
  }
```

- [ ] **Step 5: 提交**

```bash
git add public/danmaku-renderer.js
git commit -m "feat: apply topRatio and randomize track selection"
```

---

## Task 5: 观众面板默认颜色随机

**Files:**
- Modify: `public/audience-panel.js:114`

- [ ] **Step 1: 将默认颜色改为随机预设**

将：

```javascript
      let selectedColor = COLORS[0].value;
```

改为：

```javascript
      let selectedColor = COLORS[Math.floor(Math.random() * COLORS.length)].value;
```

- [ ] **Step 2: 提交**

```bash
git add public/audience-panel.js
git commit -m "feat: random default color for audience panel"
```

---

## Task 6: 观众面板增加 Emoji 选择器

**Files:**
- Modify: `public/audience-panel.js`

- [ ] **Step 1: 定义常用 Emoji 列表**

在文件顶部 `COLORS` 数组之后新增：

```javascript
  const EMOJIS = ['😀', '😂', '🤔', '👍', '❤️', '🎉', '🔥', '✨', '👏', '🙏', '😭', '😅', '😍', '🤩', '😎', '🤯', '🥳', '👀', '💡', '💯'];
```

- [ ] **Step 2: 在输入区 HTML 中增加 Emoji 按钮和面板**

将 `buildInputArea` 中的 `container.innerHTML` 改为：

```javascript
    container.innerHTML = `
      <textarea id="dm-text" placeholder="输入弹幕内容..." maxlength="100"></textarea>
      <div class="input-tools">
        <button type="button" id="btn-emoji" title="插入表情">😊</button>
        <div class="emoji-picker" id="emoji-picker"></div>
      </div>
      <div class="color-picker" id="color-picker"></div>
      <button id="btn-send">发送</button>
      <div class="send-status" id="send-status"></div>
    `;
```

- [ ] **Step 3: 在 `setTimeout` 回调中绑定 Emoji 面板逻辑**

在 `const textInput = document.getElementById('dm-text');` 之后、`function send() {` 之前插入：

```javascript
      // Emoji picker
      const emojiBtn = document.getElementById('btn-emoji');
      const emojiPicker = document.getElementById('emoji-picker');
      let emojiPickerVisible = false;

      EMOJIS.forEach(emoji => {
        const span = document.createElement('span');
        span.className = 'emoji-option';
        span.textContent = emoji;
        span.addEventListener('click', () => {
          const start = textInput.selectionStart || 0;
          const end = textInput.selectionEnd || 0;
          const value = textInput.value;
          textInput.value = value.slice(0, start) + emoji + value.slice(end);
          textInput.focus();
          const newPos = start + emoji.length;
          textInput.setSelectionRange(newPos, newPos);
        });
        emojiPicker.appendChild(span);
      });

      emojiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        emojiPickerVisible = !emojiPickerVisible;
        emojiPicker.classList.toggle('visible', emojiPickerVisible);
        if (emojiPickerVisible) {
          textInput.focus();
        }
      });

      document.addEventListener('click', (e) => {
        if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) {
          emojiPickerVisible = false;
          emojiPicker.classList.remove('visible');
        }
      });
```

- [ ] **Step 4: 提交**

```bash
git add public/audience-panel.js
git commit -m "feat: emoji picker in audience panel"
```

---

## Task 7: Emoji 选择器样式

**Files:**
- Modify: `public/danmaku.css`

- [ ] **Step 1: 在 `#audience-input` 样式区域新增 Emoji 相关 CSS**

在 `#audience-input .send-status` 样式之后、`/* ===== Moderator Panel ===== */` 之前插入：

```css
#audience-input .input-tools {
  position: relative;
  display: flex;
  align-items: center;
}

#audience-input #btn-emoji {
  background: rgba(255,255,255,0.1);
  border: 1px solid rgba(255,255,255,0.2);
  color: #fff;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
}

#audience-input #btn-emoji:hover {
  background: rgba(255,255,255,0.2);
}

#audience-input .emoji-picker {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  display: none;
  grid-template-columns: repeat(5, 1fr);
  gap: 4px;
  padding: 8px;
  background: rgba(0,0,0,0.85);
  backdrop-filter: blur(10px);
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.15);
  z-index: 10001;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
}

#audience-input .emoji-picker.visible {
  display: grid;
}

#audience-input .emoji-option {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  font-size: 20px;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.15s;
}

#audience-input .emoji-option:hover {
  background: rgba(255,255,255,0.15);
}
```

- [ ] **Step 2: 提交**

```bash
git add public/danmaku.css
git commit -m "style: emoji picker panel styles"
```

---

## Task 8: 全量测试与集成验证

**Files:**
- Run: `npx jest`
- Run: `node server.js examples/test-deck.html`

- [ ] **Step 1: 运行全量单元测试**

```bash
npx jest
```

Expected: All tests pass

- [ ] **Step 2: 启动服务进行手动验证**

```bash
node server.js examples/test-deck.html
```

Expected console output 类似：

```
🎯 弹幕服务器已启动

局域网访问：
  演讲者: http://192.168.x.x:3000/speaker?token=...
  管理者: http://192.168.x.x:3000/moderator
  观众:   http://192.168.x.x:3000/
```

- [ ] **Step 3: 手动验证清单**

1. 打开演讲者页面，确认底部控制栏出现“高度”滑块，默认 30%。
2. 拖动高度滑块到 50%，发送测试弹幕，确认弹幕出现在屏幕上半部分。
3. 打开观众页面，确认默认选中的颜色不是白色（多次刷新观察随机效果）。
4. 点击观众面板的 Emoji 按钮，选择表情插入输入框并发送，确认弹幕正确显示 Emoji。
5. 点击 Emoji 面板外部，确认面板关闭。
6. 打开管理者页面，确认管理者也能看到调整后的弹幕区域（不渲染控制栏，但接收同样的 `control:topRatio` 广播）。

- [ ] **Step 4: 提交**

```bash
git commit -m "chore: verify danmaku optimizations"
```

---

## 自我审查

### 1. Spec 覆盖检查

| Spec 要求 | 对应 Task |
|-----------|-----------|
| 屏幕上方区域可控比例（默认 30%） | Task 1, 2, 3, 4 |
| 该区域内随机选择轨道 | Task 4 |
| 演讲者可调节高度 | Task 2, 3 |
| 观众默认颜色随机 | Task 5 |
| Emoji 选择器 | Task 6, 7 |
| 保留直接输入 Unicode Emoji 能力 | Task 6（不拦截输入） |

**无遗漏。**

### 2. 占位符扫描

- 无 TBD/TODO
- 无模糊描述
- 每个代码步骤包含完整代码片段
- 每个测试包含具体断言

### 3. 类型/命名一致性

- 事件名：`control:topRatio` 在 server.js、speaker-controls.js、danmaku-renderer.js 中一致
- 状态字段：`topRatio` 在 SlideSync 和 renderer 中一致
- 滑块值：客户端发送 `0.1~1.0`，服务端 clamp 到 `[0.1, 1.0]`

**无冲突。**

---

## 执行交接

**计划已完成并保存至 `docs/superpowers/plans/2026-06-21-danmaku-optimizations-plan.md`。两种执行方式：**

**1. Subagent-Driven（推荐）** — 每个 Task 派发给独立子代理，Task 之间我进行审查，快速迭代

**2. Inline Execution** — 在当前会话中使用 executing-plans 顺序执行，批量处理带检查点

**请选择执行方式。**

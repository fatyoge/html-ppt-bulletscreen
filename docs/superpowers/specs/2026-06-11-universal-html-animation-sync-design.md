# 通用 HTML 动画同步设计文档

## 1. 概述

### 1.1 背景

当前 html-ppt-bulletscreen 项目已支持幻灯片切页同步（`slide:go` / `slide:sync`）和特定动画重触发（`data-anim` class 的强制 reflow 重播、`counter` 的 `requestAnimationFrame` 数字动画）。但这些能力都是**硬编码**在 `slide-sync.js` 中的，仅适用于 html-ppt 约定的特定结构。

用户希望将动画同步能力**通用化**，覆盖所有类别的 HTML 动画，使任意 HTML 页面在演讲者/观众模式下都能实现动画触发级同步。

### 1.2 目标

实现一个**通用 HTML 动画触发同步系统**：演讲者端触发的任何支持的动画，能在观众端近似同步地重放。

### 1.3 范围边界

| 类型 | 是否覆盖 | 说明 |
|------|---------|------|
| CSS `@keyframes` Animation | ✅ 核心支持 | 通过 class/style 触发 |
| CSS Transition | ✅ 核心支持 | 属性变化触发 |
| Web Animations API (WAAPI) | ✅ 核心支持 | `element.animate()` |
| SVG CSS 动画 | ✅ 核心支持 | 与 CSS Animation 同一机制 |
| GSAP | ✅ 扩展支持 | 需安装 adapter |
| Anime.js | ✅ 扩展支持 | 需安装 adapter |
| Lottie | ✅ 扩展支持 | 需安装 adapter |
| 声明式标注动画 | ✅ 兜底支持 | `data-bs-sync-anim` 标注 |
| `:hover` / `:focus` 伪类动画 | ⚠️ 不自动覆盖 | 无法自动拦截，但可通过 `data-bs-sync-anim` 声明式标注手动同步 |
| Canvas 2D/3D 动画 | ❌ 不覆盖 | 立即模式渲染，无动画对象 |
| WebGL / Three.js | ❌ 不覆盖 | 同上 |
| 手写 `requestAnimationFrame` 循环 | ❌ 不覆盖 | 状态封闭在闭包中 |
| 帧级 / 进度级同步 | ❌ 不覆盖 | 仅支持触发级（play/pause 不进当前版本） |

### 1.4 关键术语

- **触发级同步**：演讲者端动画被触发时，观众端同步执行相同触发动作，不保证帧级对齐
- **Hook**：对原生 API 或库 API 的拦截封装，用于在调用前后插入同步逻辑
- **Adapter**：为特定动画库（GSAP、Anime.js 等）编写的桥接代码
- **重放（Replay）**：观众端根据收到的同步指令，重新执行对应的动画触发操作

---

## 2. 架构设计

### 2.1 系统组件

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Speaker Browser                               │
│                                                                      │
│  ┌─────────────────┐    ┌──────────────────┐    ┌───────────────┐   │
│  │ Trigger Hook    │───→│ Sync Serializer  │───→│ Socket.IO     │───┼──→ 广播
│  │ Layer           │    │                  │    │ (bs:anim:*)   │   │
│  │                 │    │                  │    │               │   │
│  │ • classList.*   │    │ 生成标准化同步    │    │               │   │
│  │ • style.*       │    │ 指令消息          │    │               │   │
│  │ • animate()     │    │                  │    │               │   │
│  │ • gsap.to()     │    │                  │    │               │   │
│  │ • anime()       │    │                  │    │               │   │
│  │ • lottie.play() │    │                  │    │               │   │
│  └─────────────────┘    └──────────────────┘    └───────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ Declarative Watcher (data-bs-sync-anim)                       │   │
│  │ 监听标注元素的自定义触发事件（hover/click/visible 等）         │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ WebSocket
┌─────────────────────────────────────────────────────────────────────┐
│                    Audience Browser (× N)                            │
│                                                                      │
│  ┌───────────────┐    ┌────────────────────┐    ┌────────────────┐  │
│  │ Socket.IO     │───→│ Animation Replay   │───→│ DOM / WAAPI    │  │
│  │ (bs:anim:*)   │    │ Engine             │    │ / Library API  │  │
│  └───────────────┘    └────────────────────┘    └────────────────┘  │
│                              │                                       │
│                              │ 根据 triggerType 分发到对应 replay   │
│                              │ 处理器：                              │
│                              │ • class-add → remove + reflow + add  │
│                              │ • waapi → element.animate()          │
│                              │ • gsap → gsap.to()                   │
│                              │ • declarative → 预注册 handler       │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 模块职责

| 模块 | 运行端 | 职责 |
|------|--------|------|
| `TriggerHookLayer` | 演讲者 | 拦截 DOM API 和动画库 API 调用，在调用同时广播同步消息 |
| `DeclarativeWatcher` | 演讲者 | 监听 `data-bs-sync-anim` 标注元素的事件，广播同步消息 |
| `SyncSerializer` | 演讲者 | 将拦截到的触发动作编码为标准化的同步消息 |
| `Socket.IO` | 全部 | 复用现有 Socket.IO 连接，新增 `bs:anim:trigger` 命名空间 |
| `AnimationReplayEngine` | 观众 | 接收同步消息，根据类型分发到对应重放处理器 |
| `ReplayHandlers` | 观众 | 各类动画的具体重放逻辑（CSS class、WAAPI、GSAP 等） |
| `LibraryAdapters` | 演讲者 | 为 GSAP、Anime.js、Lottie 等库安装的 hook |

---

## 3. 同步协议

### 3.1 消息格式

所有动画同步消息通过 Socket.IO 事件 `bs:anim:trigger` 发送。

```typescript
interface AnimTriggerMessage {
  /** 消息类型 */
  type: 'bs:anim:trigger';

  /** 唯一标识，用于去重（UUID v4） */
  id: string;

  /** 演讲者端 performance.now()，用于时序参考 */
  timestamp: number;

  /** 触发方式类型 */
  triggerType:
    | 'class-add'
    | 'class-remove'
    | 'class-toggle'
    | 'style-change'
    | 'waapi'
    | 'gsap'
    | 'anime'
    | 'lottie'
    | 'declarative';

  /** 目标元素的稳定 CSS 选择器 */
  selector: string;

  /** 触发参数，根据 triggerType 不同 */
  payload: AnimTriggerPayload;
}

type AnimTriggerPayload =
  | ClassAddPayload
  | ClassRemovePayload
  | ClassTogglePayload
  | StyleChangePayload
  | WAAPIPayload
  | GSAPPayload
  | AnimePayload
  | LottiePayload
  | DeclarativePayload;

interface ClassAddPayload {
  classNames: string[];
}

interface ClassRemovePayload {
  classNames: string[];
}

interface ClassTogglePayload {
  className: string;
  force?: boolean;
}

interface StyleChangePayload {
  property: string;      // e.g. 'opacity', 'transform'
  value: string;         // e.g. '1', 'translateX(100px)'
  prevValue?: string;    // 用于 transition 回退
}

interface WAAPIPayload {
  keyframes: Keyframe[] | PropertyIndexedKeyframes;
  options: KeyframeAnimationOptions;
}

interface GSAPPayload {
  gsapConfig: Record<string, unknown>;
}

interface AnimePayload {
  animeConfig: Record<string, unknown>;
}

interface LottiePayload {
  lottieAction: 'play' | 'pause' | 'stop';
  lottieConfig?: Record<string, unknown>;
}

interface DeclarativePayload {
  animName: string;
  action: 'start' | 'end';
  params?: Record<string, unknown>;
}
```

### 3.2 消息时序

由于采用**触发级同步**（非帧级），消息时序遵循以下原则：

1. 演讲者端在 API 调用**之后**立即发送消息（不等待网络确认）
2. 观众端收到消息后**立即执行**重放
3. 预期延迟 = WebSocket 往返延迟（典型值 10-50ms）
4. 对于触发级同步，此延迟在视觉上是可接受的

---

## 4. 核心模块详细设计

### 4.1 TriggerHookLayer（演讲者端）

#### 4.1.1 设计原则

- **仅在演讲者端运行**：通过 `window.BS_ROLE === 'speaker'` 判断
- **非阻塞**：Hook 内部的发送逻辑是异步的，不影响本地动画执行
- **选择器稳定性**：使用稳定的 CSS 选择器策略（见 4.1.3）

#### 4.1.2 DOM API Hook 实现

```javascript
// classList.add hook
const originalAdd = DOMTokenList.prototype.add;
DOMTokenList.prototype.add = function(...tokens) {
  const element = getElementFromTokenList(this);
  const result = originalAdd.apply(this, tokens);

  if (element && isSpeaker()) {
    broadcastTrigger({
      triggerType: 'class-add',
      selector: getStableSelector(element),
      payload: { classNames: tokens }
    });
  }

  return result;
};

// classList.remove hook
const originalRemove = DOMTokenList.prototype.remove;
DOMTokenList.prototype.remove = function(...tokens) {
  const element = getElementFromTokenList(this);
  const result = originalRemove.apply(this, tokens);

  if (element && isSpeaker()) {
    broadcastTrigger({
      triggerType: 'class-remove',
      selector: getStableSelector(element),
      payload: { classNames: tokens }
    });
  }

  return result;
};

// classList.toggle hook
const originalToggle = DOMTokenList.prototype.toggle;
DOMTokenList.prototype.toggle = function(token, force) {
  const element = getElementFromTokenList(this);
  const result = originalToggle.apply(this, arguments);

  if (element && isSpeaker()) {
    broadcastTrigger({
      triggerType: 'class-toggle',
      selector: getStableSelector(element),
      payload: { className: token, force }
    });
  }

  return result;
};

// WAAPI hook
const originalAnimate = Element.prototype.animate;
Element.prototype.animate = function(keyframes, options) {
  const result = originalAnimate.apply(this, arguments);

  if (isSpeaker()) {
    broadcastTrigger({
      triggerType: 'waapi',
      selector: getStableSelector(this),
      payload: { keyframes, options }
    });
  }

  return result;
};
```

#### 4.1.3 选择器稳定性策略

生成选择器的优先级（从高到低）：

1. `id` 选择器：`'#elementId'`
2. 带 `data-*` 属性的选择器：`'[data-slide="3"] .title'`
3. 结构选择器（nth-child）：`'.slide:nth-child(3) .title'`
4. 类名组合：`.slide.is-active .title`

```javascript
function getStableSelector(element) {
  // 优先使用 id
  if (element.id) {
    return '#' + CSS.escape(element.id);
  }

  // 其次使用 data 属性
  const dataAttr = Array.from(element.attributes)
    .find(attr => attr.name.startsWith('data-') && attr.name !== 'data-anim');
  if (dataAttr) {
    return `[${CSS.escape(dataAttr.name)}="${CSS.escape(dataAttr.value)}"]`;
  }

  // 回退：使用类名 + 结构位置
  return generatePathSelector(element);
}

function generatePathSelector(element) {
  const path = [];
  let current = element;

  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();

    if (current.className) {
      const classes = Array.from(current.classList)
        .filter(c => !c.startsWith('anim-')) // 排除动画类
        .join('.');
      if (classes) selector += '.' + classes;
    }

    // 添加 nth-child 确保唯一性
    const siblings = Array.from(current.parentNode?.children || [])
      .filter(s => s.tagName === current.tagName);
    if (siblings.length > 1) {
      const index = siblings.indexOf(current) + 1;
      selector += `:nth-of-type(${index})`;
    }

    path.unshift(selector);
    current = current.parentNode;
  }

  return path.join(' > ');
}
```

### 4.2 LibraryAdapters（演讲者端）

#### 4.2.1 GSAP Adapter

```javascript
function hookGSAP() {
  if (typeof gsap === 'undefined') return;

  const methodsToHook = ['to', 'from', 'fromTo'];
  methodsToHook.forEach(method => {
    const original = gsap[method];
    gsap[method] = function(targets, ...args) {
      const result = original.apply(this, arguments);

      broadcastTrigger({
        triggerType: 'gsap',
        selector: resolveGSTarget(targets),
        payload: { gsapConfig: args[0], method }
      });

      return result;
    };
  });
}

function resolveGSTarget(targets) {
  // GSAP 支持多种 target 格式：string selector, element, element[]
  if (typeof targets === 'string') return targets;
  if (targets instanceof Element) return getStableSelector(targets);
  if (Array.isArray(targets) && targets[0] instanceof Element) {
    return getStableSelector(targets[0]);
  }
  return '*';
}
```

#### 4.2.2 Anime.js Adapter

```javascript
function hookAnime() {
  if (typeof anime === 'undefined') return;

  const originalAnime = anime;
  window.anime = function(params) {
    const result = originalAnime.apply(this, arguments);

    broadcastTrigger({
      triggerType: 'anime',
      selector: resolveAnimeTarget(params.targets),
      payload: { animeConfig: params }
    });

    return result;
  };
}
```

#### 4.2.3 Lottie Adapter

```javascript
function hookLottie() {
  if (typeof lottie === 'undefined') return;

  const originalLoadAnimation = lottie.loadAnimation;
  lottie.loadAnimation = function(params) {
    const anim = originalLoadAnimation.apply(this, arguments);

    // Hook 实例的播放控制方法
    const actions = ['play', 'pause', 'stop'];
    actions.forEach(action => {
      const original = anim[action];
      anim[action] = function() {
        broadcastTrigger({
          triggerType: 'lottie',
          selector: resolveLottieContainer(params.container),
          payload: { lottieAction: action, lottieConfig: params }
        });
        return original.apply(this, arguments);
      };
    });

    return anim;
  };
}
```

### 4.3 DeclarativeWatcher（演讲者端）

为 Hook 无法覆盖的场景（主要是 `:hover`、`:focus` 等伪类动画）提供声明式标注机制。

#### 4.3.1 标注语法

```html
<!-- hover 触发动画同步 -->
<div data-bs-sync-anim="hover-glow" data-bs-sync-trigger="hover"></div>

<!-- click 触发动画同步 -->
<button data-bs-sync-anim="button-pulse" data-bs-sync-trigger="click"></button>

<!-- 进入视口时触发动画同步 -->
<div data-bs-sync-anim="scroll-reveal" data-bs-sync-trigger="visible"></div>

<!-- 带参数的自定义动画 -->
<div data-bs-sync-anim="custom-fx"
     data-bs-sync-trigger="auto"
     data-bs-sync-params='{"duration": 800, "easing": "ease-out"}'></div>
```

#### 4.3.2 实现

```javascript
function initDeclarativeWatcher() {
  if (!isSpeaker()) return;

  document.querySelectorAll('[data-bs-sync-anim]').forEach(el => {
    const trigger = el.dataset.bsSyncTrigger || 'auto';

    switch (trigger) {
      case 'hover':
        el.addEventListener('mouseenter', () => broadcastDeclarative(el, 'start'));
        el.addEventListener('mouseleave', () => broadcastDeclarative(el, 'end'));
        break;
      case 'click':
        el.addEventListener('click', () => broadcastDeclarative(el, 'start'));
        break;
      case 'visible':
        observeVisible(el);
        break;
      case 'auto':
        // 与 Hook 层协作：如果元素有 data-bs-sync-anim，
        // Hook 层会优先使用 declarative 类型广播
        break;
    }
  });
}

function broadcastDeclarative(el, action) {
  broadcastTrigger({
    triggerType: 'declarative',
    selector: getStableSelector(el),
    payload: {
      animName: el.dataset.bsSyncAnim,
      action,
      params: el.dataset.bsSyncParams ? JSON.parse(el.dataset.bsSyncParams) : undefined
    }
  });
}
```

### 4.4 AnimationReplayEngine（观众端）

```javascript
class AnimationReplayEngine {
  constructor(socket) {
    this.socket = socket;
    this.handlers = new Map([
      ['class-add', this.replayClassAdd.bind(this)],
      ['class-remove', this.replayClassRemove.bind(this)],
      ['class-toggle', this.replayClassToggle.bind(this)],
      ['style-change', this.replayStyleChange.bind(this)],
      ['waapi', this.replayWAAPI.bind(this)],
      ['gsap', this.replayGSAP.bind(this)],
      ['anime', this.replayAnime.bind(this)],
      ['lottie', this.replayLottie.bind(this)],
      ['declarative', this.replayDeclarative.bind(this)]
    ]);

    this.socket.on('bs:anim:trigger', msg => this.handleMessage(msg));
  }

  handleMessage(msg) {
    const handler = this.handlers.get(msg.triggerType);
    if (!handler) {
      console.warn('[BS] Unknown trigger type:', msg.triggerType);
      return;
    }

    const el = document.querySelector(msg.selector);
    if (!el) {
      console.warn('[BS] Animation target not found:', msg.selector);
      return;
    }

    handler(el, msg.payload);
  }

  // --- CSS Class Replay ---
  replayClassAdd(el, payload) {
    // 强制重触发：先移除再添加（触发 reflow）
    el.classList.remove(...payload.classNames);
    void el.offsetWidth; // force reflow
    el.classList.add(...payload.classNames);
  }

  replayClassRemove(el, payload) {
    el.classList.remove(...payload.classNames);
  }

  replayClassToggle(el, payload) {
    el.classList.toggle(payload.className, payload.force);
  }

  // --- Style Replay ---
  replayStyleChange(el, payload) {
    el.style.setProperty(payload.property, payload.value);
  }

  // --- WAAPI Replay ---
  replayWAAPI(el, payload) {
    el.animate(payload.keyframes, payload.options);
  }

  // --- GSAP Replay ---
  replayGSAP(el, payload) {
    if (typeof gsap === 'undefined') {
      console.warn('[BS] GSAP not available on audience side');
      // Fallback：尝试用 WAAPI 模拟（如可能）
      return;
    }
    gsap[payload.method || 'to'](el, payload.gsapConfig);
  }

  // --- Anime.js Replay ---
  replayAnime(el, payload) {
    if (typeof anime === 'undefined') {
      console.warn('[BS] Anime.js not available on audience side');
      return;
    }
    anime({ ...payload.animeConfig, targets: el });
  }

  // --- Lottie Replay ---
  replayLottie(el, payload) {
    // Lottie 实例需要通过 container 查找
    // 简化方案：要求 Lottie 容器有 id 或 data 属性
    const anim = lottie.getRegisteredAnimations()
      .find(a => a.wrapper === el || a.wrapper.contains(el));

    if (anim && payload.lottieAction) {
      anim[payload.lottieAction]();
    }
  }

  // --- Declarative Replay ---
  replayDeclarative(el, payload) {
    const handler = window.BS_DECLARATIVE_HANDLERS?.[payload.animName];
    if (handler) {
      handler(el, payload.action, payload.params);
    } else {
      // 默认行为：假设是 CSS class 动画，action=start 时添加 class
      if (payload.action === 'start') {
        this.replayClassAdd(el, { classNames: [payload.animName] });
      } else {
        this.replayClassRemove(el, { classNames: [payload.animName] });
      }
    }
  }
}
```

---

## 5. 与现有系统集成

### 5.1 文件结构

```
public/
├── danmaku.css                    # 现有
├── danmaku-renderer.js            # 现有
├── slide-sync.js                  # 现有（保留幻灯片同步）
├── audience-panel.js              # 现有
├── moderator-panel.js             # 现有
├── anim-sync/                     # 新增
│   ├── trigger-hook-layer.js      # 演讲者端 Hook 层
│   ├── library-adapters.js        # 动画库 Adapters
│   ├── declarative-watcher.js     # 声明式标注监听
│   ├── sync-serializer.js         # 消息序列化
│   └── replay-engine.js           # 观众端重放引擎
```

### 5.2 注入集成

在 `lib/html-injector.js` 中，将新的动画同步脚本添加到注入列表：

```javascript
const animSyncScripts = [
  '/public/anim-sync/sync-serializer.js',
  '/public/anim-sync/replay-engine.js',
  '/public/anim-sync/trigger-hook-layer.js',
  '/public/anim-sync/library-adapters.js',
  '/public/anim-sync/declarative-watcher.js'
];

// 所有角色都加载 replay-engine（观众需要重放，演讲者也需要处理本地重放场景）
// 演讲者端额外加载 trigger-hook-layer 和 adapters
```

### 5.3 Socket.IO 集成

复用现有的 Socket.IO 连接，新增事件：

- `bs:anim:trigger`：演讲者 → 服务器 → 观众（广播）

服务器端（`server.js`）新增路由：

```javascript
socket.on('bs:anim:trigger', (msg) => {
  // 验证消息格式
  if (!msg || !msg.type || !msg.triggerType || !msg.selector) return;
  // 广播给除发送者外的所有客户端
  socket.broadcast.emit('bs:anim:trigger', msg);
});
```

### 5.4 与幻灯片同步的协作

动画同步与幻灯片同步是**独立的两套系统**：

- `slide:go` 负责幻灯片切页（保持现有行为不变）
- `bs:anim:trigger` 负责页内动画同步（新增）

当 `goToSlide` 触发时，现有的 `data-anim` 重触发逻辑仍然工作。如果页面同时使用了通用动画同步系统，`goToSlide` 中的硬编码重触发可以继续保留作为兼容层，或者逐步迁移到通用系统。

**设计决策**：保留 `slide-sync.js` 中的硬编码重触发逻辑不变，通用动画同步系统作为**增量能力**叠加。这样可以确保向后兼容，不破坏现有 html-ppt 集成。

---

## 6. 弹幕联动设计

虽然核心需求是动画同步，但系统设计预留了与弹幕的联动能力：

### 6.1 动画触发弹幕事件

动画同步系统可以触发弹幕系统的事件，实现场景化效果：

```javascript
// 在 ReplayEngine 中
handleMessage(msg) {
  // ... 原有重放逻辑 ...

  // 触发弹幕联动事件
  window.dispatchEvent(new CustomEvent('bs:anim:triggered', {
    detail: msg
  }));
}
```

### 6.2 弹幕监听动画事件

弹幕渲染器可以监听这些事件，实现如：
- 特定动画触发时，弹幕临时变色
- 动画高潮时增加弹幕密度
- 弹幕跟随动画元素移动（需额外计算）

**范围边界**：本版本不实现具体的弹幕联动效果，仅预留事件接口。具体联动效果在后续版本中按需实现。

---

## 7. 错误处理

### 7.1 选择器失效

当观众端找不到对应元素时（如 DOM 结构不一致）：
- 记录警告日志，跳过该动画
- 不阻塞其他动画的同步

### 7.2 库未加载

当观众端缺少对应的动画库（如 GSAP）时：
- 记录警告日志
- 对于 CSS class 动画，仍可通过 class 重放（无需库）
- 对于 WAAPI，浏览器原生支持，无需额外库

### 7.3 消息去重

使用消息 `id` 字段进行去重，防止网络重传导致动画重复执行：

```javascript
const processedIds = new Set();

handleMessage(msg) {
  if (processedIds.has(msg.id)) return;
  processedIds.add(msg.id);
  // ... 处理消息 ...
}
```

### 7.4 时序错乱

如果消息到达顺序与发送顺序不一致（WebSocket 通常保证顺序，但以防万一）：
- 依赖 `timestamp` 字段，允许接收端按时间排序后执行
- 对于触发级同步，微小的时间差不影响视觉效果

---

## 8. 性能考虑

### 8.1 Hook 开销

DOM API Hook 在每次调用时执行以下操作：
1. 检查 `isSpeaker()`（布尔判断，开销极小）
2. 生成选择器（仅在演讲者端执行）
3. 发送 Socket.IO 消息（异步，不阻塞）

预估开销：每次 DOM 操作增加 < 1ms（主要在生成选择器）。

### 8.2 优化策略

1. **选择器缓存**：对同一元素的选择器结果进行 LRU 缓存
2. **批量发送**：短时间内（如 16ms 内）的多个触发合并为一条消息
3. **节流**：对于高频触发的场景（如 `mousemove` 触发的 style 变化），设置最小间隔

### 8.3 观众端开销

重放引擎仅监听 Socket.IO 消息，无轮询，无持续计算。只在收到消息时执行一次 DOM 操作，开销与正常动画触发相同。

---

## 9. 测试策略

### 9.1 单元测试

| 测试对象 | 测试内容 |
|---------|---------|
| `getStableSelector()` | 各种 DOM 结构下的选择器生成正确性 |
| `SyncSerializer` | 消息格式验证、序列化/反序列化 |
| `ReplayEngine` | 各类 triggerType 的分发和重放逻辑 |
| `LibraryAdapters` | GSAP/Anime/Lottie 的 hook 安装和广播 |

### 9.2 集成测试

| 测试场景 | 验证点 |
|---------|--------|
| CSS Animation 同步 | class-add → 观众端重触发 |
| CSS Transition 同步 | style-change → 观众端属性变化 |
| WAAPI 同步 | element.animate() → 观众端重放 |
| GSAP 同步 | gsap.to() → 观众端重放 |
| 多个动画并发 | 消息顺序、去重、不丢消息 |
| 选择器失效 | 优雅降级，不报错 |

### 9.3 手动测试矩阵

| 动画类型 | 测试页面 | 演讲者触发 | 观众接收 |
|---------|---------|-----------|---------|
| Animate.css class | `examples/animate-test.html` | ✅ | ✅ |
| CSS transition hover→active | `examples/transition-test.html` | ✅ | ✅ |
| WAAPI keyframes | `examples/waapi-test.html` | ✅ | ✅ |
| GSAP timeline | `examples/gsap-test.html` | ✅ | ✅ |
| Lottie JSON | `examples/lottie-test.html` | ✅ | ✅ |
| 声明式标注 | `examples/declarative-test.html` | ✅ | ✅ |

---

## 10. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| Hook 与第三方库冲突 | 高 | 使用原型链备份恢复机制；提供禁用开关 `window.BS_DISABLE_ANIM_SYNC = true` |
| 选择器不稳定导致重放失败 | 中 | 多级选择器策略；提供 `data-bs-sync-id` 手动指定选择器 |
| 消息量过大导致网络拥塞 | 中 | 批量发送 + 节流；仅同步可见区域内的动画 |
| 观众端缺少动画库 | 低 | 优先使用 CSS class/WAAPI（浏览器原生）；对缺失库记录警告 |
| 与现有 slide-sync 冲突 | 低 | 两套系统独立运行；slide-sync 的硬编码逻辑保持不变 |

---

## 11. 未来扩展

本设计为以下扩展预留了接口：

1. **播放控制级同步**（B 方案）：在 TriggerHookLayer 中增加 `pause`/`resume` 拦截
2. **更多动画库**：通过统一的 Adapter 接口，可以轻松增加 Velocity.js、Mo.js 等库的支持
3. **弹幕联动**：通过 `bs:anim:triggered` 自定义事件，实现动画与弹幕的深度联动
4. **自动标注工具**：提供 CLI 工具扫描 HTML 中的动画，自动生成 `data-bs-sync-anim` 标注

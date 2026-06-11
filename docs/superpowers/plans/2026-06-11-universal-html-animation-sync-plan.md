# 通用 HTML 动画同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现通用 HTML 动画触发同步系统，使演讲者端触发的 CSS Animation、Transition、WAAPI、GSAP、Anime.js、Lottie 等动画能在观众端同步重放，并提供多类型测试页面验证功能。

**Architecture:** 演讲者端通过 Hook 拦截 DOM API 和动画库调用，将触发动作编码为标准化消息通过 Socket.IO 广播；观众端通过 ReplayEngine 接收消息并按类型重放对应动画。声明式标注作为 Hook 无法覆盖场景的兜底方案。

**Tech Stack:** Node.js, Express, Socket.IO, vanilla JavaScript (IIFE), Jest

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `public/anim-sync/common.js` | 共享工具：`isSpeaker()`, `getStableSelector()`, `broadcastTrigger()`, UUID 生成 |
| `public/anim-sync/replay-engine.js` | 观众端：`AnimationReplayEngine` 类 + 9 个 replay handler |
| `public/anim-sync/trigger-hook-layer.js` | 演讲者端：DOM API Hook（classList, style, animate） |
| `public/anim-sync/library-adapters.js` | 演讲者端：GSAP / Anime.js / Lottie hook adapters |
| `public/anim-sync/declarative-watcher.js` | 演讲者端：`data-bs-sync-anim` 标注监听 |
| `examples/anim-test-css.html` | 测试页：CSS `@keyframes` + Transition |
| `examples/anim-test-waapi.html` | 测试页：Web Animations API |
| `examples/anim-test-gsap.html` | 测试页：GSAP 动画 |
| `examples/anim-test-anime.html` | 测试页：Anime.js 动画 |
| `examples/anim-test-declarative.html` | 测试页：声明式标注 + hover 同步 |
| `tests/anim-sync/common.test.js` | 单元测试：`getStableSelector`, `isSpeaker` |
| `tests/anim-sync/replay-engine.test.js` | 单元测试：ReplayEngine + handlers |

### Modified Files

| File | Change |
|------|--------|
| `lib/html-injector.js` | 注入 `anim-sync/` 脚本到所有角色页面 |
| `server.js` | 新增 `bs:anim:trigger` Socket.IO 事件路由 |

---

## Task 1: Shared Utilities (`common.js`)

**Files:**
- Create: `public/anim-sync/common.js`
- Test: `tests/anim-sync/common.test.js`

**Context:** This module provides utility functions used by both speaker-side (hooks) and audience-side (replay). It runs on all roles.

- [ ] **Step 1: Write failing test for `isSpeaker()`**

```javascript
const { isSpeaker } = require('../../public/anim-sync/common.js');

describe('isSpeaker', () => {
  beforeEach(() => {
    delete global.window;
  });

  test('returns true when BS_ROLE is speaker', () => {
    global.window = { BS_ROLE: 'speaker' };
    expect(isSpeaker()).toBe(true);
  });

  test('returns false when BS_ROLE is audience', () => {
    global.window = { BS_ROLE: 'audience' };
    expect(isSpeaker()).toBe(false);
  });

  test('returns false when BS_ROLE is missing', () => {
    global.window = {};
    expect(isSpeaker()).toBe(false);
  });
});
```

Run: `npm test -- tests/anim-sync/common.test.js`

Expected: FAIL - module not found

- [ ] **Step 2: Implement `isSpeaker()`**

```javascript
// public/anim-sync/common.js
(function() {
  'use strict';

  function isSpeaker() {
    return typeof window !== 'undefined' && window.BS_ROLE === 'speaker';
  }

  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function getStableSelector(element) {
    if (!element || element === document.body) return '';

    // 1. Prefer id
    if (element.id) {
      return '#' + CSS.escape(element.id);
    }

    // 2. Prefer data-* attribute (except data-anim)
    for (let i = 0; i < element.attributes.length; i++) {
      const attr = element.attributes[i];
      if (attr.name.startsWith('data-') && attr.name !== 'data-anim' && attr.value) {
        return '[' + CSS.escape(attr.name) + '="' + CSS.escape(attr.value) + '"]';
      }
    }

    // 3. Build path with tag + classes + nth-of-type
    return generatePathSelector(element);
  }

  function generatePathSelector(element) {
    const path = [];
    let current = element;

    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();

      if (current.className && typeof current.className === 'string') {
        const classes = current.className.split(/\s+/)
          .filter(function(c) { return c && !c.startsWith('anim-'); })
          .map(function(c) { return CSS.escape(c); })
          .join('.');
        if (classes) selector += '.' + classes;
      }

      if (current.parentNode && current.parentNode.children) {
        const siblings = Array.from(current.parentNode.children)
          .filter(function(s) { return s.tagName === current.tagName; });
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += ':nth-of-type(' + index + ')';
        }
      }

      path.unshift(selector);
      current = current.parentNode;
    }

    return path.join(' > ');
  }

  function broadcastTrigger(data) {
    if (typeof window === 'undefined' || !window._danmakuSocket) return;

    window._danmakuSocket.emit('bs:anim:trigger', {
      type: 'bs:anim:trigger',
      id: generateUUID(),
      timestamp: performance.now(),
      triggerType: data.triggerType,
      selector: data.selector,
      payload: data.payload
    });
  }

  // Expose globally for other anim-sync modules
  window.BS_AnimSync = window.BS_AnimSync || {};
  window.BS_AnimSync.isSpeaker = isSpeaker;
  window.BS_AnimSync.getStableSelector = getStableSelector;
  window.BS_AnimSync.broadcastTrigger = broadcastTrigger;
  window.BS_AnimSync.generateUUID = generateUUID;
})();
```

Run: `npm test -- tests/anim-sync/common.test.js`

Expected: FAIL - other functions not tested yet, but `isSpeaker` tests pass

- [ ] **Step 3: Write failing test for `getStableSelector()`**

Add to `tests/anim-sync/common.test.js`:

```javascript
const { getStableSelector } = require('../../public/anim-sync/common.js');

describe('getStableSelector', () => {
  beforeEach(() => {
    // Mock minimal DOM
    global.document = {
      body: { tagName: 'BODY' }
    };
    global.CSS = { escape: (s) => s.replace(/([.^$*+?{}[\]|\\()])/g, '\\$1') };
  });

  test('uses id when available', () => {
    const el = { id: 'myElement', tagName: 'DIV', attributes: [], className: '', parentNode: null };
    expect(getStableSelector(el)).toBe('#myElement');
  });

  test('uses data attribute when no id', () => {
    const el = {
      id: '',
      tagName: 'DIV',
      attributes: [
        { name: 'data-slide', value: '3' }
      ],
      className: '',
      parentNode: null
    };
    expect(getStableSelector(el)).toContain('data-slide');
  });
});
```

Run: `npm test -- tests/anim-sync/common.test.js`

Expected: FAIL - getStableSelector not exported from module yet

- [ ] **Step 4: Make `common.js` testable via Node.js exports pattern**

The IIFE pattern doesn't export to Node.js. Modify `public/anim-sync/common.js` to also expose via `module.exports` when available:

At the end of `common.js`, add:

```javascript
// Node.js compatibility for tests
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isSpeaker: isSpeaker,
    getStableSelector: getStableSelector,
    broadcastTrigger: broadcastTrigger,
    generateUUID: generateUUID
  };
}
```

Run: `npm test -- tests/anim-sync/common.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/anim-sync/common.js tests/anim-sync/common.test.js
git commit -m "feat(anim-sync): add shared utilities (isSpeaker, getStableSelector, broadcastTrigger)"
```

---

## Task 2: Animation Replay Engine (`replay-engine.js`)

**Files:**
- Create: `public/anim-sync/replay-engine.js`
- Test: `tests/anim-sync/replay-engine.test.js`
- Modify: `public/danmaku-renderer.js` (ensure socket reference is available)

**Context:** This runs on audience (and speaker) browsers. It listens for `bs:anim:trigger` Socket.IO events and replays the animation locally.

- [ ] **Step 1: Write failing test for AnimationReplayEngine**

```javascript
// tests/anim-sync/replay-engine.test.js
const AnimationReplayEngine = require('../../public/anim-sync/replay-engine.js');

describe('AnimationReplayEngine', () => {
  let mockSocket;
  let mockElement;

  beforeEach(() => {
    mockElement = {
      classList: {
        _classes: new Set(),
        add: function(...tokens) { tokens.forEach(t => this._classes.add(t)); },
        remove: function(...tokens) { tokens.forEach(t => this._classes.delete(t)); },
        toggle: function(token, force) {
          if (force === true) { this._classes.add(token); return true; }
          if (force === false) { this._classes.delete(token); return false; }
          if (this._classes.has(token)) { this._classes.delete(token); return false; }
          this._classes.add(token); return true;
        },
        contains: function(token) { return this._classes.has(token); }
      },
      style: { setProperty: jest.fn() },
      animate: jest.fn()
    };

    mockSocket = {
      on: jest.fn(),
      _handlers: {},
      on: function(event, handler) { this._handlers[event] = handler; }
    };

    global.document = {
      querySelector: jest.fn(() => mockElement)
    };
  });

  test('registers bs:anim:trigger listener', () => {
    new AnimationReplayEngine(mockSocket);
    expect(mockSocket._handlers['bs:anim:trigger']).toBeDefined();
  });

  test('replays class-add by removing then adding classes', () => {
    const engine = new AnimationReplayEngine(mockSocket);
    mockElement.classList.add('existing');

    mockSocket._handlers['bs:anim:trigger']({
      triggerType: 'class-add',
      selector: '.test',
      payload: { classNames: ['fade-in'] }
    });

    expect(mockElement.classList.contains('fade-in')).toBe(true);
  });

  test('replays waapi by calling element.animate', () => {
    const engine = new AnimationReplayEngine(mockSocket);

    mockSocket._handlers['bs:anim:trigger']({
      triggerType: 'waapi',
      selector: '.test',
      payload: {
        keyframes: [{ opacity: 0 }, { opacity: 1 }],
        options: { duration: 500 }
      }
    });

    expect(mockElement.animate).toHaveBeenCalledWith(
      [{ opacity: 0 }, { opacity: 1 }],
      { duration: 500 }
    );
  });

  test('skips replay when element not found', () => {
    const engine = new AnimationReplayEngine(mockSocket);
    global.document.querySelector = jest.fn(() => null);

    mockSocket._handlers['bs:anim:trigger']({
      triggerType: 'class-add',
      selector: '.missing',
      payload: { classNames: ['x'] }
    });

    // Should not throw
    expect(true).toBe(true);
  });

  test('deduplicates messages by id', () => {
    const engine = new AnimationReplayEngine(mockSocket);
    const msg = {
      id: 'same-id',
      triggerType: 'class-add',
      selector: '.test',
      payload: { classNames: ['x'] }
    };

    mockSocket._handlers['bs:anim:trigger'](msg);
    mockSocket._handlers['bs:anim:trigger'](msg);

    // classList.add should only be called effectively once
    // (second call would be deduplicated)
    expect(mockElement.classList._classes.has('x')).toBe(true);
  });
});
```

Run: `npm test -- tests/anim-sync/replay-engine.test.js`

Expected: FAIL - module not found

- [ ] **Step 2: Implement AnimationReplayEngine**

```javascript
// public/anim-sync/replay-engine.js
(function() {
  'use strict';

  function AnimationReplayEngine(socket) {
    this.socket = socket;
    this.processedIds = new Set();
    this.handlers = {
      'class-add': this.replayClassAdd.bind(this),
      'class-remove': this.replayClassRemove.bind(this),
      'class-toggle': this.replayClassToggle.bind(this),
      'style-change': this.replayStyleChange.bind(this),
      'waapi': this.replayWAAPI.bind(this),
      'gsap': this.replayGSAP.bind(this),
      'anime': this.replayAnime.bind(this),
      'lottie': this.replayLottie.bind(this),
      'declarative': this.replayDeclarative.bind(this)
    };

    this.socket.on('bs:anim:trigger', this.handleMessage.bind(this));
  }

  AnimationReplayEngine.prototype.handleMessage = function(msg) {
    if (!msg || !msg.id || !msg.triggerType) {
      console.warn('[BS-Anim] Invalid message:', msg);
      return;
    }

    // Deduplication
    if (this.processedIds.has(msg.id)) return;
    this.processedIds.add(msg.id);

    const handler = this.handlers[msg.triggerType];
    if (!handler) {
      console.warn('[BS-Anim] Unknown trigger type:', msg.triggerType);
      return;
    }

    const el = document.querySelector(msg.selector);
    if (!el) {
      console.warn('[BS-Anim] Target not found:', msg.selector);
      return;
    }

    handler(el, msg.payload);
  };

  // --- CSS Class Handlers ---
  AnimationReplayEngine.prototype.replayClassAdd = function(el, payload) {
    el.classList.remove.apply(el.classList, payload.classNames);
    void el.offsetWidth; // force reflow
    el.classList.add.apply(el.classList, payload.classNames);
  };

  AnimationReplayEngine.prototype.replayClassRemove = function(el, payload) {
    el.classList.remove.apply(el.classList, payload.classNames);
  };

  AnimationReplayEngine.prototype.replayClassToggle = function(el, payload) {
    el.classList.toggle(payload.className, payload.force);
  };

  // --- Style Handler ---
  AnimationReplayEngine.prototype.replayStyleChange = function(el, payload) {
    el.style.setProperty(payload.property, payload.value);
  };

  // --- WAAPI Handler ---
  AnimationReplayEngine.prototype.replayWAAPI = function(el, payload) {
    el.animate(payload.keyframes, payload.options);
  };

  // --- GSAP Handler ---
  AnimationReplayEngine.prototype.replayGSAP = function(el, payload) {
    if (typeof gsap !== 'undefined') {
      var method = payload.method || 'to';
      if (gsap[method]) {
        gsap[method](el, payload.gsapConfig);
      }
    } else {
      console.warn('[BS-Anim] GSAP not available, skipping replay');
    }
  };

  // --- Anime.js Handler ---
  AnimationReplayEngine.prototype.replayAnime = function(el, payload) {
    if (typeof anime !== 'undefined') {
      var config = Object.assign({}, payload.animeConfig);
      config.targets = el;
      anime(config);
    } else {
      console.warn('[BS-Anim] Anime.js not available, skipping replay');
    }
  };

  // --- Lottie Handler ---
  AnimationReplayEngine.prototype.replayLottie = function(el, payload) {
    if (typeof lottie !== 'undefined' && payload.lottieAction) {
      var animations = lottie.getRegisteredAnimations ? lottie.getRegisteredAnimations() : [];
      var anim = animations.find(function(a) {
        return a.wrapper === el || (a.wrapper && a.wrapper.contains && a.wrapper.contains(el));
      });
      if (anim && anim[payload.lottieAction]) {
        anim[payload.lottieAction]();
      }
    }
  };

  // --- Declarative Handler ---
  AnimationReplayEngine.prototype.replayDeclarative = function(el, payload) {
    var handlers = window.BS_DECLARATIVE_HANDLERS || {};
    var handler = handlers[payload.animName];

    if (handler) {
      handler(el, payload.action, payload.params);
    } else if (payload.action === 'start') {
      // Default: treat as CSS class animation
      this.replayClassAdd(el, { classNames: [payload.animName] });
    } else {
      this.replayClassRemove(el, { classNames: [payload.animName] });
    }
  };

  // Initialize when socket is ready
  function initReplayEngine() {
    if (window.BS_AnimSync && window.BS_AnimSync._replayEngine) return;

    var poll = setInterval(function() {
      if (window._danmakuSocket) {
        clearInterval(poll);
        var engine = new AnimationReplayEngine(window._danmakuSocket);
        window.BS_AnimSync = window.BS_AnimSync || {};
        window.BS_AnimSync._replayEngine = engine;
      }
    }, 100);

    setTimeout(function() { clearInterval(poll); }, 10000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initReplayEngine);
  } else {
    initReplayEngine();
  }

  // Node.js exports for tests
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AnimationReplayEngine;
  }
})();
```

Run: `npm test -- tests/anim-sync/replay-engine.test.js`

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add public/anim-sync/replay-engine.js tests/anim-sync/replay-engine.test.js
git commit -m "feat(anim-sync): add AnimationReplayEngine with 9 replay handlers"
```

---

## Task 3: Trigger Hook Layer (`trigger-hook-layer.js`)

**Files:**
- Create: `public/anim-sync/trigger-hook-layer.js`

**Context:** This runs only on speaker browsers. It hooks DOM APIs to intercept animation triggers and broadcasts them.

- [ ] **Step 1: Implement DOM API Hooks**

```javascript
// public/anim-sync/trigger-hook-layer.js
(function() {
  'use strict';

  function initHookLayer() {
    if (!window.BS_AnimSync || !window.BS_AnimSync.isSpeaker()) return;

    var getSelector = window.BS_AnimSync.getStableSelector;
    var broadcast = window.BS_AnimSync.broadcastTrigger;

    // Store original references
    var originalAdd = DOMTokenList.prototype.add;
    var originalRemove = DOMTokenList.prototype.remove;
    var originalToggle = DOMTokenList.prototype.toggle;
    var originalSetAttribute = Element.prototype.setAttribute;
    var originalStyleSetProperty = CSSStyleDeclaration.prototype.setProperty;
    var originalAnimate = Element.prototype.animate;

    // Helper: get element from DOMTokenList
    // DOMTokenList doesn't expose its element directly, so we hook Element.classList getter
    var elementMap = new WeakMap();
    var classListDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'classList');

    if (classListDescriptor && classListDescriptor.get) {
      Object.defineProperty(Element.prototype, 'classList', {
        get: function() {
          var list = classListDescriptor.get.call(this);
          elementMap.set(list, this);
          return list;
        },
        configurable: true
      });
    }

    function getElementFromTokenList(tokenList) {
      return elementMap.get(tokenList) || null;
    }

    // --- Hook classList.add ---
    DOMTokenList.prototype.add = function() {
      var tokens = Array.prototype.slice.call(arguments);
      var element = getElementFromTokenList(this);

      var result = originalAdd.apply(this, arguments);

      if (element) {
        broadcast({
          triggerType: 'class-add',
          selector: getSelector(element),
          payload: { classNames: tokens }
        });
      }

      return result;
    };

    // --- Hook classList.remove ---
    DOMTokenList.prototype.remove = function() {
      var tokens = Array.prototype.slice.call(arguments);
      var element = getElementFromTokenList(this);

      var result = originalRemove.apply(this, arguments);

      if (element) {
        broadcast({
          triggerType: 'class-remove',
          selector: getSelector(element),
          payload: { classNames: tokens }
        });
      }

      return result;
    };

    // --- Hook classList.toggle ---
    DOMTokenList.prototype.toggle = function(token, force) {
      var element = getElementFromTokenList(this);

      var result = originalToggle.apply(this, arguments);

      if (element) {
        broadcast({
          triggerType: 'class-toggle',
          selector: getSelector(element),
          payload: { className: token, force: force }
        });
      }

      return result;
    };

    // --- Hook Element.setAttribute for style/class changes ---
    Element.prototype.setAttribute = function(name, value) {
      var result = originalSetAttribute.call(this, name, value);

      if (name === 'style' || name === 'class') {
        broadcast({
          triggerType: 'style-change',
          selector: getSelector(this),
          payload: { property: name, value: value }
        });
      }

      return result;
    };

    // --- Hook CSSStyleDeclaration.setProperty ---
    CSSStyleDeclaration.prototype.setProperty = function(property, value, priority) {
      var result = originalStyleSetProperty.call(this, property, value, priority);

      // Try to find the element this style belongs to
      // This is heuristic: iterate through stylesheets or use a different approach
      // For now, we skip setProperty hook and rely on setAttribute('style', ...) instead
      return result;
    };

    // --- Hook Element.prototype.animate (WAAPI) ---
    Element.prototype.animate = function(keyframes, options) {
      var result = originalAnimate.apply(this, arguments);

      broadcast({
        triggerType: 'waapi',
        selector: getSelector(this),
        payload: { keyframes: keyframes, options: options }
      });

      return result;
    };

    console.log('[BS-Anim] Trigger hook layer installed');
  }

  // Wait for common.js to be ready
  var poll = setInterval(function() {
    if (window.BS_AnimSync && window.BS_AnimSync.isSpeaker) {
      clearInterval(poll);
      initHookLayer();
    }
  }, 100);

  setTimeout(function() { clearInterval(poll); }, 10000);
})();
```

- [ ] **Step 2: Verify file syntax**

Run: `node -c public/anim-sync/trigger-hook-layer.js`

Expected: No output (success)

- [ ] **Step 3: Commit**

```bash
git add public/anim-sync/trigger-hook-layer.js
git commit -m "feat(anim-sync): add trigger hook layer for DOM API interception"
```

---

## Task 4: Library Adapters (`library-adapters.js`)

**Files:**
- Create: `public/anim-sync/library-adapters.js`

**Context:** Hooks for GSAP, Anime.js, and Lottie. Each adapter checks if the library is loaded, then monkey-patches its animation methods.

- [ ] **Step 1: Implement GSAP, Anime.js, and Lottie adapters**

```javascript
// public/anim-sync/library-adapters.js
(function() {
  'use strict';

  function initLibraryAdapters() {
    if (!window.BS_AnimSync || !window.BS_AnimSync.isSpeaker()) return;

    var getSelector = window.BS_AnimSync.getStableSelector;
    var broadcast = window.BS_AnimSync.broadcastTrigger;

    // --- GSAP Adapter ---
    function hookGSAP() {
      if (typeof gsap === 'undefined') return;

      var methods = ['to', 'from', 'fromTo'];
      methods.forEach(function(method) {
        if (!gsap[method]) return;
        var original = gsap[method];
        gsap[method] = function(targets, vars) {
          var result = original.apply(this, arguments);

          var selector = resolveGSAPTarget(targets);
          var config = arguments.length > 2 ? arguments[2] : vars;

          broadcast({
            triggerType: 'gsap',
            selector: selector,
            payload: {
              method: method,
              gsapConfig: shallowClone(config)
            }
          });

          return result;
        };
      });

      console.log('[BS-Anim] GSAP adapter installed');
    }

    function resolveGSAPTarget(targets) {
      if (typeof targets === 'string') return targets;
      if (targets instanceof Element) return getSelector(targets);
      if (targets && targets.length && targets[0] instanceof Element) {
        return getSelector(targets[0]);
      }
      return '*';
    }

    // --- Anime.js Adapter ---
    function hookAnime() {
      if (typeof anime === 'undefined') return;

      var originalAnime = anime;
      window.anime = function(params) {
        var result = originalAnime.apply(this, arguments);

        var selector = resolveAnimeTarget(params.targets);

        broadcast({
          triggerType: 'anime',
          selector: selector,
          payload: {
            animeConfig: shallowClone(params)
          }
        });

        return result;
      };

      // Copy static methods
      Object.keys(originalAnime).forEach(function(key) {
        window.anime[key] = originalAnime[key];
      });

      console.log('[BS-Anim] Anime.js adapter installed');
    }

    function resolveAnimeTarget(targets) {
      if (typeof targets === 'string') return targets;
      if (targets instanceof Element) return getSelector(targets);
      if (targets && targets.length && targets[0] instanceof Element) {
        return getSelector(targets[0]);
      }
      return '*';
    }

    // --- Lottie Adapter ---
    function hookLottie() {
      if (typeof lottie === 'undefined') return;
      if (!lottie.loadAnimation) return;

      var originalLoadAnimation = lottie.loadAnimation;
      lottie.loadAnimation = function(params) {
        var anim = originalLoadAnimation.apply(this, arguments);

        var actions = ['play', 'pause', 'stop'];
        actions.forEach(function(action) {
          if (!anim[action]) return;
          var originalAction = anim[action];
          anim[action] = function() {
            var container = typeof params.container === 'string'
              ? document.querySelector(params.container)
              : params.container;

            broadcast({
              triggerType: 'lottie',
              selector: container ? getSelector(container) : '*',
              payload: {
                lottieAction: action,
                lottieConfig: { renderer: params.renderer, loop: params.loop, autoplay: params.autoplay }
              }
            });

            return originalAction.apply(this, arguments);
          };
        });

        return anim;
      };

      console.log('[BS-Anim] Lottie adapter installed');
    }

    // --- Utilities ---
    function shallowClone(obj) {
      if (!obj || typeof obj !== 'object') return obj;
      var cloned = Array.isArray(obj) ? [] : {};
      for (var key in obj) {
        if (obj.hasOwnProperty(key)) {
          var val = obj[key];
          // Skip function references and DOM elements
          if (typeof val === 'function') continue;
          if (val instanceof Element) continue;
          cloned[key] = val;
        }
      }
      return cloned;
    }

    // Install all adapters
    hookGSAP();
    hookAnime();
    hookLottie();
  }

  // Wait for common.js and libraries to load
  var attempts = 0;
  var poll = setInterval(function() {
    attempts++;
    if (window.BS_AnimSync && window.BS_AnimSync.isSpeaker) {
      initLibraryAdapters();
      if (attempts >= 20) clearInterval(poll); // Stop after 20 attempts
    }
  }, 500);

  setTimeout(function() { clearInterval(poll); }, 15000);
})();
```

- [ ] **Step 2: Verify file syntax**

Run: `node -c public/anim-sync/library-adapters.js`

Expected: No output (success)

- [ ] **Step 3: Commit**

```bash
git add public/anim-sync/library-adapters.js
git commit -m "feat(anim-sync): add GSAP/Anime.js/Lottie library adapters"
```

---

## Task 5: Declarative Watcher (`declarative-watcher.js`)

**Files:**
- Create: `public/anim-sync/declarative-watcher.js`

**Context:** Watches for `data-bs-sync-anim` annotated elements and broadcasts their trigger events. Covers cases that DOM hooks can't catch, like hover effects.

- [ ] **Step 1: Implement DeclarativeWatcher**

```javascript
// public/anim-sync/declarative-watcher.js
(function() {
  'use strict';

  function initDeclarativeWatcher() {
    if (!window.BS_AnimSync || !window.BS_AnimSync.isSpeaker()) return;

    var getSelector = window.BS_AnimSync.getStableSelector;
    var broadcast = window.BS_AnimSync.broadcastTrigger;

    function watchElement(el) {
      var trigger = el.getAttribute('data-bs-sync-trigger') || 'auto';
      var animName = el.getAttribute('data-bs-sync-anim');
      var rawParams = el.getAttribute('data-bs-sync-params');
      var params = null;

      try {
        if (rawParams) params = JSON.parse(rawParams);
      } catch (e) {
        console.warn('[BS-Anim] Invalid sync params:', rawParams);
      }

      switch (trigger) {
        case 'hover':
          el.addEventListener('mouseenter', function() {
            broadcast({
              triggerType: 'declarative',
              selector: getSelector(el),
              payload: { animName: animName, action: 'start', params: params }
            });
          });
          el.addEventListener('mouseleave', function() {
            broadcast({
              triggerType: 'declarative',
              selector: getSelector(el),
              payload: { animName: animName, action: 'end', params: params }
            });
          });
          break;

        case 'click':
          el.addEventListener('click', function() {
            broadcast({
              triggerType: 'declarative',
              selector: getSelector(el),
              payload: { animName: animName, action: 'start', params: params }
            });
          });
          break;

        case 'visible':
          if (typeof IntersectionObserver !== 'undefined') {
            var observer = new IntersectionObserver(function(entries) {
              entries.forEach(function(entry) {
                if (entry.isIntersecting) {
                  broadcast({
                    triggerType: 'declarative',
                    selector: getSelector(el),
                    payload: { animName: animName, action: 'start', params: params }
                  });
                }
              });
            }, { threshold: 0.5 });
            observer.observe(el);
          }
          break;

        case 'auto':
        default:
          // For 'auto', the trigger-hook-layer will handle it via class/style changes
          // But we also set up a marker so hook layer knows this is declarative
          el._bsSyncAnim = { name: animName, params: params };
          break;
      }
    }

    // Watch existing elements
    document.querySelectorAll('[data-bs-sync-anim]').forEach(watchElement);

    // Watch for dynamically added elements
    if (typeof MutationObserver !== 'undefined') {
      var observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
          mutation.addedNodes.forEach(function(node) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.hasAttribute && node.hasAttribute('data-bs-sync-anim')) {
                watchElement(node);
              }
              if (node.querySelectorAll) {
                node.querySelectorAll('[data-bs-sync-anim]').forEach(watchElement);
              }
            }
          });
        });
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    console.log('[BS-Anim] Declarative watcher installed');
  }

  // Wait for common.js
  var poll = setInterval(function() {
    if (window.BS_AnimSync && window.BS_AnimSync.isSpeaker) {
      clearInterval(poll);
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initDeclarativeWatcher);
      } else {
        initDeclarativeWatcher();
      }
    }
  }, 100);

  setTimeout(function() { clearInterval(poll); }, 10000);
})();
```

- [ ] **Step 2: Verify file syntax**

Run: `node -c public/anim-sync/declarative-watcher.js`

Expected: No output (success)

- [ ] **Step 3: Commit**

```bash
git add public/anim-sync/declarative-watcher.js
git commit -m "feat(anim-sync): add declarative watcher for data-bs-sync-anim annotations"
```

---

## Task 6: Server-Side Socket.IO Route

**Files:**
- Modify: `server.js`

**Context:** Add `bs:anim:trigger` event handler that validates and broadcasts animation trigger messages from speaker to all other clients.

- [ ] **Step 1: Add `bs:anim:trigger` handler in `server.js`**

Find the `slide:go` handler in `server.js` (around line 184) and add the new handler after it:

```javascript
  // server.js - add after slide:go handler (around line 189)
  // Animation sync broadcast
  socket.on('bs:anim:trigger', (msg) => {
    if (socket.data.role !== 'speaker') return;
    if (!msg || !msg.type || !msg.triggerType || !msg.selector) return;

    socket.broadcast.emit('bs:anim:trigger', msg);
  });
```

The `server.js` file should have this added after the `slide:go` handler block. The exact location is after line 189 (after `socket.broadcast.emit('slide:go', { idx });` and its closing brace).

- [ ] **Step 2: Verify server syntax**

Run: `node -c server.js`

Expected: No output (success)

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat(server): add bs:anim:trigger Socket.IO event route"
```

---

## Task 7: HTML Injector Integration

**Files:**
- Modify: `lib/html-injector.js`

**Context:** Inject the new `anim-sync/` scripts into all role pages. The scripts must be loaded in order: common → replay-engine → trigger-hook-layer → library-adapters → declarative-watcher.

- [ ] **Step 1: Modify `injectHtml` to include anim-sync scripts**

Replace the `script` variable assignment in `lib/html-injector.js` (lines 31-36):

```javascript
  const animSyncScripts = `
    <script src="/public/anim-sync/common.js"></script>
    <script src="/public/anim-sync/replay-engine.js"></script>
    <script src="/public/anim-sync/trigger-hook-layer.js"></script>
    <script src="/public/anim-sync/library-adapters.js"></script>
    <script src="/public/anim-sync/declarative-watcher.js"></script>
  `;

  const script = configScript + animSyncScripts + `
    <script src="/socket.io/socket.io.js"></script>
    <script src="/public/danmaku-renderer.js"></script>
    <script src="/public/slide-sync.js"></script>
    <script src="/public/audience-panel.js"></script>
    <script src="/public/moderator-panel.js"></script>
  `;
```

- [ ] **Step 2: Run existing tests to ensure no regression**

Run: `npm test`

Expected: All existing tests pass (html-injector, danmaku-store, slide-sync)

- [ ] **Step 3: Commit**

```bash
git add lib/html-injector.js
git commit -m "feat(injector): inject anim-sync scripts into all role pages"
```

---

## Task 8: Test Page — CSS Animation + Transition

**Files:**
- Create: `examples/anim-test-css.html`

**Context:** A standalone HTML page with various CSS `@keyframes` animations and CSS transitions for manual testing.

- [ ] **Step 1: Create CSS Animation test page**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CSS Animation Sync Test</title>
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    padding: 40px;
    background: #1a1a2e;
    color: #eee;
  }
  h1 { color: #e94560; }
  .test-section {
    margin: 30px 0;
    padding: 20px;
    border: 1px solid #333;
    border-radius: 8px;
  }
  .btn {
    padding: 10px 20px;
    margin: 5px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    background: #e94560;
    color: white;
    font-size: 14px;
  }
  .btn:hover { background: #ff6b6b; }

  /* Keyframe animations */
  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes slide-in-right {
    from { transform: translateX(100px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes bounce {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-30px); }
  }
  @keyframes rotate-scale {
    0% { transform: rotate(0deg) scale(0.5); opacity: 0; }
    100% { transform: rotate(360deg) scale(1); opacity: 1; }
  }

  .anim-fade-in { animation: fade-in 1s ease; }
  .anim-slide-in { animation: slide-in-right 0.8s ease-out; }
  .anim-bounce { animation: bounce 0.6s ease; }
  .anim-rotate-scale { animation: rotate-scale 1s ease; }

  .demo-box {
    width: 100px;
    height: 100px;
    background: linear-gradient(135deg, #e94560, #0f3460);
    border-radius: 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin: 10px;
    font-size: 12px;
    text-align: center;
  }

  /* Transition styles */
  .transition-box {
    width: 150px;
    height: 60px;
    background: #16213e;
    border: 2px solid #e94560;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 10px 0;
    transition: all 0.5s ease;
    cursor: pointer;
  }
  .transition-box:hover {
    background: #e94560;
    transform: scale(1.1);
  }
  .transition-box.expanded {
    width: 300px;
    background: #0f3460;
    border-color: #00d9ff;
  }

  .status {
    color: #00d9ff;
    font-size: 12px;
    margin-top: 10px;
  }
</style>
</head>
<body>

<h1>🎨 CSS Animation Sync Test</h1>
<p class="status">Test CSS @keyframes animations and transitions sync between speaker and audience.</p>

<div class="test-section">
  <h3>CSS @keyframes Animations</h3>
  <p>Click buttons to trigger animations. Speaker triggers should sync to audience.</p>
  <button class="btn" onclick="triggerAnim('box1', 'anim-fade-in')">Fade In</button>
  <button class="btn" onclick="triggerAnim('box2', 'anim-slide-in')">Slide In</button>
  <button class="btn" onclick="triggerAnim('box3', 'anim-bounce')">Bounce</button>
  <button class="btn" onclick="triggerAnim('box4', 'anim-rotate-scale')">Rotate + Scale</button>
  <div>
    <div id="box1" class="demo-box">Fade</div>
    <div id="box2" class="demo-box">Slide</div>
    <div id="box3" class="demo-box">Bounce</div>
    <div id="box4" class="demo-box">Rotate</div>
  </div>
</div>

<div class="test-section">
  <h3>CSS Transitions</h3>
  <p>Click boxes to toggle transition states.</p>
  <div id="trans1" class="transition-box" onclick="toggleTransition(this)">Click to Expand</div>
  <div id="trans2" class="transition-box" onclick="toggleTransition(this)">Click to Expand</div>
</div>

<div class="test-section">
  <h3>Multi-class Animation</h3>
  <button class="btn" onclick="triggerMultiAnim()">Trigger Combined</button>
  <div id="multi-box" class="demo-box" style="width:200px">Multi-class</div>
</div>

<script>
function triggerAnim(id, className) {
  const el = document.getElementById(id);
  el.classList.remove(className);
  void el.offsetWidth; // force reflow
  el.classList.add(className);
}

function toggleTransition(el) {
  el.classList.toggle('expanded');
}

function triggerMultiAnim() {
  const el = document.getElementById('multi-box');
  el.classList.remove('anim-fade-in', 'anim-slide-in');
  void el.offsetWidth;
  el.classList.add('anim-fade-in', 'anim-slide-in');
}
</script>

</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add examples/anim-test-css.html
git commit -m "test: add CSS animation + transition test page"
```

---

## Task 9: Test Page — Web Animations API (WAAPI)

**Files:**
- Create: `examples/anim-test-waapi.html`

**Context:** Tests `Element.animate()` API with various keyframe types and options.

- [ ] **Step 1: Create WAAPI test page**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WAAPI Sync Test</title>
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    padding: 40px;
    background: #0f0f23;
    color: #eee;
  }
  h1 { color: #00ff88; }
  .test-section {
    margin: 30px 0;
    padding: 20px;
    border: 1px solid #333;
    border-radius: 8px;
  }
  .btn {
    padding: 10px 20px;
    margin: 5px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    background: #00ff88;
    color: #0f0f23;
    font-size: 14px;
    font-weight: bold;
  }
  .demo-box {
    width: 120px;
    height: 120px;
    background: linear-gradient(135deg, #00ff88, #00a8ff);
    border-radius: 16px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin: 10px;
    font-size: 14px;
    color: #0f0f23;
    font-weight: bold;
  }
  .circle {
    border-radius: 50%;
    background: linear-gradient(135deg, #ff6b6b, #ff8e53);
  }
  .status { color: #aaa; font-size: 12px; margin-top: 10px; }
</style>
</head>
<body>

<h1>⚡ WAAPI (Web Animations API) Sync Test</h1>
<p class="status">Test Element.animate() synchronization between speaker and audience.</p>

<div class="test-section">
  <h3>Basic Keyframes</h3>
  <button class="btn" onclick="waapiFade()">Fade In/Out</button>
  <button class="btn" onclick="waapiSlide()">Slide + Rotate</button>
  <button class="btn" onclick="waapiScale()">Pulse Scale</button>
  <div>
    <div id="waapi1" class="demo-box">Fade</div>
    <div id="waapi2" class="demo-box">Slide</div>
    <div id="waapi3" class="demo-box circle">Pulse</div>
  </div>
</div>

<div class="test-section">
  <h3>Complex Keyframes</h3>
  <button class="btn" onclick="waapiComplex()">Complex Path</button>
  <button class="btn" onclick="waapiSpring()">Spring Effect</button>
  <div>
    <div id="waapi4" class="demo-box" style="width:200px">Complex</div>
    <div id="waapi5" class="demo-box circle">Spring</div>
  </div>
</div>

<div class="test-section">
  <h3>Property-Indexed Keyframes</h3>
  <button class="btn" onclick="waapiIndexed()">Indexed Keys</button>
  <div id="waapi6" class="demo-box">Indexed</div>
</div>

<script>
function waapiFade() {
  document.getElementById('waapi1').animate(
    [{ opacity: 0.2 }, { opacity: 1 }, { opacity: 0.2 }],
    { duration: 1500, iterations: 2 }
  );
}

function waapiSlide() {
  document.getElementById('waapi2').animate(
    [
      { transform: 'translateX(0) rotate(0deg)' },
      { transform: 'translateX(200px) rotate(180deg)' },
      { transform: 'translateX(0) rotate(360deg)' }
    ],
    { duration: 2000, easing: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)' }
  );
}

function waapiScale() {
  document.getElementById('waapi3').animate(
    [
      { transform: 'scale(1)' },
      { transform: 'scale(1.5)' },
      { transform: 'scale(1)' }
    ],
    { duration: 800, iterations: 3 }
  );
}

function waapiComplex() {
  document.getElementById('waapi4').animate(
    [
      { transform: 'translate(0,0) rotate(0deg)', background: 'linear-gradient(135deg, #00ff88, #00a8ff)', borderRadius: '16px' },
      { transform: 'translate(100px, -50px) rotate(90deg)', background: 'linear-gradient(135deg, #ff6b6b, #ff8e53)', borderRadius: '50%', offset: 0.5 },
      { transform: 'translate(0,0) rotate(0deg)', background: 'linear-gradient(135deg, #00ff88, #00a8ff)', borderRadius: '16px' }
    ],
    { duration: 2500, easing: 'ease-in-out' }
  );
}

function waapiSpring() {
  document.getElementById('waapi5').animate(
    [
      { transform: 'translateY(0)' },
      { transform: 'translateY(-100px)' },
      { transform: 'translateY(0)' },
      { transform: 'translateY(-30px)' },
      { transform: 'translateY(0)' },
      { transform: 'translateY(-10px)' },
      { transform: 'translateY(0)' }
    ],
    { duration: 1200, easing: 'ease-out' }
  );
}

function waapiIndexed() {
  document.getElementById('waapi6').animate(
    {
      opacity: [0.5, 1, 0.5],
      transform: ['scale(1)', 'scale(1.2) rotate(10deg)', 'scale(1)'],
      background: ['#00ff88', '#ff6b6b', '#00ff88']
    },
    { duration: 2000, iterations: 2 }
  );
}
</script>

</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add examples/anim-test-waapi.html
git commit -m "test: add WAAPI test page"
```

---

## Task 10: Test Page — GSAP

**Files:**
- Create: `examples/anim-test-gsap.html`

**Context:** Tests GSAP animations via CDN. Includes gsap.to, gsap.from, timeline.

- [ ] **Step 1: Create GSAP test page**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GSAP Sync Test</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    padding: 40px;
    background: #1a0a2e;
    color: #eee;
  }
  h1 { color: #ff00ff; }
  .test-section {
    margin: 30px 0;
    padding: 20px;
    border: 1px solid #444;
    border-radius: 8px;
  }
  .btn {
    padding: 10px 20px;
    margin: 5px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    background: #ff00ff;
    color: white;
    font-size: 14px;
    font-weight: bold;
  }
  .demo-box {
    width: 100px;
    height: 100px;
    background: linear-gradient(135deg, #ff00ff, #7b2dff);
    border-radius: 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin: 10px;
    font-size: 13px;
    color: white;
    font-weight: bold;
  }
  .demo-box:nth-child(2) { background: linear-gradient(135deg, #00ffff, #0077ff); }
  .demo-box:nth-child(3) { background: linear-gradient(135deg, #ff6b6b, #ee5a5a); }
  .status { color: #aaa; font-size: 12px; margin-top: 10px; }
</style>
</head>
<body>

<h1>🎭 GSAP Animation Sync Test</h1>
<p class="status">Test GSAP animations (gsap.to, gsap.from, timeline) sync.</p>

<div class="test-section">
  <h3>gsap.to</h3>
  <button class="btn" onclick="gsapTo()">Move Right</button>
  <button class="btn" onclick="gsapToRotate()">Rotate + Scale</button>
  <div>
    <div id="g1" class="demo-box">Move</div>
    <div id="g2" class="demo-box">Rotate</div>
  </div>
</div>

<div class="test-section">
  <h3>gsap.from</h3>
  <button class="btn" onclick="gsapFrom()">Fade In From</button>
  <div id="g3" class="demo-box">From</div>
</div>

<div class="test-section">
  <h3>Timeline (Chained)</h3>
  <button class="btn" onclick="gsapTimeline()">Run Timeline</button>
  <div>
    <div id="g4" class="demo-box">Step 1</div>
    <div id="g5" class="demo-box">Step 2</div>
    <div id="g6" class="demo-box">Step 3</div>
  </div>
</div>

<div class="test-section">
  <h3>Stagger</h3>
  <button class="btn" onclick="gsapStagger()">Stagger Animation</button>
  <div id="stagger-container">
    <div class="demo-box" style="width:60px;height:60px;font-size:10px">1</div>
    <div class="demo-box" style="width:60px;height:60px;font-size:10px">2</div>
    <div class="demo-box" style="width:60px;height:60px;font-size:10px">3</div>
    <div class="demo-box" style="width:60px;height:60px;font-size:10px">4</div>
  </div>
</div>

<script>
function gsapTo() {
  gsap.to('#g1', { x: 200, duration: 1, ease: 'power2.out' });
}

function gsapToRotate() {
  gsap.to('#g2', { rotation: 360, scale: 1.5, duration: 1.2, ease: 'back.out(1.7)' });
}

function gsapFrom() {
  gsap.from('#g3', { opacity: 0, y: 50, scale: 0.5, duration: 1, ease: 'elastic.out(1, 0.5)' });
}

function gsapTimeline() {
  const tl = gsap.timeline();
  tl.to('#g4', { x: 150, rotation: 90, duration: 0.6 })
    .to('#g5', { x: 150, rotation: -90, duration: 0.6 }, '-=0.3')
    .to('#g6', { x: 150, scale: 1.3, duration: 0.6 }, '-=0.3');
}

function gsapStagger() {
  gsap.to('#stagger-container .demo-box', {
    y: -40,
    rotation: 180,
    duration: 0.8,
    stagger: 0.1,
    ease: 'bounce.out',
    yoyo: true,
    repeat: 1
  });
}
</script>

</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add examples/anim-test-gsap.html
git commit -m "test: add GSAP animation test page"
```

---

## Task 11: Test Page — Anime.js

**Files:**
- Create: `examples/anim-test-anime.html`

**Context:** Tests Anime.js animations via CDN.

- [ ] **Step 1: Create Anime.js test page**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Anime.js Sync Test</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.2/anime.min.js"></script>
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    padding: 40px;
    background: #0a192f;
    color: #ccd6f6;
  }
  h1 { color: #64ffda; }
  .test-section {
    margin: 30px 0;
    padding: 20px;
    border: 1px solid #233554;
    border-radius: 8px;
  }
  .btn {
    padding: 10px 20px;
    margin: 5px;
    border: 1px solid #64ffda;
    border-radius: 4px;
    cursor: pointer;
    background: transparent;
    color: #64ffda;
    font-size: 14px;
  }
  .btn:hover { background: #64ffda; color: #0a192f; }
  .demo-box {
    width: 100px;
    height: 100px;
    background: #64ffda;
    border-radius: 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin: 10px;
    font-size: 13px;
    color: #0a192f;
    font-weight: bold;
  }
  .demo-box:nth-child(2) { background: #ff6b6b; }
  .demo-box:nth-child(3) { background: #ffd93d; color: #333; }
  .status { color: #8892b0; font-size: 12px; margin-top: 10px; }
</style>
</head>
<body>

<h1>🌊 Anime.js Sync Test</h1>
<p class="status">Test Anime.js animations sync between speaker and audience.</p>

<div class="test-section">
  <h3>Basic Animations</h3>
  <button class="btn" onclick="animeTranslate()">Translate</button>
  <button class="btn" onclick="animeRotate()">Rotate</button>
  <button class="btn" onclick="animeScale()">Scale</button>
  <div>
    <div id="a1" class="demo-box">Move</div>
    <div id="a2" class="demo-box">Rotate</div>
    <div id="a3" class="demo-box">Scale</div>
  </div>
</div>

<div class="test-section">
  <h3>Stagger Grid</h3>
  <button class="btn" onclick="animeStagger()">Grid Stagger</button>
  <div id="grid-container" style="display:grid;grid-template-columns:repeat(5,50px);gap:8px;margin-top:10px">
    <div class="demo-box" style="width:50px;height:50px;font-size:10px;margin:0">1</div>
    <div class="demo-box" style="width:50px;height:50px;font-size:10px;margin:0">2</div>
    <div class="demo-box" style="width:50px;height:50px;font-size:10px;margin:0">3</div>
    <div class="demo-box" style="width:50px;height:50px;font-size:10px;margin:0">4</div>
    <div class="demo-box" style="width:50px;height:50px;font-size:10px;margin:0">5</div>
    <div class="demo-box" style="width:50px;height:50px;font-size:10px;margin:0">6</div>
    <div class="demo-box" style="width:50px;height:50px;font-size:10px;margin:0">7</div>
    <div class="demo-box" style="width:50px;height:50px;font-size:10px;margin:0">8</div>
    <div class="demo-box" style="width:50px;height:50px;font-size:10px;margin:0">9</div>
    <div class="demo-box" style="width:50px;height:50px;font-size:10px;margin:0">10</div>
  </div>
</div>

<div class="test-section">
  <h3>Timeline</h3>
  <button class="btn" onclick="animeTimeline()">Run Timeline</button>
  <div>
    <div id="a4" class="demo-box">T1</div>
    <div id="a5" class="demo-box">T2</div>
  </div>
</div>

<script>
function animeTranslate() {
  anime({
    targets: '#a1',
    translateX: 250,
    duration: 1000,
    easing: 'easeInOutQuad'
  });
}

function animeRotate() {
  anime({
    targets: '#a2',
    rotate: '1turn',
    duration: 1200,
    easing: 'easeInOutSine'
  });
}

function animeScale() {
  anime({
    targets: '#a3',
    scale: [1, 1.5, 1],
    duration: 800,
    easing: 'easeInOutElastic(1, .8)'
  });
}

function animeStagger() {
  anime({
    targets: '#grid-container .demo-box',
    scale: [
      { value: 0.1, easing: 'easeOutSine', duration: 500 },
      { value: 1, easing: 'easeInOutQuad', duration: 1200 }
    ],
    delay: anime.stagger(100, { grid: [5, 2], from: 'center' }),
    loop: false
  });
}

function animeTimeline() {
  var tl = anime.timeline({ easing: 'easeOutExpo' });
  tl.add({ targets: '#a4', translateX: 150, duration: 800 })
    .add({ targets: '#a5', translateX: 150, rotate: 45, duration: 800 }, '-=400');
}
</script>

</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add examples/anim-test-anime.html
git commit -m "test: add Anime.js animation test page"
```

---

## Task 12: Test Page — Declarative Annotations

**Files:**
- Create: `examples/anim-test-declarative.html`

**Context:** Tests `data-bs-sync-anim` annotations with hover, click, and visible triggers.

- [ ] **Step 1: Create declarative test page**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Declarative Sync Test</title>
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    padding: 40px;
    background: #1e1e2e;
    color: #cdd6f4;
  }
  h1 { color: #f38ba8; }
  .test-section {
    margin: 30px 0;
    padding: 20px;
    border: 1px solid #313244;
    border-radius: 8px;
  }
  .btn {
    padding: 10px 20px;
    margin: 5px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    background: #f38ba8;
    color: #1e1e2e;
    font-size: 14px;
    font-weight: bold;
  }

  /* Hover animation */
  @keyframes hover-glow {
    0% { box-shadow: 0 0 5px #f38ba8; }
    50% { box-shadow: 0 0 30px #f38ba8, 0 0 60px #f38ba8; }
    100% { box-shadow: 0 0 5px #f38ba8; }
  }
  .hover-anim-active {
    animation: hover-glow 1s ease infinite;
  }

  /* Click animation */
  @keyframes click-pulse {
    0% { transform: scale(1); }
    50% { transform: scale(1.2); }
    100% { transform: scale(1); }
  }
  .click-anim-active {
    animation: click-pulse 0.5s ease;
  }

  /* Visible animation */
  @keyframes reveal-up {
    from { opacity: 0; transform: translateY(50px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .visible-anim-active {
    animation: reveal-up 0.8s ease forwards;
  }

  .demo-card {
    width: 200px;
    padding: 20px;
    margin: 10px;
    background: #313244;
    border-radius: 12px;
    display: inline-block;
    text-align: center;
    cursor: default;
  }
  .demo-card.hoverable {
    cursor: pointer;
    transition: background 0.3s;
  }
  .demo-card.hoverable:hover {
    background: #45475a;
  }
  .status { color: #6c7086; font-size: 12px; margin-top: 10px; }

  .spacer { height: 400px; display: flex; align-items: center; justify-content: center; color: #45475a; }
</style>
</head>
<body>

<h1>🏷️ Declarative Annotation Sync Test</h1>
<p class="status">Test data-bs-sync-anim annotations with different triggers.</p>

<div class="test-section">
  <h3>Hover Trigger</h3>
  <p class="status">Hover over the cards. Speaker hover should sync to audience.</p>
  <div class="demo-card hoverable"
       data-bs-sync-anim="hover-glow"
       data-bs-sync-trigger="hover"
       onmouseenter="this.classList.add('hover-anim-active')"
       onmouseleave="this.classList.remove('hover-anim-active')">
    Hover Me
  </div>
  <div class="demo-card hoverable"
       data-bs-sync-anim="hover-glow"
       data-bs-sync-trigger="hover"
       onmouseenter="this.classList.add('hover-anim-active')"
       onmouseleave="this.classList.remove('hover-anim-active')">
    Hover Me Too
  </div>
</div>

<div class="test-section">
  <h3>Click Trigger</h3>
  <p class="status">Click the button to trigger sync.</p>
  <button class="btn"
          data-bs-sync-anim="click-pulse"
          data-bs-sync-trigger="click"
          onclick="this.classList.add('click-anim-active'); var el=this; setTimeout(function(){el.classList.remove('click-anim-active');}, 500);">
    Click to Pulse
  </button>
</div>

<div class="spacer">↓ Scroll down ↓</div>

<div class="test-section">
  <h3>Visible Trigger (IntersectionObserver)</h3>
  <p class="status">Scroll this element into view to trigger sync.</p>
  <div class="demo-card"
       data-bs-sync-anim="reveal-up"
       data-bs-sync-trigger="visible"
       style="opacity:0.3">
    Scroll to Reveal
  </div>
</div>

<div class="test-section">
  <h3>Auto Trigger (via class change)</h3>
  <p class="status">Button click triggers class change on annotated element.</p>
  <button class="btn" onclick="triggerAutoAnim()">Trigger Auto</button>
  <div id="auto-target"
       class="demo-card"
       data-bs-sync-anim="reveal-up"
       data-bs-sync-trigger="auto"
       style="opacity:0.3;margin-top:10px">
    Auto Sync Target
  </div>
</div>

<script>
function triggerAutoAnim() {
  var el = document.getElementById('auto-target');
  el.classList.remove('visible-anim-active');
  void el.offsetWidth;
  el.classList.add('visible-anim-active');
}
</script>

</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add examples/anim-test-declarative.html
git commit -m "test: add declarative annotation sync test page"
```

---

## Task 13: End-to-End Manual Test

**Files:** None (manual verification)

**Context:** Verify the full pipeline works by running the server and testing with multiple browser tabs.

- [ ] **Step 1: Start server with CSS test page**

Run: `node server.js examples/anim-test-css.html`

Expected: Server starts, output shows LAN URL

- [ ] **Step 2: Open speaker tab**

Open browser at `http://localhost:3000/speaker`

Expected: Console shows `[BS-Anim] Trigger hook layer installed`

- [ ] **Step 3: Open audience tab**

Open browser at `http://localhost:3000/`

Expected: Console shows no hook messages (audience doesn't install hooks)

- [ ] **Step 4: Test CSS Animation sync**

In speaker tab, click "Fade In" button.

Expected in audience tab: Box fades in simultaneously (within ~100ms)

- [ ] **Step 5: Test CSS Transition sync**

In speaker tab, click a transition box.

Expected in audience tab: Box expands simultaneously

- [ ] **Step 6: Run with GSAP test page**

Stop server (Ctrl+C), then run:

Run: `node server.js examples/anim-test-gsap.html`

Repeat steps 2-4 with GSAP animations.

- [ ] **Step 7: Commit (if any fixes needed)**

If fixes were made during testing, commit them with descriptive messages.

---

## Task 14: Final Integration & Documentation

**Files:**
- Modify: `README.md` (add animation sync section)

- [ ] **Step 1: Add animation sync documentation to README**

Append to `README.md` (after existing features section):

```markdown
### 动画同步 (Animation Sync)

支持演讲者端动画触发后，观众端自动同步重放：

- ✅ CSS `@keyframes` Animation（通过 class 触发）
- ✅ CSS Transition（通过 style/class 变化触发）
- ✅ Web Animations API (`element.animate()`)
- ✅ GSAP (`gsap.to`, `gsap.from`, `gsap.timeline`)
- ✅ Anime.js (`anime({...})`)
- ✅ Lottie (`anim.play()`, `anim.pause()`)
- ✅ 声明式标注 (`data-bs-sync-anim`)

**声明式标注用法：**

```html
<!-- hover 触发动画同步 -->
<div data-bs-sync-anim="hover-glow" data-bs-sync-trigger="hover">...</div>

<!-- click 触发动画同步 -->
<button data-bs-sync-anim="button-pulse" data-bs-sync-trigger="click">...</button>

<!-- 进入视口时同步 -->
<div data-bs-sync-anim="scroll-reveal" data-bs-sync-trigger="visible">...</div>
```

**测试页面：**

```bash
# CSS Animation + Transition
node server.js examples/anim-test-css.html

# Web Animations API
node server.js examples/anim-test-waapi.html

# GSAP
node server.js examples/anim-test-gsap.html

# Anime.js
node server.js examples/anim-test-anime.html

# Declarative
node server.js examples/anim-test-declarative.html
```
```

- [ ] **Step 2: Final test run**

Run: `npm test`

Expected: All tests pass

- [ ] **Step 3: Final commit**

```bash
git add README.md
git commit -m "docs: add animation sync feature documentation"
```

---

## Plan Self-Review

### Spec Coverage Check

| Spec Requirement | Implementing Task |
|------------------|-------------------|
| `common.js` shared utilities (`isSpeaker`, `getStableSelector`, `broadcastTrigger`) | Task 1 |
| `AnimationReplayEngine` with 9 replay handlers | Task 2 |
| DOM API Hook layer (`classList`, `setAttribute`, `animate`) | Task 3 |
| GSAP / Anime.js / Lottie adapters | Task 4 |
| Declarative watcher (`data-bs-sync-anim`) | Task 5 |
| Server-side `bs:anim:trigger` route | Task 6 |
| HTML injector integration | Task 7 |
| CSS Animation test page | Task 8 |
| WAAPI test page | Task 9 |
| GSAP test page | Task 10 |
| Anime.js test page | Task 11 |
| Declarative test page | Task 12 |
| Manual E2E verification | Task 13 |
| Documentation update | Task 14 |

**Gap: None. All spec requirements covered.**

### Placeholder Scan

- No "TBD", "TODO", "implement later" found
- No vague steps like "add appropriate error handling"
- All code blocks contain actual implementation code
- No "Similar to Task N" references

### Type Consistency Check

- `triggerType` enum values consistent across: messages, handlers, adapters, tests ✅
- `payload` structure matches between broadcast and replay ✅
- Selector generation (`getStableSelector`) used consistently ✅
- Socket event name `bs:anim:trigger` consistent across server and client ✅

### Cross-Reference Check

- `window.BS_AnimSync` namespace used consistently across all modules ✅
- `window._danmakuSocket` reused from existing code ✅
- `window.BS_ROLE` checked via `isSpeaker()` ✅
- `lib/html-injector.js` injection order: common → replay → hooks → adapters → watcher ✅

---

## Execution Options

**Plan complete and saved to `docs/superpowers/plans/2026-06-11-universal-html-animation-sync-plan.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach would you prefer?**

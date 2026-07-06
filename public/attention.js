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
  function normalizeBg(bgRgb) {
    if (!Array.isArray(bgRgb) || bgRgb.length < 3 ||
        ![0, 1, 2].every(function (i) { return Number.isFinite(bgRgb[i]); })) {
      return [17, 17, 24];
    }
    return [bgRgb[0], bgRgb[1], bgRgb[2]];
  }

  // 演讲者手动选色（覆盖自动）。core 由该色亮度推导，保证中心点可见。
  function fixedAccent(fixedColor) {
    var rgb = hexToRgb(fixedColor);
    if (!rgb) return null;
    var core = relativeLuminance(rgb) > 0.5 ? '#111111' : '#ffffff';
    return { accent: fixedColor.toLowerCase(), core: core };
  }

  function pickAccent(bgRgb, mode, fixedColor) {
    bgRgb = normalizeBg(bgRgb);

    if (mode === 'fixed') {
      var fx = fixedAccent(fixedColor);
      if (fx) return fx;            // 非法颜色 → 回退到 auto
    }

    var best = null, bestScore = -1, bestDL = -1;
    var bgLum = relativeLuminance(bgRgb);
    CANDIDATES.forEach(function (c) {
      var rgb = hexToRgb(c.accent);
      var dL = Math.abs(relativeLuminance(rgb) - bgLum);
      var dH = hueDistance(rgb, bgRgb) / 180;
      var score = 0.7 * dL + 0.3 * dH;
      if (score > bestScore || (score === bestScore && dL > bestDL)) {
        bestScore = score; bestDL = dL; best = c;
      }
    });
    return best
      ? { accent: best.accent, core: best.core }
      : { accent: '#ff8c1a', core: '#ffffff' };
  }

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
        '<span class="bs-attn__ring"></span>';
    }
    // ping (default) — single ring, no repeat
    return '<span class="bs-attn__core"></span>' +
      '<span class="bs-attn__ring"></span>';
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

  /* ============ Background sampling + socket wiring ============ */

  var state = { effect: 'ping', colorMode: 'auto', color: null };
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

  /* ============ no-select(防误选)============ */

  // localStorage 字符串 → 布尔。仅 "1" 视为开,其余(含 null/异常)视为关。
  function resolveNoSelect(stored) {
    return stored === '1';
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
        color: state.color,
        bgRgb: sampleBgRgb(xPct, yPct) || [17, 17, 24]
      });
    });
  }

  function init(socket) {
    socket.on('attention:ping', function (msg) {
      if (!msg || typeof msg.id === 'undefined') return;
      if (seen.has(msg.id)) return;
      seen.add(msg.id);
      setTimeout(function () { seen.delete(msg.id); }, 5000);
      var bgRgb = sampleBgRgb(msg.xPct, msg.yPct) || msg.bgRgb || [17, 17, 24];
      var picked = pickAccent(bgRgb, msg.colorMode || 'auto', msg.color);
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

  /* ============ Speaker UI ============ */

  function getState() {
    return { effect: state.effect, colorMode: state.colorMode, color: state.color };
  }

  function resetState() { state.effect = 'ping'; state.colorMode = 'auto'; state.color = null; }

  // 演讲者可选色板（与观众弹幕色板一致，便于认知统一）
  var SWATCHES = [
    '#ff4444', '#ffcc00', '#44ff44', '#00ffff',
    '#4488ff', '#ff88cc', '#ff8844', '#ffffff'
  ];

  function colorRowHtml() {
    var html = '<div class="attn-colors" data-kind="colorMode">' +
      '<button type="button" class="attn-auto" data-v="auto" data-color="">自动</button>';
    SWATCHES.forEach(function (c) {
      html += '<button type="button" class="attn-swatch" data-v="fixed" ' +
        'data-color="' + c + '" style="--c:' + c + '" title="' + c + '"></button>';
    });
    return html + '</div>';
  }

  function selectEffect(group, value) {
    var seg = group.querySelector('.attn-seg[data-kind="effect"]');
    if (!seg) return;
    seg.querySelectorAll('.attn-seg-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-v') === value);
    });
  }

  function selectColor(group, colorMode, color) {
    var row = group.querySelector('.attn-colors[data-kind="colorMode"]');
    if (!row) return;
    row.querySelectorAll('[data-v]').forEach(function (b) {
      var on = (colorMode === 'auto' && b.getAttribute('data-v') === 'auto') ||
               (colorMode === 'fixed' && b.getAttribute('data-v') === 'fixed' &&
                (b.getAttribute('data-color') || '').toLowerCase() === (color || '').toLowerCase());
      b.classList.toggle('active', on);
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
      colorRowHtml();
    container.appendChild(group);
    selectEffect(group, state.effect);
    selectColor(group, state.colorMode, state.color);
    group.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-v]');
      if (!btn) return;
      var holder = btn.closest('[data-kind]');
      if (!holder) return;
      var kind = holder.getAttribute('data-kind');
      var v = btn.getAttribute('data-v');
      if (kind === 'effect') {
        state.effect = v;
        selectEffect(group, v);
      } else {
        state.colorMode = v;                                   // 'auto' | 'fixed'
        state.color = v === 'fixed' ? btn.getAttribute('data-color') : null;
        selectColor(group, state.colorMode, state.color);
      }
    });
    return group;
  }

  /* ============ Exports ============ */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      pickAccent: pickAccent,
      relativeLuminance: relativeLuminance,
      hueDistance: hueDistance,
      hexToRgb: hexToRgb,
      renderAt: renderAt,
      sampleBgRgb: sampleBgRgb,
      initSpeakerUI: initSpeakerUI,
      getState: getState,
      resetState: resetState,
      resolveNoSelect: resolveNoSelect
    };
  }

  /* ============ Browser bootstrap ============ */
  if (typeof window !== 'undefined') {
    window.BS_Attention = {
      pickAccent: pickAccent,
      renderAt: renderAt,
      initSpeakerUI: initSpeakerUI,
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
})();

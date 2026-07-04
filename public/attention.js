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

  /* ============ Exports ============ */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      pickAccent: pickAccent,
      relativeLuminance: relativeLuminance,
      hueDistance: hueDistance,
      hexToRgb: hexToRgb,
      renderAt: renderAt
    };
  }
})();

(function() {
  'use strict';

  let socket = null;

  function init() {
    // Wait for socket to be available from danmaku-renderer.js
    const pollSocket = setInterval(() => {
      if (window._danmakuSocket) {
        clearInterval(pollSocket);
        socket = window._danmakuSocket;
        bindSocketEvents();
      }
    }, 100);

    // Timeout after 10 seconds
    setTimeout(() => {
      clearInterval(pollSocket);
    }, 10000);
  }

  function bindSocketEvents() {
    if (!socket) return;

    socket.on('slide:go', ({ idx, transforms }) => {
      goToSlide(idx, true, transforms);
    });

    socket.on('slide:sync', ({ idx, transforms }) => {
      goToSlide(idx, true, transforms);
    });

    // Nav sync: 跟随演讲者的页面路径与 section（滚动式/多页面站点）
    socket.on('nav:go', (state) => applyNavState(state));
    socket.on('nav:sync', (state) => {
      window._lastNavSync = state;
      applyNavState(state);
    });
    // 追赶：连接前可能已收到 nav:sync（由 danmaku-renderer 缓存到 window）
    if (window._lastNavSync) {
      applyNavState(window._lastNavSync);
    }

    // Catch up if we missed the initial slide:sync event
    if (typeof window._lastSlideSync === 'number') {
      goToSlide(window._lastSlideSync, true);
    }

    // Only speaker broadcasts slide changes
    if (window.BS_ROLE === 'speaker') {
      setupBroadcastChannelListener();
      setupKeyboardFallback();
      setupNavBroadcast(); // speaker 端检测 section + 拦截内链跳转
    }
  }

  /* ===== Transform Sync Utilities ===== */

  let lastBroadcastIdx = -1;

  /**
   * Return only real deck slides, ignoring html-ppt overview clones.
   */
  function getSlides() {
    const deck = document.querySelector('.deck');
    if (deck) {
      return deck.querySelectorAll(':scope > .slide');
    }
    return document.querySelectorAll('.slide');
  }

  /**
   * Get a unique index path from root to element.
   * e.g. [0, 2, 1] means root.children[0].children[2].children[1]
   */
  function getElementIndexPath(el, root) {
    const path = [];
    let curr = el;
    while (curr && curr !== root) {
      const parent = curr.parentNode;
      if (!parent) break;
      const index = Array.from(parent.children).indexOf(curr);
      path.unshift(index);
      curr = parent;
    }
    return path;
  }

  /**
   * Find an element by index path under a root element.
   */
  function findElementByIndexPath(root, path) {
    let curr = root;
    for (let i = 0; i < path.length; i++) {
      if (!curr.children || path[i] >= curr.children.length) return null;
      curr = curr.children[path[i]];
    }
    return curr;
  }

  /**
   * Capture transform/opacity state of all elements inside a slide.
   * Only records elements with non-default inline styles or computed transforms.
   */
  function captureSlideTransforms(idx) {
    const slides = getSlides();
    if (idx < 0 || idx >= slides.length) return [];
    const slide = slides[idx];

    const transforms = [];

    function walk(el) {
      const inlineTransform = el.style.transform;
      const inlineOpacity = el.style.opacity;

      // Only sync explicit inline styles set by JS libraries (GSAP/Anime/etc.).
      // Do NOT capture computed values from CSS transitions/animations, otherwise
      // the audience gets stuck mid-transition with inline styles overriding its CSS.
      if (inlineTransform || inlineOpacity) {
        const path = getElementIndexPath(el, slide);
        const record = { path };
        if (inlineTransform) record.transform = inlineTransform;
        if (inlineOpacity) record.opacity = inlineOpacity;
        transforms.push(record);
      }

      Array.from(el.children).forEach(walk);
    }

    walk(slide);
    return transforms;
  }

  /**
   * Apply captured transforms to elements inside a slide.
   */
  function applyTransforms(slideEl, transforms) {
    if (!transforms || !transforms.length) return;
    transforms.forEach((record) => {
      const el = findElementByIndexPath(slideEl, record.path);
      if (!el) return;
      if (record.transform) el.style.transform = record.transform;
      if (record.opacity) el.style.opacity = record.opacity;
    });
  }

  /* ===== Speaker-side broadcast ===== */

  function sendSlideGo(idx) {
    if (idx === lastBroadcastIdx) return;
    lastBroadcastIdx = idx;
    // Delay to let local slide transition/animations settle
    setTimeout(() => {
      const transforms = captureSlideTransforms(idx);
      socket.emit('slide:go', { idx, transforms });
    }, 120);
  }

  function setupBroadcastChannelListener() {
    const channelName = 'html-ppt-presenter-' + location.pathname;
    let bc = null;
    try {
      bc = new BroadcastChannel(channelName);
    } catch (e) {
      console.log('BroadcastChannel not available, using keyboard fallback');
      return;
    }

    bc.onmessage = function(e) {
      if (!e.data) return;
      if (e.data.type === 'go' && typeof e.data.idx === 'number') {
        sendSlideGo(e.data.idx);
      }
    };
  }

  function isHtmlPptRuntimePresent() {
    return !!document.querySelector('script[src*="html-ppt-assets/runtime.js"]');
  }

  function setupKeyboardFallback() {
    // html-ppt runtime handles keyboard navigation itself and broadcasts
    // via BroadcastChannel. Our BroadcastChannel listener forwards those
    // events over Socket.IO. Skip the fallback to avoid double-handling.
    if (isHtmlPptRuntimePresent() && typeof BroadcastChannel === 'function') {
      return;
    }

    document.addEventListener('keydown', function(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const navKeys = ['ArrowRight', 'ArrowLeft', ' ', 'PageDown', 'PageUp', 'Home', 'End'];
      if (!navKeys.includes(e.key)) return;

      const slides = getSlides();
      if (slides.length === 0) return;

      let currentIdx = 0;
      slides.forEach((s, i) => {
        if (s.classList.contains('is-active')) currentIdx = i;
      });

      if (e.defaultPrevented) {
        // The deck's own runtime already moved the slide; just broadcast the new index.
        if (socket) sendSlideGo(currentIdx);
        return;
      }

      let newIdx = currentIdx;
      switch(e.key) {
        case 'ArrowRight': case ' ': case 'PageDown':
          newIdx = Math.min(slides.length - 1, currentIdx + 1);
          break;
        case 'ArrowLeft': case 'PageUp':
          newIdx = Math.max(0, currentIdx - 1);
          break;
        case 'Home':
          newIdx = 0;
          break;
        case 'End':
          newIdx = slides.length - 1;
          break;
      }

      if (newIdx !== currentIdx && socket) {
        goToSlide(newIdx, false);
        sendSlideGo(newIdx);
      }
    });
  }

  function goToSlide(idx, fromRemote, transforms) {
    const slides = getSlides();
    const total = slides.length;
    if (idx < 0 || idx >= total) return;

    // html-ppt exposes go() globally; let it drive navigation if available
    if (typeof window.go === 'function') {
      window.go(idx, fromRemote);
    } else {
      // Fallback: replicate html-ppt go() behavior including animations
      // 1. Toggle slide visibility classes
      slides.forEach((s, i) => {
        s.classList.toggle('is-active', i === idx);
        s.classList.toggle('is-prev', i < idx);
      });

      // 2. Update progress bar
      const barFill = document.querySelector('.progress-bar span');
      if (barFill) {
        barFill.style.width = ((idx + 1) / total * 100) + '%';
      }

      // 3. Update slide number
      const numEl = document.querySelector('.slide-number');
      if (numEl) {
        numEl.setAttribute('data-current', idx + 1);
        numEl.setAttribute('data-total', total);
      }

      // 4. Update URL hash (1-based)
      const hashTarget = '#/' + (idx + 1);
      if (location.hash !== hashTarget) {
        history.replaceState(null, '', hashTarget);
      }

      // 5. Re-trigger entry animations (critical for visual effect)
      const activeSlide = slides[idx];
      activeSlide.querySelectorAll('[data-anim]').forEach(el => {
        const anim = el.getAttribute('data-anim');
        el.classList.remove('anim-' + anim);
        void el.offsetWidth; // force reflow
        el.classList.add('anim-' + anim);
      });

      // 6. Re-trigger counter-up animations
      activeSlide.querySelectorAll('.counter').forEach(el => {
        const target = parseFloat(el.getAttribute('data-to') || el.textContent);
        const dur = parseInt(el.getAttribute('data-dur') || '1200', 10);
        const start = performance.now();
        function tick(now) {
          const t = Math.min(1, (now - start) / dur);
          const v = target * (1 - Math.pow(1 - t, 3));
          el.textContent = (target % 1 === 0) ? Math.round(v) : v.toFixed(1);
          if (t < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });
    }

    // 7. Apply speaker-side transform sync (for all templates)
    if (transforms && transforms.length) {
      setTimeout(() => {
        applyTransforms(slides[idx], transforms);
      }, 80);
    }
  }

  /* ===== Nav sync（多页面 / 滚动式站点位置同步）=====
   * 与 slide:go 并存的独立通道。演讲者滚动(scroll-snap 分屏)或点内链跳转时，
   * 广播 { path, sectionIdx }；观众端跟随到同一页面同一 section。
   * 对无 snap 锚点的传统幻灯片页优雅降级为 no-op。
   */

  // 当前页面的相对路径（去 query/hash），如 '/' 或 '/projects/x.html'
  function currentRelativePath() {
    return location.pathname;
  }

  // 顶层 snap 锚点选择器（覆盖首页与子页面的 hero/section/footer/aside 等）
  var SNAP_SELECTOR = '.hero, .section, .footer, .pj-hero, article, aside';
  function getSnapSections() {
    return Array.prototype.slice.call(document.querySelectorAll(SNAP_SELECTOR));
  }

  // 观众端正在应用远端导航时置位，避免 IntersectionObserver 回调误判（观众本就不 emit，双保险）
  var isApplyingRemoteNav = false;

  /**
   * 观众端应用导航状态：跨页则跳转，同页则滚到对应 section。
   * 演讲者端也会收到 catch-up 的 nav:sync，但 path 必然等于当前页，不会触发跳转。
   */
  function applyNavState(state) {
    if (!state || typeof state.path !== 'string') return;
    if (state.path !== currentRelativePath()) {
      // 跨页跟随：用 replace 不留历史，避免观众后退混乱
      isApplyingRemoteNav = true;
      location.replace(state.path);
      return;
    }
    // 同页：滚到对应 section（平滑滚动，与 scroll-snap 自然配合）
    if (Number.isInteger(state.sectionIdx)) {
      scrollToSection(state.sectionIdx);
    }
  }

  function scrollToSection(idx) {
    var sections = getSnapSections();
    if (idx < 0 || idx >= sections.length) return;
    isApplyingRemoteNav = true;
    sections[idx].scrollIntoView({ behavior: 'smooth', block: 'start' });
    // 平滑滚动持续期间禁用 observer 误触发；滚动结束后释放
    setTimeout(function() { isApplyingRemoteNav = false; }, 800);
  }

  var lastSentNavPath = null;
  var lastSentSectionIdx = null;
  var navSendTimer = null;

  /**
   * speaker 端：检测当前可见 section 并广播。节流 ~150ms（scroll 高频）。
   */
  function setupNavBroadcast() {
    var sections = getSnapSections();
    if (sections.length === 0) return; // 无 snap 锚点（如传统幻灯片），no-op

    // 首次进入即广播当前页，确保观众 catch-up
    broadcastNav(detectCurrentSectionIdx());

    if ('IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function(entries) {
        if (isApplyingRemoteNav) return; // 观众端应用中，忽略
        var idx = detectCurrentSectionIdx(entries);
        if (idx !== null) broadcastNav(idx);
      }, { threshold: [0.4, 0.6], root: null });

      sections.forEach(function(s) { observer.observe(s); });
    }

    // 拦截站内链接跳转：让观众先收到目标 path 并立即跟随，再让演讲者自己跳转。
    // 只拦截同源、非外链、非新标签、非纯同页锚点的 <a>。
    document.addEventListener('click', function(e) {
      var a = e.target.closest ? e.target.closest('a') : null;
      if (!a || !a.href) return;
      // 修饰键 / 非左键 / 新标签：放行浏览器默认行为
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      if (a.target === '_blank') return;
      // 仅同源
      try {
        if (a.origin !== location.origin) return;
      } catch (err) { return; }

      var url = new URL(a.href, location.href);
      // 同页锚点滚动交给 IntersectionObserver，不拦截
      if (url.pathname === location.pathname && url.hash) return;

      e.preventDefault();
      // 立即广播目标路径，观众不等演讲者新页面加载就跟随。
      // sectionIdx 不在此处发送——新页面加载后由 observer 重新检测并广播。
      socket.emit('nav:go', { path: url.pathname });
      lastSentNavPath = url.pathname;
      lastSentSectionIdx = null;
      location.assign(a.href);
    });
  }

  // 取可见度最高的 snap section 的索引
  function detectCurrentSectionIdx(entries) {
    var sections = getSnapSections();
    if (sections.length === 0) return null;

    if (entries && entries.length) {
      // 基于 observer 回调 entries 取 ratio 最高且 isIntersecting 的
      var best = null, bestRatio = 0;
      entries.forEach(function(e) {
        if (e.isIntersecting && e.intersectionRatio > bestRatio) {
          bestRatio = e.intersectionRatio;
          best = e.target;
        }
      });
      if (best) {
        var i = sections.indexOf(best);
        if (i >= 0) return i;
      }
    }

    // 兜底：按视口中心所在 section 判断
    var midY = window.innerHeight / 2;
    for (var i = 0; i < sections.length; i++) {
      var r = sections[i].getBoundingClientRect();
      if (r.top <= midY && r.bottom >= midY) return i;
    }
    return 0;
  }

  // 去重 + 节流广播 nav:go。idx 为 null（找不到 section）时仅同步 path。
  function broadcastNav(idx) {
    var path = currentRelativePath();
    var safeIdx = Number.isInteger(idx) ? idx : null;
    // 去重：path 与 section 都没变就不发
    if (path === lastSentNavPath && safeIdx === lastSentSectionIdx) return;
    lastSentNavPath = path;
    lastSentSectionIdx = safeIdx;

    if (navSendTimer) clearTimeout(navSendTimer);
    navSendTimer = setTimeout(function() {
      var payload = { path: path };
      if (safeIdx !== null) payload.sectionIdx = safeIdx;
      socket.emit('nav:go', payload);
      navSendTimer = null;
    }, 150);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
